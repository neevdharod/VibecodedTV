// Shared helpers for every VibecodedTV screen: canvas scaling and remote-control key mapping.
(function () {
  // On the TV (the native app provides window.Android) use the fast rendering mode: see "lite" in the CSS.
  // ?lite=1 previews it in a browser.
  if (window.Android || /[?&]lite=1/.test(location.search)) document.documentElement.classList.add("lite");

  function fit() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty("--scale", scale);
  }
  window.addEventListener("resize", fit);
  fit();

  // A TV remote arrives in a WebView as arrow keys, Enter (DPAD_CENTER) and Escape/GoBack (BACK).
  // Keyboards get the same names, plus Backspace for Back.
  const KEYS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Enter: "ok", " ": "ok", Escape: "back", Backspace: "back", GoBack: "back", BrowserBack: "back",
    m: "mute", M: "mute",
  };
  // The OK press that opened an app can reach the app too; ignore keys for a moment after load.
  const readyAt = Date.now() + 400;
  window.TV = {
    onKey(handler) {
      window.addEventListener("keydown", (e) => {
        const key = KEYS[e.key];
        if (!key || Date.now() < readyAt) return;
        if (e.target.tagName === "INPUT") return;   // typing in a text field (on the TV: the on-screen keyboard)
        e.preventDefault();
        handler(key, e);
      });
    },
    // Key releases, for telling a press of OK from a hold.
    onKeyUp(handler) {
      window.addEventListener("keyup", (e) => {
        const key = KEYS[e.key];
        if (!key || e.target.tagName === "INPUT") return;
        handler(key, e);
      });
    },
    // Spatial navigation: the focusable nearest to `from` in direction `dir`, or null.
    // Distance along the axis counts, but drifting sideways costs three times as much.
    nearest(from, dir, candidates) {
      const a = from.getBoundingClientRect();
      const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      let best = null, bestD = Infinity;
      for (const el of candidates) {
        if (el === from || el.offsetParent === null) continue;
        const b = el.getBoundingClientRect();
        const bx = b.left + b.width / 2, by = b.top + b.height / 2;
        const dx = bx - ax, dy = by - ay;
        const along = { left: -dx, right: dx, up: -dy, down: dy }[dir];
        // Must be at least half a tile away in that direction: a focused tile lifts a few
        // pixels, which would otherwise make its neighbours count as "below" it.
        const half = (dir === "left" || dir === "right" ? Math.min(a.width, b.width) : Math.min(a.height, b.height)) / 2;
        if (along < half) continue;
        const side = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        const d = along + side * 3;
        if (d < bestD) { bestD = d; best = el; }
      }
      return best;
    },
    // Inside the home-screen simulator, Back from an app returns to the launcher.
    exitApp() {
      if (window.parent !== window) window.parent.postMessage({ type: "vtv:exit" }, "*");
      else if (window.Android && window.Android.exit) window.Android.exit();
    },
  };
})();
