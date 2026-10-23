#!/usr/bin/env python3
"""Time every action in Home and Queue, frame by frame.

    tools/venv/bin/python -I tools/bench_ui.py                    # the TV (TV_HOST, or tools/.tv_host)
    tools/venv/bin/python -I tools/bench_ui.py --adb emulator-5554  # an emulator through adb: checks the
                                                                    # script, but its timings mean nothing
    ... --out devices/sony-xbr-75x850f/bench.md                     # also write the table to a file

For each action it presses the remote's keys on the TV, then reads Android's own frame timings for the
launcher (`dumpsys gfxinfo`): frames drawn, the median and 90th/99th percentile frame time, and the
share of slow frames. 16.7 ms a frame is 60 fps. App starts report the time to their first frame
(`am start -W`). It changes nothing on the TV; it ends back on Home.
"""
import os
import re
import subprocess
import sys
import time

TOOLS = os.path.dirname(os.path.abspath(__file__))
PKG = "com.gathin.tvhome"
SERVICES = [("Netflix", "com.netflix.ninja"), ("Prime Video", "com.amazon.amazonvideo.livingroom"),
            ("Disney+", "com.disney.disneyplus")]


def backend(args):
    """A function that runs one shell command on the device and returns its output."""
    if "--adb" in args:
        serial = args[args.index("--adb") + 1]
        adb = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
        return lambda cmd: subprocess.run([adb, "-s", serial, "shell", cmd], capture_output=True,
                                          text=True, timeout=300).stdout
    if not os.environ.get("TV_HOST"):
        try:
            os.environ["TV_HOST"] = open(os.path.join(TOOLS, ".tv_host")).read().strip()
        except OSError:
            sys.exit("set TV_HOST, or put the TV IP address in tools/.tv_host")
    sys.path.insert(0, TOOLS)
    import tv
    dev = tv.connect()
    return lambda cmd: dev.shell(cmd, read_timeout_s=300)


def keys(*steps, gap=1.2):
    """input keyevent for each step (a key name, or a number of seconds to wait), as one shell line."""
    out = []
    for s in steps:
        if isinstance(s, (int, float)):
            out.append(f"sleep {s}")
        elif s.startswith("long:"):
            out.append(f"input keyevent --longpress KEYCODE_{s[5:]}; sleep {gap}")
        else:
            out.append(f"input keyevent KEYCODE_{s}; sleep {gap}")
    return "; ".join(out)


def frames(sh):
    """The launcher's frame stats since the last reset."""
    text = sh(f"dumpsys gfxinfo {PKG}")
    def num(label):
        m = re.search(label + r":\s*(\d+)", text)
        return int(m.group(1)) if m else None
    return {"frames": num("Total frames rendered"), "janky": num("Janky frames"),
            "p50": num("50th percentile"), "p90": num("90th percentile"), "p99": num("99th percentile")}


def measure(sh, name, command):
    sh(f"dumpsys gfxinfo {PKG} reset >/dev/null")
    sh(command)
    f = frames(sh)
    if not f["frames"]:   # no frames recorded: the percentiles are a placeholder, not a timing
        f.update(p50=None, p90=None, p99=None, janky=None)
    f["name"] = name
    return f


def start_time(sh, component):
    out = sh(f"am start -W -n {component}")
    m = re.search(r"TotalTime:\s*(\d+)", out)
    return int(m.group(1)) if m else None


def launch_component(sh, pkg):
    out = sh(f"cmd package resolve-activity --brief -a android.intent.action.MAIN "
             f"-c android.intent.category.LEANBACK_LAUNCHER {pkg} | tail -n 1").strip()
    return out if "/" in out else None


def main():
    args = sys.argv[1:]
    sh = backend(args)
    rows, starts = [], []

    # Home from cold: what a reboot or an update costs. `am start -W` reports 0 for a launcher, so time it
    # on the TV: from the start command until the launcher has drawn its first frame.
    sh(f"input keyevent KEYCODE_WAKEUP; am force-stop {PKG}")
    cold = sh(f"s=$(date +%s%N); am start -n {PKG}/.MainActivity >/dev/null; i=0; "
              f"while ! dumpsys gfxinfo {PKG} | grep -q 'Total frames rendered: [1-9]' && [ $i -lt 300 ]; do i=$((i+1)); done; "
              "e=$(date +%s%N); echo $(( (e - s) / 1000000 ))").strip()
    starts.append(("Home, cold start (after a reboot or update)", int(cold) if cold.isdigit() else None))
    sh("sleep 8; " + keys(*["DPAD_LEFT"] * 5, gap=0.4))   # focus on the first dock app (Queue)
    sh("sleep 4")

    rows.append(measure(sh, "Home: move along the dock and back (8 moves)",
                        keys(*["DPAD_RIGHT"] * 4, *["DPAD_LEFT"] * 4)))
    rows.append(measure(sh, "Home: Top Shelf changes title by itself (20 s idle)", "sleep 20"))
    rows.append(measure(sh, "Home: down into the app grid and back up",
                        keys("DPAD_DOWN", "DPAD_RIGHT", "DPAD_LEFT", "DPAD_UP")))
    # The Menu key opens the same menu as holding OK (a held key can't be simulated reliably).
    # Read while the menus are open: Android drops a popup's frame stats once it closes.
    rows.append(measure(sh, "Home: open the app menu (Move, Replace)", keys("MENU", gap=1.5)))
    sh(keys("BACK"))
    rows.append(measure(sh, "Home: open the top menu (Up)", keys("DPAD_UP", gap=1.5)))
    sh(keys("BACK"))
    rows.append(measure(sh, "Home: sitting idle (10 s)", "sleep 10"))
    # top's columns: PID USER PR NI VIRT RES SHR S %CPU ...
    cpu = sh(f"top -b -n 1 | grep {PKG} | grep -v grep | head -n 1").split()
    idle_cpu = cpu[8] if len(cpu) > 8 else None

    starts.append(("Open Queue", start_time(sh, f"{PKG}/.QueueActivity")))
    sh("sleep 5")
    rows.append(measure(sh, "Queue: next title (8 times)", keys(*["DPAD_DOWN"] * 8, gap=1.5)))
    rows.append(measure(sh, "Queue: previous title (3 times)", keys(*["DPAD_UP"] * 3, gap=1.5)))
    rows.append(measure(sh, "Queue: side buttons (Love, Not for me, Watchlist) and back",
                        keys("DPAD_RIGHT", "DPAD_DOWN", "DPAD_DOWN", "DPAD_UP", "DPAD_UP", "DPAD_LEFT")))
    rows.append(measure(sh, "Queue: Back to Home", keys("BACK", gap=2)))

    for name, pkg in SERVICES:
        comp = launch_component(sh, pkg)
        if not comp:
            continue
        starts.append((f"Open {name}", start_time(sh, comp)))
        sh("sleep 4; input keyevent KEYCODE_HOME; sleep 3")
    starts.append(("Home button from an app (Home already running)", start_time(sh, f"{PKG}/.MainActivity")))

    lines = ["| Action | Frames | Median | 90th % | 99th % | Slow frames |", "|---|---:|---:|---:|---:|---:|"]
    for r in rows:
        slow = f"{100 * r['janky'] // r['frames']}%" if r["frames"] and r["janky"] is not None else "-"
        ms = lambda v: f"{v} ms" if v is not None else "-"
        lines.append(f"| {r['name']} | {r['frames'] or 0} | {ms(r['p50'])} | {ms(r['p90'])} | {ms(r['p99'])} | {slow} |")
    lines += ["", "| Start | Time to first frame |", "|---|---:|"]
    for name, t in starts:
        lines.append(f"| {name} | {f'{t} ms' if t is not None else '-'} |")
    if idle_cpu is not None:
        lines += ["", f"Home's CPU use while idle: {idle_cpu}%"]
    table = "\n".join(lines)
    print(table)
    if "--out" in args:
        path = args[args.index("--out") + 1]
        with open(path, "w") as f:
            f.write(f"# UI timings, {time.strftime('%Y-%m-%d %H:%M')}\n\n"
                    "Frame times from `dumpsys gfxinfo` (16.7 ms = 60 fps); starts from `am start -W`.\n\n"
                    + table + "\n")
        print(f"\nwritten to {path}")


if __name__ == "__main__":
    main()
