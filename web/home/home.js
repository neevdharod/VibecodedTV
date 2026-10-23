// Home screen controller: clock, status pills, the rotating banner, two rows of apps you can
// rearrange, the app library, settings, screensaver, and opening Queue and Mirror Boost.
//
// Remote: arrows move, OK opens, hold OK on a tile for Move / Remove, Back steps back out.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const HOLD_MS = 550;

  let rec = new Recommender(window.QUEUE_CATALOG);
  let screen = "home";       // home | mirror | library | app
  let mode = "nav";          // on Home: nav | menu | move | sheet
  let focused = null, lastHomeFocus = null;
  let moving = null;         // id of the tile being moved
  let holdTimer = null, swallowUp = false;
  let lastInput = Date.now();

  // ---------- look ----------
  function applyLook() {
    const b = Prefs.activeBackdrop();
    $("backdrop").dataset.backdrop = b;
    $("stage").dataset.theme = Prefs.BACKDROPS[b].theme;
  }

  function tick() {
    const d = new Date();
    const h = d.getHours();
    const twelve = Prefs.get("clock") === 12;
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: twelve });
    $("time").textContent = t.replace(/\s?[AP]M$/i, "");
    // "11:02" is a digit wider than "7:42": shrink it so it stays clear of the banner.
    $("time").parentElement.classList.toggle("wide", $("time").textContent.length > 4);
    $("ampm").textContent = twelve ? (h < 12 ? "AM" : "PM") : "";
    $("date").textContent = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    const greet = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const name = Prefs.get("name");
    $("greet").innerHTML = name ? `${greet},<br>${esc(name)}` : greet;
    $("greet").classList.toggle("long", greet.length >= 12 || name.length > 11);
    // Night mode can flip the backdrop at 7 pm / 7 am.
    if ($("backdrop").dataset.backdrop !== Prefs.activeBackdrop()) applyLook();
  }

  // ---------- rows ----------
  function tile(id) {
    const a = APPS.byId[id];
    const el = document.createElement("button");
    el.className = `tile focusable k-${a.kind}`;
    el.dataset.id = id;
    el.innerHTML = a.art;
    return el;
  }

  function renderRows() {
    const rows = Prefs.rows();
    for (const r of ["fav", "more"]) {
      const holder = $(`row-${r}`);
      holder.innerHTML = "";
      rows[r].filter((id) => APPS.byId[id] && Device.available(id)).forEach((id) => holder.append(tile(id)));
    }
  }

  function tileEl(id) { return $("home").querySelector(`.tile[data-id="${id}"]`); }

  $("status").innerHTML = `
    <button class="pill glass focusable" data-id="wifi">${ICONS.wifi}Home-5G</button>
    <button class="pill glass focusable" data-id="inputs">${ICONS.input}Inputs</button>
    <button class="pill glass focusable" data-id="settings-pill">${ICONS.gear}Settings</button>`;

  // ---------- focus ----------
  function setFocus(el) {
    if (focused) focused.classList.remove("focus");
    focused = el;
    if (!el) return;
    el.classList.add("focus");
    Banner.setPaused(el.id === "watch");   // don't move the banner while you're reading it
    if (el.parentElement && el.parentElement.classList.contains("row")) scrollRow(el.parentElement, el);
  }

  // A row longer than the screen slides so the focused tile stays in view.
  function scrollRow(row, el) {
    const i = [...row.children].indexOf(el);
    const step = el.offsetWidth + 28;
    row.style.transform = `translateX(${-Math.max(0, i - 5) * step}px)`;
  }

  function navItems() {
    if (screen === "mirror") return document.querySelectorAll("#m-actions .focusable");
    if (screen === "library") return document.querySelectorAll("#lib-grid .tile");
    return document.querySelectorAll("#home .focusable");
  }

  function firstTile() { return $("row-fav").firstElementChild || $("row-more").firstElementChild; }

  let toastTimer;
  function toast(text, ms = 2600) {
    const t = $("h-toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---------- banner ----------
  Banner.onChange((film, art) => {
    $("film-bg").style.backgroundImage = `url("${art.url}")`;
  });

  // ---------- tile options (hold OK) ----------
  let menuItems = [], menuIndex = 0, menuFor = null, menuHandler = null;
  function openTileMenu(el) {
    menuHandler = null;
    menuFor = el.dataset.id;
    const a = APPS.byId[menuFor];
    const total = Prefs.rows().fav.length + Prefs.rows().more.length;
    menuItems = [["open", `Open ${a.name}`], ["move", "Move"], ...(total > 1 ? [["remove", "Remove from Home"]] : [])];
    const menu = $("tile-menu");
    menu.innerHTML = `<div class="tm-title">${esc(a.name)}</div>` +
      menuItems.map(([k, label]) => `<button class="tm-item" data-k="${k}">${esc(label)}</button>`).join("");
    menu.hidden = false;
    const row = el.parentElement;
    const x = row.offsetLeft + el.offsetLeft + el.offsetWidth / 2;
    menu.style.left = `${Math.max(88, Math.min(1920 - 80 - 360, x - 180))}px`;
    menu.style.top = `${row.offsetTop + el.offsetTop - menu.offsetHeight - 22}px`;
    mode = "menu";
    menuIndex = 0;
    renderMenu();
  }
  function renderMenu() {
    $("tile-menu").querySelectorAll(".tm-item").forEach((b, i) => b.classList.toggle("focus", i === menuIndex));
  }
  function closeTileMenu() { $("tile-menu").hidden = true; mode = "nav"; }
  // The Inputs pill: every input on the TV, connected ones first.
  function openInputsMenu(pill) {
    const list = Device.inputs().slice().sort((a, b) => b.connected - a.connected);
    menuItems = list.map((i) => [i.id, i.label === i.port ? i.label : `${i.label} · ${i.port}`]);
    if (!menuItems.length) return toast("No inputs found");
    menuHandler = (id) => Device.openInput(id);
    const menu = $("tile-menu");
    menu.innerHTML = `<div class="tm-title">Inputs</div>` +
      menuItems.map(([k, label]) => `<button class="tm-item" data-k="${esc(k)}">${esc(label)}</button>`).join("");
    menu.hidden = false;
    menu.style.left = `${Math.min(1920 - 80 - 360, pill.offsetLeft + $("status").offsetLeft)}px`;
    menu.style.top = `${$("status").offsetTop + pill.offsetHeight + 16}px`;
    mode = "menu";
    menuIndex = 0;
    renderMenu();
  }

  function menuChoose(k) {
    if (menuHandler) { const h = menuHandler; closeTileMenu(); return h(k); }
    const id = menuFor;
    closeTileMenu();
    if (k === "open") activate(tileEl(id));
    else if (k === "move") startMove(id);
    else if (k === "remove") removeFromHome(id);
  }

  // ---------- rearranging ----------
  function startMove(id) {
    moving = id;
    mode = "move";
    $("home").classList.add("arranging");
    $("move-hint").hidden = false;
    const el = tileEl(id);
    el.classList.add("moving");
    setFocus(el);
  }

  function endMove() {
    if (!moving) return;
    Prefs.saveRows();
    const el = tileEl(moving);
    el && el.classList.remove("moving");
    moving = null;
    mode = "nav";
    $("home").classList.remove("arranging");
    $("move-hint").hidden = true;
    toast("Saved");
  }

  function moveBy(dir) {
    const rows = Prefs.rows();
    const r = rows.fav.includes(moving) ? "fav" : "more";
    const other = r === "fav" ? "more" : "fav";
    const list = rows[r];
    const i = list.indexOf(moving);
    if (dir === "left" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    else if (dir === "right" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    else if ((dir === "up" && r === "more") || (dir === "down" && r === "fav")) {
      const target = rows[other];
      if (target.length < Prefs.ROW_MAX[other]) {
        list.splice(i, 1);
        target.splice(Math.min(i, target.length), 0, moving);
      } else {
        const j = Math.min(i, target.length - 1);
        [list[i], target[j]] = [target[j], list[i]];
      }
    } else return;
    renderRows();
    const el = tileEl(moving);
    el.classList.add("moving");
    setFocus(el);
  }

  function removeFromHome(id) {
    const rows = Prefs.rows();
    for (const r of ["fav", "more"]) rows[r] = rows[r].filter((x) => x !== id);
    Prefs.saveRows();
    renderRows();
    setFocus(firstTile());
    toast(`${APPS.byId[id].name} removed. Add it back from All apps.`);
  }

  // ---------- app library ----------
  function openLibrary() {
    lastHomeFocus = focused;
    screen = "library";
    mode = "nav";
    $("home").hidden = true;
    $("library").hidden = false;
    renderLibrary();
    setFocus($("lib-grid").firstElementChild);
  }
  function renderLibrary(keepId) {
    const rows = Prefs.rows();
    const on = new Set([...rows.fav, ...rows.more]);
    const grid = $("lib-grid");
    grid.innerHTML = "";
    for (const a of APPS.list.filter((x) => Device.available(x.id))) {
      const el = tile(a.id);
      if (on.has(a.id)) el.insertAdjacentHTML("beforeend", `<span class="badge">${ICONS.check}On Home</span>`);
      grid.append(el);
    }
    if (keepId) setFocus(grid.querySelector(`.tile[data-id="${keepId}"]`));
  }
  function toggleOnHome(id) {
    const rows = Prefs.rows();
    const on = rows.fav.includes(id) || rows.more.includes(id);
    if (on) {
      if (rows.fav.length + rows.more.length <= 1) return toast("Keep at least one app on Home");
      for (const r of ["fav", "more"]) rows[r] = rows[r].filter((x) => x !== id);
      toast(`${APPS.byId[id].name} taken off Home`);
    } else if (rows.fav.length < Prefs.ROW_MAX.fav) {
      rows.fav.push(id);
      toast(`${APPS.byId[id].name} added to Favourite Apps`);
    } else if (rows.more.length < Prefs.ROW_MAX.more) {
      rows.more.push(id);
      toast(`${APPS.byId[id].name} added to More Options`);
    } else {
      return toast("Home is full. Take an app off first.");
    }
    Prefs.saveRows();
    renderRows();
    renderLibrary(id);
  }

  // ---------- settings ----------
  function openSettings() {
    lastHomeFocus = focused;
    setFocus(null);
    mode = "sheet";
    Settings.show({
      toast,
      apply(id) {
        if (id === "name" || id === "clock") tick();
        if (id === "backdrop" || id === "night") applyLook();
        if (id === "banner") Banner.refresh(rec, false);
        if (id === "rotate") Banner.reschedule();
        if (id === "all") { applyLook(); tick(); renderRows(); Banner.refresh(rec, false); lastHomeFocus = null; }
      },
      action(id) {
        if (id === "preview") startSaver();
        else if (id === "arrange") { const t = firstTile(); if (t) startMove(t.dataset.id); }
        else if (id === "library") openLibrary();
        else if (id === "tvsettings") Device.on ? Device.openSettings("tv") : toast("Opens the TV's own settings");
      },
      closed() {
        if (mode === "sheet") mode = "nav";
        if (!focused) setFocus(lastHomeFocus && lastHomeFocus.isConnected ? lastHomeFocus : firstTile());
      },
    });
  }

  // ---------- screensaver ----------
  function saverFilms() {
    const extra = rec.queue(14).map((p) => p.movie);
    return [...Banner.films(), ...extra];
  }
  function startSaver() { Saver.start(Prefs.get("saver") === "off" ? "film" : Prefs.get("saver"), saverFilms()); }
  setInterval(() => {
    const type = Prefs.get("saver");
    const idle = Date.now() - lastInput;
    if (type !== "off" && !Saver.active && (screen === "home" || screen === "library") && mode !== "move"
        && idle > Prefs.get("saverAfter") * 60000) {
      Saver.start(type, saverFilms());
    }
  }, 3000);
  // Any key wakes the TV, and that key does nothing else.
  window.addEventListener("keydown", (e) => {
    lastInput = Date.now();
    if (Saver.active) { Saver.stop(); swallowUp = true; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  window.addEventListener("mousemove", () => { lastInput = Date.now(); });

  // ---------- screens ----------
  function openMirror() {
    lastHomeFocus = focused;
    screen = "mirror";
    $("home").hidden = true;
    $("mirror").hidden = false;
    MirrorBoost.open();
    setFocus($("m-actions").querySelector(".focusable"));
  }

  function goHome() {
    screen = "home";
    mode = "nav";
    $("mirror").hidden = true;
    $("library").hidden = true;
    $("home").hidden = false;
    const back = lastHomeFocus && lastHomeFocus.isConnected ? lastHomeFocus : (tileEl(lastHomeFocus && lastHomeFocus.dataset.id) || firstTile());
    setFocus(back);
  }

  function openApp(src) {
    lastHomeFocus = focused;
    screen = "app";
    const frame = $("app-frame"), iframe = $("app-iframe");
    frame.hidden = false;
    iframe.src = src;
    iframe.onload = () => { iframe.focus(); iframe.contentWindow.focus(); };
  }

  function closeApp() {
    $("app-iframe").src = "about:blank";
    $("app-frame").hidden = true;
    window.focus();
    rec = new Recommender(window.QUEUE_CATALOG);   // pick up what Queue just learned
    Banner.refresh(rec);
    lastInput = Date.now();
    goHome();
  }

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "vtv:exit" && screen === "app") closeApp();
  });

  async function activate(el) {
    if (!el) return;
    const id = el.dataset.id || el.dataset.act || el.id;
    if (screen === "mirror") {
      if (id === "boost-mirror") {
        await MirrorBoost.boost();
        $("m-sub").textContent = "Opening AirScreen… On your iPhone: Control Center → Screen Mirroring → Living Room TV.";
        MirrorBoost.openReceiver();
      } else if (id === "boost") MirrorBoost.boost();
      else if (id === "picture") Device.openSettings("picture");
      else if (id === "undo") MirrorBoost.undo();
      return;
    }
    if (screen === "library") return toggleOnHome(id);
    if (id === "watch") {
      const film = Banner.current();
      if (Device.on) return Device.openQueue(film ? film.id : "");
      return openApp(`queue/index.html${film ? `?film=${encodeURIComponent(film.id)}` : ""}`);
    }
    if (id === "queue") Device.on ? Device.openQueue("") : openApp("queue/index.html");
    else if (id === "mirror") openMirror();
    else if (id === "library") openLibrary();
    else if (id === "settings" || id === "settings-pill") openSettings();
    else if (id === "wifi") toast(Device.on ? networkText() : "Connected to Home-5G · 5 GHz · 390 Mbps");
    else if (id === "inputs") Device.on ? openInputsMenu(el) : toast("HDMI 1: PS5 · HDMI 2: nothing connected · Live TV");
    else if (Device.on) { if (!Device.launch(id)) toast(`Couldn't open ${APPS.byId[id] ? APPS.byId[id].name : "that"}`); }
    else toast(`Opens ${APPS.byId[id].name} on your TV`);
  }

  // ---------- remote ----------
  TV.onKey((key, e) => {
    if (screen === "app") return;
    if (Settings.key(key)) return;

    if (mode === "menu") {
      if (key === "up") menuIndex = (menuIndex + menuItems.length - 1) % menuItems.length;
      else if (key === "down") menuIndex = (menuIndex + 1) % menuItems.length;
      else if (key === "ok") { swallowUp = true; return menuChoose(menuItems[menuIndex][0]); }
      else if (key === "back") return closeTileMenu();
      return renderMenu();
    }
    if (mode === "move") {
      if (key === "ok" || key === "back") { swallowUp = true; return endMove(); }
      if (key !== "mute") moveBy(key);
      return;
    }

    if (key === "ok") {
      if (e.repeat) return;
      // On a Home tile, wait to see whether this is a press or a hold.
      if (screen === "home" && focused && focused.classList.contains("tile")) {
        const el = focused;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { holdTimer = null; swallowUp = true; openTileMenu(el); }, HOLD_MS);
        return;
      }
      return activate(focused);
    }
    if (key === "back") {
      if (screen === "mirror" && standaloneMirror) TV.exitApp();
      else if (screen === "mirror" || screen === "library") goHome();
      else if (focused !== firstTile()) setFocus(firstTile());
      return;
    }
    if (key === "mute") return;
    if (focused && focused.id === "watch" && (key === "left" || key === "right")) {
      return key === "left" ? Banner.prev() : Banner.next();
    }
    if (!focused) return setFocus(firstTile());
    const next = TV.nearest(focused, key, navItems());
    if (next) setFocus(next);
  });

  TV.onKeyUp((key) => {
    if (key !== "ok") return;
    if (swallowUp) { swallowUp = false; return; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; activate(focused); }
  });

  // Mouse, for trying the sample in a browser. Right-click a tile for its options.
  document.addEventListener("click", (e) => {
    if (screen === "app" || Saver.active) return;
    const row = e.target.closest(".srow");
    if (row) return Settings.click(row);
    const item = e.target.closest(".tm-item");
    if (item) return menuChoose(item.dataset.k);
    if (mode === "menu") return closeTileMenu();
    if (mode === "move") return endMove();
    if (Settings.open) return;
    const el = e.target.closest(".focusable, .tile");
    if (!el) return;
    setFocus(el);
    activate(el);
  });
  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("#home .tile");
    if (!el || mode !== "nav") return;
    e.preventDefault();
    setFocus(el);
    openTileMenu(el);
  });

  // ---------- on the TV ----------
  function networkText() {
    const n = Device.network() || {};
    if (n.type === "ethernet") return `Connected over Ethernet${n.mbps ? ` · ${n.mbps} Mbps` : ""}`;
    if (n.type === "wifi") return `Connected to ${n.name}${n.band ? ` · ${n.band}` : ""}${n.mbps ? ` · ${n.mbps} Mbps` : ""}`;
    return "Not connected";
  }
  function networkLabel() {
    const n = Device.network() || {};
    return n.type === "ethernet" ? "Ethernet" : n.type === "wifi" ? n.name || "Wi-Fi" : "Offline";
  }

  // Back from another app: pick up what's new (Queue's taste, installed apps, input names).
  window.addEventListener("vtv:resume", () => {
    if (!Device.on) return;
    Device.load();
    rec = new Recommender(window.QUEUE_CATALOG);
    if (screen === "home") { const id = focused && focused.dataset.id; renderRows(); setFocus(tileEl(id) || focused || firstTile()); }
    Banner.refresh(rec);
    $("status").querySelector('[data-id="wifi"]').lastChild.textContent = networkLabel();
    lastInput = Date.now();
  });
  // The Home button while Home is already open: back to the first screen.
  window.addEventListener("vtv:home", () => {
    Saver.stop();
    if (Settings.open) Settings.close();
    if (mode === "menu") closeTileMenu();
    if (mode === "move") endMove();
    goHome();
    setFocus(firstTile());
  });

  // ---------- start ----------
  const standaloneMirror = new URLSearchParams(location.search).get("standalone") === "1";
  if (Device.on) {
    Device.load();
    Prefs.adoptDefaultRows(Device.defaultRows());
    $("sample-badge").hidden = true;
    $("m-picture").hidden = false;
    $("status").querySelector('[data-id="wifi"]').lastChild.textContent = networkLabel();
  }
  applyLook();
  tick();
  setInterval(tick, 10000);
  renderRows();
  Banner.refresh(rec);
  setFocus(firstTile());
  if (new URLSearchParams(location.search).get("screen") === "mirror") openMirror();
})();
