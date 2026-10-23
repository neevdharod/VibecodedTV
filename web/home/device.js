// The real TV, when this page runs inside the VibecodedTV app (window.Android is the native bridge,
// tvapp/.../TvBridge.java). In a browser there's no bridge and the home screen keeps its sample data.
window.Device = (function () {
  const A = window.Android;
  const on = !!(A && A.isTv && A.isTv());

  // Tiles with their own wordmark art, and the Android package each one opens.
  const PKG = {
    netflix: "com.netflix.ninja", prime: "com.amazon.amazonvideo.livingroom", disney: "com.disney.disneyplus",
    espn: "com.espn.score_center", spotify: "com.spotify.tv.android", youtube: "com.google.android.youtube.tv",
    hulu: "com.hulu.livingroomplus", max: "com.wbd.stream", appletv: "com.apple.atve.androidtv.appletv",
    twitch: "tv.twitch.android.app", crunchyroll: "com.crunchyroll.crunchyroid", plex: "com.plexapp.android",
    livetv: "com.sony.dtv.tvx",
  };
  const BUILT_IN = new Set(["queue", "mirror", "library", "settings"]);
  const HDMI = 1007;   // TvInputInfo.TYPE_HDMI

  let installed = new Set();   // ids available on this TV
  let inputs = [];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const parse = (s, fallback) => { try { return JSON.parse(s); } catch (e) { return fallback; } };

  // Rebuild APPS from what's installed: known apps keep their wordmarks, others get their own banner,
  // and each HDMI input becomes a tile named after the device on it.
  function load() {
    if (!on) return;
    const apps = parse(A.apps(), []);
    inputs = parse(A.inputs(), []);
    const byPkg = new Map(apps.map((a) => [a.pkg, a]));
    installed = new Set(BUILT_IN);
    for (const [id, pkg] of Object.entries(PKG)) {
      if (!APPS.byId[id]) continue;
      APPS.byId[id].pkg = pkg;
      if (byPkg.has(pkg) || (id === "livetv" && A.installed(pkg))) installed.add(id);
      byPkg.delete(pkg);
    }
    byPkg.delete("com.sony.dtv.tvx");
    for (const a of byPkg.values()) {
      const id = "pkg:" + a.pkg;
      if (!APPS.byId[id]) {
        const entry = { id, name: a.label, kind: a.banner ? "banner" : "app", pkg: a.pkg,
          art: a.banner ? `<img class="ban" src="${a.art}" alt="">`
            : `<span class="sys"><img class="ico" src="${a.art}" alt=""><span><b>${esc(a.label)}</b></span></span>` };
        APPS.list.push(entry);
        APPS.byId[id] = entry;
      }
      installed.add(id);
    }
    for (const i of inputs.filter((x) => x.passthrough && x.type === HDMI)) {
      const id = "input:" + i.id;
      const named = i.label !== i.port;
      const entry = { id, name: i.label, kind: "input", inputId: i.id, connected: i.connected,
        art: `<span class="sys">${ICONS.input}<span><b>${esc(named ? i.label : i.port)}</b><small>${esc(named ? i.port : i.connected ? "Connected" : "Nothing connected")}</small></span></span>` };
      if (APPS.byId[id]) Object.assign(APPS.byId[id], entry);   // refresh names and connection state
      else { APPS.list.push(entry); APPS.byId[id] = entry; }
      installed.add(id);
    }
  }

  // First-run rows for this TV: the owner's apps in Favourites, connected HDMI devices first in More.
  function defaultRows() {
    const has = (id) => installed.has(id);
    const fav = ["queue", "mirror", "netflix", "prime", "disney", "espn", "youtube", "spotify"].filter(has).slice(0, 6);
    const hdmi = inputs.filter((i) => i.passthrough && i.type === HDMI && i.connected).map((i) => "input:" + i.id).slice(0, 2);
    const more = [...hdmi, "livetv", "spotify", "plex", "library", "settings"].filter((id) => has(id) && !fav.includes(id));
    return { fav, more };
  }

  return {
    on,
    load,
    defaultRows,
    available: (id) => !on || installed.has(id),
    inputs: () => inputs,
    network: () => (on ? parse(A.network(), {}) : null),
    launch(id) {
      const a = APPS.byId[id];
      if (!on || !a) return false;
      if (a.inputId) return A.openInput(a.inputId);
      return a.pkg ? A.launch(a.pkg) : false;
    },
    openInput: (inputId) => on && A.openInput(inputId),
    openQueue: (film) => on && (A.openQueue(film || ""), true),
    openSettings: (which) => on && (A.openSettings(which || "tv"), true),
  };
})();
