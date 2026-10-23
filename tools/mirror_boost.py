#!/usr/bin/env python3
"""Mirror Boost: tune an Android TV for low-lag AirPlay mirroring from an iPhone, over ADB.

    TV_HOST=<tv ip> tools/venv/bin/python -I tools/mirror_boost.py --check     read-only report
    TV_HOST=<tv ip> tools/venv/bin/python -I tools/mirror_boost.py --boost     apply, then open the receiver
    TV_HOST=<tv ip> tools/venv/bin/python -I tools/mirror_boost.py --restore   put every setting back

What slows mirroring down, roughly in order of impact, and what this does about it:

  network      The stream goes iPhone -> router -> TV, so the TV's link counts twice. Reported only:
               Ethernet or 5 GHz is a change you make, not a setting.
  scanning     Background Wi-Fi and Bluetooth scans pause the radio for a moment, which shows up as
               stutter. Boost turns "scan always available" off for both.
  background   Cached apps fight the receiver for CPU and memory. Boost asks Android to kill
               background processes (nothing is uninstalled or disabled).
  animations   Halved, so the TV's own UI feels quicker around the mirrored picture.
  receiver     Reports which AirPlay receiver is installed and opens it after boosting.
  picture      Game / low-latency picture mode and motion smoothing live in vendor settings that ADB
               can't set the same way on every brand, so the report tells you what to switch.

Every setting Boost changes is saved first to tools/mirror-boost-backup.json and --restore puts it
back. Nothing persists in a way a factory reset or --restore can't undo.
"""
import json
import os
import re
import sys

BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mirror-boost-backup.json")

# (namespace, key, value while boosted)
SETTINGS = [
    ("global", "wifi_scan_always_enabled", "0"),
    ("global", "ble_scan_always_enabled", "0"),
    ("global", "window_animation_scale", "0.5"),
    ("global", "transition_animation_scale", "0.5"),
    ("global", "animator_duration_scale", "0.5"),
]

# Package-name fragments of AirPlay receivers seen on Android TV (AirScreen, AirPin, AirReceiver,
# built-in AirPlay services on some Sony, TCL and Hisense firmware).
# Not plain "mirror": Sony's Miracast package (screnmirroring.com) matches that and iPhones can't use it.
RECEIVER_HINTS = ("airscreen", "airplay", "airpin", "airreceiver", "airserver", "airmirror", "aircast",
                  "screenshareios", "swiftlink")


# ---------- parsing (pure functions, tested in tools/test_mirror_boost.py) ----------

def parse_wifi(dumpsys_wifi):
    """Band, link speed and signal from `dumpsys wifi`. Missing values come back as None."""
    line = next((l for l in dumpsys_wifi.splitlines() if "mWifiInfo" in l or ("SSID:" in l and "RSSI:" in l)), "")
    def grab(pattern, cast=int):
        m = re.search(pattern, line)
        return cast(m.group(1)) if m else None
    freq = grab(r"Frequency: (\d+)\s*MHz")
    ssid = grab(r'SSID: "?([^",]+)"?', str)
    return {
        "ssid": None if ssid in (None, "<unknown ssid>") else ssid,
        "rssi": grab(r"RSSI: (-?\d+)"),
        "link_mbps": grab(r"(?:Tx )?Link speed: (\d+)\s*Mbps"),
        "freq_mhz": freq,
        "band": None if freq is None else ("6 GHz" if freq >= 5925 else "5 GHz" if freq >= 4900 else "2.4 GHz"),
    }


def parse_meminfo(meminfo):
    """MemAvailable and MemTotal from /proc/meminfo, in MB."""
    def kb(name):
        m = re.search(rf"^{name}:\s+(\d+) kB", meminfo, re.M)
        return int(m.group(1)) // 1024 if m else None
    return {"available_mb": kb("MemAvailable"), "total_mb": kb("MemTotal")}


def count_cached(dump):
    """Cached (background) app processes. Android 10+ `dumpsys activity lru` prints `#41: cch+ 5 CEM ...`;
    Android 9 has no `lru` and `dumpsys activity processes` prints `Proc #12: cch  B/ /CE ...`."""
    return sum(1 for l in dump.splitlines() if re.search(r"#\s*\d+:\s+cch", l))


def find_receivers(package_list):
    """Installed packages that look like AirPlay receivers, from `pm list packages`."""
    pkgs = [l.split(":", 1)[1].strip() for l in package_list.splitlines() if l.startswith("package:")]
    return [p for p in pkgs if any(h in p.lower() for h in RECEIVER_HINTS)]


def score(report):
    """0-100 readiness, the same weighting the on-screen Mirror Boost uses."""
    s = 0
    wifi = report["wifi"]
    if report["ethernet"] or (wifi["band"] in ("5 GHz", "6 GHz") and (wifi["rssi"] or -100) > -70):
        s += 30
    elif wifi["band"] in ("5 GHz", "6 GHz"):
        s += 18
    if report["cached_apps"] is not None and report["cached_apps"] <= 4:
        s += 12
    if (report["memory"]["available_mb"] or 0) >= 1200:
        s += 8
    if report["settings"].get("wifi_scan_always_enabled") == "0" and report["settings"].get("ble_scan_always_enabled") == "0":
        s += 14
    if report["receivers"]:
        s += 14
    s += 22   # picture mode and motion smoothing: can't be read generically, counted as done
    return min(100, s)


# ---------- talking to the TV ----------

def gather(sh):
    report = {
        "model": sh("getprop ro.product.model").strip(),
        "wifi": parse_wifi(sh("dumpsys wifi")),
        "ethernet": "inet " in sh("ip -o -4 addr show eth0 2>/dev/null"),
        "memory": parse_meminfo(sh("cat /proc/meminfo")),
        "cached_apps": count_cached(sh("dumpsys activity lru") + sh("dumpsys activity processes | grep 'Proc #'")),
        "receivers": find_receivers(sh("pm list packages -e")),   # enabled ones only
        "settings": {key: sh(f"settings get {ns} {key}").strip() for ns, key, _ in SETTINGS},
    }
    report["score"] = score(report)
    return report


def print_report(r):
    w = r["wifi"]
    ok, warn = "  ok ", "  !! "
    print(f"Mirror readiness for {r['model'] or 'this TV'}: {r['score']}/100\n")
    if r["ethernet"]:
        print(ok + "Network: Ethernet. The best case.")
    elif w["band"]:
        good = w["band"] != "2.4 GHz" and (w["rssi"] or -100) > -70
        print((ok if good else warn) + f"Network: Wi-Fi {w['band']}, {w['link_mbps']} Mbps, signal {w['rssi']} dBm"
              + ("" if good else ". Use the 5 GHz network, move the router closer, or plug in Ethernet."))
    else:
        print(warn + "Network: couldn't read the Wi-Fi link.")
    n = r["cached_apps"]
    print((ok if n <= 4 else warn) + f"Background apps: {n} cached" + ("" if n <= 4 else " (Boost closes them)"))
    mb = r["memory"]["available_mb"]
    print((ok if (mb or 0) >= 1200 else warn) + f"Free memory: {mb} MB of {r['memory']['total_mb']} MB")
    scans_off = r["settings"]["wifi_scan_always_enabled"] == "0" and r["settings"]["ble_scan_always_enabled"] == "0"
    print((ok if scans_off else warn) + "Background Wi-Fi/Bluetooth scanning: " + ("off" if scans_off else "on (Boost turns it off)"))
    if r["receivers"]:
        print(ok + "AirPlay receiver: " + ", ".join(r["receivers"]))
    else:
        print(warn + "AirPlay receiver: none found. Install AirScreen from the Play Store, or check whether the TV "
              "has AirPlay built in (Settings > Apple AirPlay & HomeKit on some sets).")
    print("  -> Picture: switch the picture mode to Game (or turn on low-latency / ALLM) and turn motion smoothing off.")
    print("  -> Receiver: if it has a resolution setting, 1080p with hardware decoding beats 4K.")
    print("  -> iPhone: for videos, tap AirPlay inside the app instead of mirroring the screen; the TV fetches the video "
          "itself, in full quality and with no lag.")


def boost(sh, report):
    if not os.path.exists(BACKUP):   # keep the first, real originals across repeated boosts
        with open(BACKUP, "w") as f:
            json.dump(report["settings"], f, indent=2)
        print(f"saved current settings to {BACKUP}")
    for ns, key, value in SETTINGS:
        sh(f"settings put {ns} {key} {value}")
    sh("am kill-all")
    print("boosted: scans off, animations halved, background apps closed")
    if report["receivers"]:
        pkg = report["receivers"][0]
        sh(f"monkey -p {pkg} -c android.intent.category.LEANBACK_LAUNCHER 1")
        print(f"opened {pkg}")


def restore(sh):
    if not os.path.exists(BACKUP):
        print("nothing to restore: no backup from a previous --boost")
        return 1
    with open(BACKUP) as f:
        saved = json.load(f)
    for ns, key, _ in SETTINGS:
        value = saved.get(key)
        if value in (None, "", "null"):
            sh(f"settings delete {ns} {key}")
        else:
            sh(f"settings put {ns} {key} {value}")
    os.remove(BACKUP)
    print("restored the settings Boost changed")
    return 0


def main():
    args = sys.argv[1:]
    if args not in (["--check"], ["--boost"], ["--restore"]):
        sys.stderr.write(__doc__)
        return 2
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import tv   # exits with a hint when TV_HOST isn't set
    dev = tv.connect()
    sh = lambda cmd: dev.shell(cmd, read_timeout_s=60.0) or ""
    try:
        if args == ["--restore"]:
            return restore(sh)
        report = gather(sh)
        print_report(report)
        if args == ["--boost"]:
            print()
            boost(sh, report)
            print(f"\nreadiness now: {score(gather(sh))}/100")
        return 0
    finally:
        dev.close()


if __name__ == "__main__":
    sys.exit(main())
