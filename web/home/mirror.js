// Mirror Boost screen. On the TV (Device.on) the rows come from real readings through the native
// bridge, and Boost really turns background scanning off and closes background apps. In a browser the
// readings are a simulated sample.
window.MirrorBoost = (function () {
  // kind: "auto" = Boost changes it; "guided" = you change it in the TV's settings; "info" = just a reading.
  const SAMPLE = [
    { id: "net", label: "Network", kind: "info", detail: "iPhone to router to TV. 5 GHz or Ethernet keeps it smooth.",
      before: ["Wi-Fi 5 GHz · 390 Mbps", "good"] },
    { id: "apps", label: "Background apps", kind: "auto", detail: "Apps left running fight the video decoder for CPU.",
      before: ["14 running", "warn"], after: ["2 running", "good"], step: "Closing background apps" },
    { id: "mem", label: "Free memory", kind: "auto", detail: "Mirroring buffers video in memory.",
      before: ["0.9 GB", "warn"], after: ["2.2 GB", "good"], step: "Freeing memory" },
    { id: "scan", label: "Wi-Fi and Bluetooth scanning", kind: "auto", detail: "Background scans pause the radio for a moment, which shows up as stutter.",
      before: ["On", "warn"], after: ["Off while mirroring", "good"], step: "Pausing background scans" },
    { id: "pic", label: "Picture mode", kind: "guided", detail: "Game mode skips heavy image processing and cuts lag.",
      before: ["Standard", "warn"], after: ["Game · low latency", "good"], step: "Switching to low-latency mode" },
    { id: "motion", label: "Motion smoothing", kind: "guided", detail: "Frame interpolation holds frames back to invent new ones.",
      before: ["Off", "good"] },
    { id: "recv", label: "AirPlay receiver", kind: "auto", detail: "1080p with hardware decoding is the sweet spot on most TVs.",
      before: ["AirScreen · 4K, software", "warn"], after: ["AirScreen · 1080p60, hardware", "good"], step: "Tuning the receiver" },
  ];
  const WEIGHT = { net: 30, apps: 12, mem: 8, scan: 14, pic: 14, motion: 8, recv: 14 };
  const MEM_OK_MB = 700;

  const $ = (id) => document.getElementById(id);
  let CHECKS = SAMPLE;
  let state = {};          // id -> [value, status]
  let busy = false;
  let lastBoost = null;    // the bridge's answer to the last boost, on the TV

  // Rows from the TV's real readings.
  function fromTv() {
    let st = {};
    try { st = JSON.parse(window.Android.mirrorStatus()); } catch (e) { /* fall back to unknowns */ }
    const n = st.network || {};
    const net = n.type === "ethernet" ? ["Ethernet", "good"]
      : n.type === "wifi" ? [`Wi-Fi ${n.band || ""} · ${n.mbps || "?"} Mbps`, n.band && n.band !== "2.4 GHz" && (n.rssi || -100) > -70 ? "good" : "warn"]
      : ["Not connected", "warn"];
    const scansOff = st.wifi_scan_always_enabled === 0 && st.ble_scan_always_enabled === 0;
    const mem = st.memFreeMb || 0;
    return [
      { id: "net", label: "Network", kind: "info", detail: "iPhone to router to TV. Ethernet or 5 GHz keeps it smooth.", before: net },
      { id: "apps", label: "Background apps", kind: "auto", detail: "Apps left running fight the video decoder for CPU and memory.",
        before: st.boosted ? ["Closed at last boost", "good"] : ["Running", "warn"], after: ["Closed", "good"], step: "Closing background apps" },
      { id: "mem", label: "Free memory", kind: "auto", detail: "Mirroring buffers video in memory.",
        before: [`${mem} MB free`, mem >= MEM_OK_MB ? "good" : "warn"], after: () => memAfter(), step: "Freeing memory" },
      { id: "scan", label: "Wi-Fi and Bluetooth scanning", kind: st.canWriteSettings ? "auto" : "guided",
        detail: st.canWriteSettings ? "Background scans pause the radio for a moment, which shows up as stutter."
          : "Needs a one-time permission over ADB before Boost can turn it off.",
        before: scansOff ? ["Off", "good"] : ["On", "warn"],
        after: () => (lastBoost && lastBoost.scansOff ? ["Off", "good"] : ["Couldn't change it", "warn"]), step: "Pausing background scans" },
      { id: "recv", label: "AirPlay receiver", kind: "info", detail: "Set it to 1080p with hardware decoding in its own settings if it has them.",
        before: st.receiver ? [st.receiverLabel, "good"] : ["None installed", "warn"] },
      { id: "pic", label: "Picture mode", kind: "guided", detail: "Game mode skips heavy image processing and cuts lag. Press Picture settings.",
        before: ["Choose Game", "warn"] },
      { id: "motion", label: "Motion smoothing", kind: "guided", detail: "Motionflow holds frames back to invent new ones. Turn it off for mirroring.",
        before: ["Turn off", "warn"] },
    ];
  }

  function memAfter() {
    const mb = lastBoost ? lastBoost.memAfterMb : 0;
    return [`${mb} MB free`, mb >= MEM_OK_MB || (lastBoost && mb > lastBoost.memBeforeMb) ? "good" : "warn"];
  }

  function reset() {
    CHECKS = Device.on ? fromTv() : SAMPLE;
    state = Object.fromEntries(CHECKS.map((c) => [c.id, c.before]));
    // Already on Ethernet: the "plug in Ethernet" tip has nothing left to say.
    const wired = Device.on && state.net && state.net[0] === "Ethernet";
    document.querySelector(".tip-wire").hidden = wired;
  }

  // On the TV only what the app can measure counts; guided rows are your call.
  function score() {
    const counted = CHECKS.filter((c) => !(Device.on && c.kind === "guided"));
    const total = counted.reduce((sum, c) => sum + WEIGHT[c.id], 0) || 1;
    const good = counted.filter((c) => state[c.id][1] === "good").reduce((sum, c) => sum + WEIGHT[c.id], 0);
    return Math.round((100 * good) / total);
  }

  function render() {
    $("m-icon").innerHTML = ICONS.mirror;
    $("tw-icon").innerHTML = ICONS.cable;
    $("checks").innerHTML = CHECKS.map((c) => {
      const [val, st] = state[c.id];
      const kind = c.kind === "info" ? "" : `<span class="kind">${c.kind === "auto" ? "Auto" : "Guided"}</span>`;
      return `<div class="check ${st}" data-id="${c.id}">
        <span class="st">${st === "good" ? ICONS.check : ICONS.bolt}</span>
        <div><div class="lb">${c.label}${kind}</div><div class="dt">${c.detail}</div></div>
        <span class="val">${val}</span></div>`;
    }).join("");
    renderScore();
  }

  function renderScore() {
    const s = score();
    $("score").textContent = s;
    $("ring-fill").style.strokeDashoffset = 603 * (1 - s / 100);
    $("ring-fill").style.stroke = s >= 85 ? "var(--good)" : "var(--accent-2)";
    const ready = s >= 85;
    $("m-title").textContent = ready ? "Ready to mirror" : "Let's speed up mirroring";
    $("m-sub").textContent = ready
      ? "Your TV is tuned for low-lag AirPlay. Start mirroring from your iPhone."
      : "A few things slow down AirPlay from your iPhone. Here's where your TV stands.";
    const left = CHECKS.filter((c) => state[c.id][1] !== "good" && c.kind !== "guided").length;
    const guided = Device.on ? " Picture mode and motion smoothing live in Picture settings." : "";
    $("score-note").textContent = ready
      ? `All set.${guided} Undo puts background scanning back the way it was.`
      : `${left} things Boost can fix.${guided || " Boost does the automatic ones and opens the right setting for the rest."}`;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function boost() {
    if (busy) return;
    busy = true;
    if (Device.on) {
      try { lastBoost = JSON.parse(window.Android.mirrorBoost()); } catch (e) { lastBoost = null; }
    }
    for (const c of CHECKS) {
      if (!c.after || c.kind === "guided" || state[c.id][1] === "good" && c.id !== "mem") continue;
      const row = document.querySelector(`.check[data-id="${c.id}"]`);
      row.className = "check busy";
      row.querySelector(".val").textContent = c.step + "…";
      await wait(650);
      const after = typeof c.after === "function" ? c.after() : c.after;
      state[c.id] = after;
      row.className = `check ${after[1]} flash`;
      row.querySelector(".st").innerHTML = after[1] === "good" ? ICONS.check : ICONS.bolt;
      row.querySelector(".val").textContent = after[0];
      renderScore();
    }
    busy = false;
  }

  return {
    open() { reset(); render(); },
    boost,
    undo() {
      if (busy) return;
      if (Device.on) window.Android.mirrorUndo();
      lastBoost = null;
      reset();
      render();
    },
    openReceiver() { if (Device.on && !window.Android.openReceiver()) $("m-sub").textContent = "No AirPlay receiver app is installed."; },
    get busy() { return busy; },
  };
})();
