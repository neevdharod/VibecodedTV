// Home screen preferences, saved on the TV. Everything the settings sheet can change lives here.
window.Prefs = (function () {
  const KEY = "vtv.home.v1";
  const DEFAULTS = {
    name: "Manish",
    backdrop: "cloud",        // see BACKDROPS
    night: "auto",            // auto: a light backdrop switches to its dark partner from 7 pm to 7 am
    banner: "mix",            // mix | foryou | new
    rotate: 8,                // seconds per banner slide, 0 = off
    clock: 12,                // 12 | 24
    saver: "film",            // film | clock | backdrop | off
    saverAfter: 5,            // minutes idle
    rows: {
      fav: ["queue", "mirror", "netflix", "youtube", "prime", "disney"],
      more: ["ps5", "livetv", "spotify", "plex", "library", "settings"],
    },
  };
  // Favourites is what fits on screen; More Options scrolls sideways.
  const ROW_MAX = { fav: 6, more: 16 };

  // name, theme, and the dark backdrop it turns into at night
  const BACKDROPS = {
    cloud: { name: "Cloud", theme: "light", night: "dusk" },
    sunrise: { name: "Sunrise", theme: "light", night: "dusk" },
    mint: { name: "Mint", theme: "light", night: "midnight" },
    dusk: { name: "Dusk", theme: "dark" },
    midnight: { name: "Midnight", theme: "dark" },
    film: { name: "Tonight's film", theme: "dark" },
  };

  let state, hadRows = false;
  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* first run or blocked */ }
    hadRows = !!saved.rows;
    state = { ...structuredClone(DEFAULTS), ...saved };
    state.rows = { ...structuredClone(DEFAULTS.rows), ...(saved.rows || {}) };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* keep going in memory */ }
  }
  load();

  return {
    DEFAULTS, BACKDROPS, ROW_MAX,
    get: (k) => state[k],
    set(k, v) { state[k] = v; save(); },
    rows: () => state.rows,
    saveRows() { save(); },
    reset() { state = structuredClone(DEFAULTS); hadRows = false; save(); },
    // On a real TV the first-run rows come from what's installed there.
    adoptDefaultRows(rows) {
      if (hadRows) return;
      state.rows = rows;
      hadRows = true;
      save();
    },
    // The backdrop actually showing right now, after night mode.
    activeBackdrop(now = new Date()) {
      const b = BACKDROPS[state.backdrop] ? state.backdrop : "cloud";
      const h = now.getHours();
      const night = h >= 19 || h < 7;
      return state.night === "auto" && night && BACKDROPS[b].night ? BACKDROPS[b].night : b;
    },
  };
})();
