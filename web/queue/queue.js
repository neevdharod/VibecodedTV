// Queue: a TikTok-style trailer feed for the TV, plus the screens around it.
//
// Feed:    Up/Down next/previous clip, OK love, Right action rail, Left the nav rail, Back exits.
// Browse:  a sidebar (For you, Search, Genres, Watchlist, Your taste, Start over) and its content.
// Light screens (moods, favourites, watchlist, taste) use the frosted sky look.
(function () {
  const CLIP_SECONDS = 30;        // each trailer loops a 30 s slice, skipping the studio logos
  const ONBOARD_GENRES = ["Action", "Comedy", "Drama", "Sci-Fi", "Thriller", "Horror",
    "Romance", "Mystery", "Animation", "Crime", "Adventure", "Documentary"];
  const ALL_GENRES = [...ONBOARD_GENRES, "Fantasy", "Music", "Sport", "War"];
  const BAR_COLOURS = ["#4f86f7", "#7a5cf0", "#ef4865", "#3fa7c9", "#ff8a4c"];
  const AVATAR_COLOURS = ["#ff6a3d", "#4f86f7", "#7a5cf0", "#19b35a"];

  const rec = new Recommender(window.QUEUE_CATALOG);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICON = {
    home: svg('<path d="M3.5 11L12 4l8.5 7"/><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5"/>'),
    search: svg('<circle cx="10.8" cy="10.8" r="6.8"/><path d="M16 16l4.8 4.8"/>'),
    taste: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/><path d="M12 12H3.2"/>'),
  };
  const thumb = (m, small) => `https://i.ytimg.com/vi/${m.trailer}/${m.hd && !small ? "maxresdefault" : "hqdefault"}.jpg`;
  const poster = (m) => m.poster || thumb(m, true);
  const still = (m) => m.still ? `https://i.ytimg.com/vi/${m.trailer}/maxres${m.still}.jpg` : thumb(m);
  // What shows behind a clip while it loads: a plain frame from inside the trailer, the
  // trailer's thumbnail, or a blurred poster when the thumbnail has a channel's text on it.
  const backdrop = (m) => m.still
    ? `<div class="backdrop still" style="background-image:url(${still(m)})"></div>`
    : (m.hd && !m.branded)
    ? `<div class="backdrop" style="background-image:url(${thumb(m)})"></div>`
    : `<div class="backdrop blur" style="background-image:url(${poster(m)})"></div>`;
  const runtime = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  let mode = null;               // genres | seeds | feed | rail | nav | browse | watchlist | taste
  let scope = null, focused = null;

  // ---------- shared ----------
  function setFocus(el) {
    if (focused) focused.classList.remove("focus");
    focused = el;
    if (el) el.classList.add("focus");
  }
  function moveFocus(dir) {
    if (!focused) return false;
    const next = TV.nearest(focused, dir, scope.querySelectorAll(".focusable"));
    if (next) setFocus(next);
    return !!next;
  }

  // Shows one screen and sets the look around it.
  const SCREENS = ["onboard-genres", "onboard-seeds", "feed", "browse", "watchlist", "taste"];
  function showScreen(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    const light = id !== "feed" && id !== "browse";
    $("stage").dataset.theme = light ? "light" : "dark";
    $("stage").classList.toggle("dark", !light);
    $("segs").hidden = id !== "feed";
    $("filter").hidden = id !== "feed" || !feed.genre;
    $("step").textContent = id === "onboard-genres" ? "1 / 2" : id === "onboard-seeds" ? "2 / 2" : "";
    if (id === "feed") resumePlayer(); else pausePlayer();
  }

  let toastTimer;
  function toast(text, ms = 2200) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  function posterEl(m, extra = "") {
    const el = document.createElement("button");
    el.className = `poster focusable ${extra}`;
    el.dataset.id = m.id;
    el.style.backgroundImage = `url("${poster(m)}")`;
    el.innerHTML = `<span class="tick">${ICONS.check}</span><span class="t">${esc(m.title)}</span>`;
    return el;
  }

  function cardHtml(m, { wide = false, progress = null } = {}) {
    const bar = progress === null ? "" : `<span class="bar"><i style="width:${Math.round(progress * 100)}%"></i></span>`;
    return `<button class="card focusable${m.still ? " still" : ""}${wide ? " wide" : ""}" data-id="${m.id}"
      style="background-image:url('${still(m)}')"><span class="t">${esc(m.title)}</span>${bar}</button>`;
  }

  // ---------- onboarding ----------
  const picked = new Set();
  function showGenres() {
    showScreen("onboard-genres");
    mode = "genres";
    picked.clear();
    $("genre-grid").innerHTML = ONBOARD_GENRES.map((g) =>
      `<button class="genre focusable" data-genre="${g}"><span class="tick">${ICONS.check}</span>${GENRE_ICONS[g]}${g}</button>`).join("");
    scope = $("onboard-genres");
    setFocus($("genre-grid").firstElementChild);
    updateCounts();
  }

  function showSeeds() {
    showScreen("onboard-seeds");
    mode = "seeds";
    // The best-rated films across the chosen moods, round-robin so every mood shows up.
    const lists = rec.moods.map((g) => rec.catalog.filter((m) => m.genres.includes(g) && m.poster).sort((a, b) => b.rating - a.rating));
    const chosen = [];
    const directors = new Set();
    for (let i = 0; chosen.length < 16 && i < 40; i++) {
      for (const list of lists) {
        const m = list.find((x) => !chosen.includes(x) && !directors.has(x.director));
        if (m && chosen.length < 16) { chosen.push(m); directors.add(m.director); }
      }
    }
    for (const m of [...rec.catalog].filter((x) => x.poster).sort((a, b) => b.rating - a.rating)) {
      if (chosen.length >= 16) break;
      if (!chosen.includes(m)) chosen.push(m);
    }
    picked.clear();
    const grid = $("seed-grid");
    grid.innerHTML = "";
    for (const m of chosen) grid.append(posterEl(m));
    scope = $("onboard-seeds");
    setFocus(grid.firstElementChild);
    updateCounts();
  }

  function updateCounts() {
    if (mode === "genres") $("genres-next").disabled = picked.size === 0;
    if (mode === "seeds") $("seeds-next").firstChild.textContent = picked.size ? `Start watching (${picked.size}) ` : "Start watching ";
  }

  function activateOnboard(el) {
    if (el.classList.contains("genre") || el.classList.contains("poster")) {
      const key = el.dataset.genre || el.dataset.id;
      if (picked.has(key)) picked.delete(key); else picked.add(key);
      el.classList.toggle("on", picked.has(key));
      updateCounts();
    } else if (el.id === "genres-next" && picked.size) {
      rec.setMoods([...picked]);
      showSeeds();
    } else if (el.id === "seeds-next") {
      for (const id of picked) rec.record(id, "love");
      startFeed(true);
    }
  }

  // ---------- feed ----------
  const feed = { history: [], index: -1, genre: null, sound: false, shownAt: 0, slide: null, player: null, t: 0 };
  let ytReady = false;
  window.onYouTubeIframeAPIReady = () => {
    ytReady = true;
    if (feed.slide && !feed.player) makePlayer(feed.slide, current().movie);
  };
  const current = () => feed.history[feed.index];

  function startFeed(first) {
    showScreen("feed");
    mode = "feed";
    renderRail();
    renderNav();
    if (feed.index < 0 || feed.index >= feed.history.length) next();
    if (first) setTimeout(() => toast("Press OK to love a film · ↓ for the next one", 4200), 900);
  }

  function next() {
    if (feed.index + 1 >= feed.history.length) {
      const ids = feed.history.map((h) => h.movie.id);
      const [item] = rec.queue(1, { genre: feed.genre, recent: ids, exclude: ids });
      if (!item) { toast(`That's every ${feed.genre ? feed.genre.toLowerCase() + " film" : "film"} for now`); return; }
      feed.history.push(item);
    }
    leaveCurrent();
    feed.index++;
    show("next");
  }

  function prev() {
    if (feed.index <= 0) { toast("You're at the start"); return; }
    leaveCurrent();
    feed.index--;
    show("prev");
  }

  // Implicit feedback: a clip you skip in a few seconds counts a little against it; one you
  // watch through counts a little for it. Explicit reactions override both. How far you got
  // is kept for "Continue watching".
  function leaveCurrent() {
    const item = current();
    if (!item) return;
    const dwell = (Date.now() - feed.shownAt) / 1000;
    if (!item.judged && !rec.reactions[item.movie.id]) {
      if (dwell < 4) rec.record(item.movie.id, "bounce");
      else if (dwell > 15) rec.record(item.movie.id, "watched");
      else { rec.seen.add(item.movie.id); rec.save(); }
      item.judged = true;
    }
    if (feed.t > 1) rec.setProgress(item.movie.id, feed.t / CLIP_SECONDS);
  }

  function show(direction) {
    const item = current();
    const m = item.movie;
    const old = feed.slide, oldPlayer = feed.player;
    const slide = document.createElement("div");
    slide.className = "slide";
    slide.innerHTML = `${backdrop(m)}<div class="player"><div></div></div>`;
    if (old) slide.style.transform = `translateY(${direction === "next" ? "100%" : "-100%"})`;
    $("slides").append(slide);
    if (old) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        slide.style.transform = "translateY(0)";
        old.style.transform = `translateY(${direction === "next" ? "-100%" : "100%"})`;
      }));
      setTimeout(() => { try { oldPlayer && oldPlayer.destroy(); } catch (e) {} old.remove(); }, 650);
    }
    feed.slide = slide;
    feed.player = null;
    feed.shownAt = Date.now();
    feed.t = 0;
    $("progress").style.transform = "scaleX(0)";
    $("clip-time").textContent = `0:00 / ${clock(CLIP_SECONDS)}`;
    renderInfo(item);
    renderRail();
    renderSegs();
    if (ytReady) makePlayer(slide, m);
    // Warm the cache for whatever is likely next.
    const ids = feed.history.map((h) => h.movie.id);
    for (const n of rec.queue(2, { genre: feed.genre, recent: ids, exclude: ids })) new Image().src = still(n.movie);
  }

  // Story-style dashes: where you are in the current run of five clips.
  function renderSegs() {
    const at = Math.max(0, feed.index) % 5;
    $("segs").innerHTML = [0, 1, 2, 3, 4].map((i) => `<i class="${i < at ? "done" : i === at ? "on" : ""}"></i>`).join("");
  }

  function renderInfo(item) {
    const m = item.movie;
    const info = $("info");
    info.classList.remove("enter");
    info.innerHTML = `
      <div class="i-match"><b>${item.match}%</b> match</div>
      <div class="i-why">${esc(item.reason)}</div>
      <h1 class="i-title${m.title.length > 24 ? " long" : ""}">${esc(m.title)}</h1>
      <div class="i-meta"><span>${m.year}</span>${ICONS.cert(m)}<span>${runtime(m.runtime)}</span>${ICONS.imdb(m)}<span>${esc(m.director)}</span></div>
      <div class="i-genres">${m.genres.map(esc).join(" &nbsp;·&nbsp; ")}<span class="i-cast">${esc(m.cast)}</span></div>
      <p class="i-blurb">${esc(m.blurb)}</p>`;
    void info.offsetWidth;
    info.classList.add("enter");
  }

  function makePlayer(slide, m) {
    const host = slide.querySelector(".player > div");
    let start = 0;
    // On the TV (lite) the player is 720p and the GPU scales it up: 1080p video plus the page on top
    // was more than the TV's GPU could redraw per frame.
    const lite = document.documentElement.classList.contains("lite");
    const player = new YT.Player(host, {
      videoId: m.trailer,
      width: lite ? 1280 : 1920,
      height: lite ? 720 : 1080,
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3,
        rel: 0, playsinline: 1, modestbranding: 1, start: 15, origin: location.origin, ...(lite ? { vq: "hd720" } : {}),
      },
      events: {
        onReady() {
          const d = player.getDuration() || 120;
          start = d > 70 ? Math.min(50, Math.max(12, Math.round(d * 0.2))) : 0;
          slide.dataset.start = start;
          player.seekTo(start, true);
          applySound(player);
          if (mode === "feed" || mode === "rail" || mode === "nav") player.playVideo(); else player.pauseVideo();
        },
        onStateChange(e) {
          if (e.data === YT.PlayerState.PLAYING) slide.classList.add("playing");
          if (e.data === YT.PlayerState.ENDED) player.seekTo(start, true);
        },
        onError() {
          if (feed.slide !== slide) return;
          toast("That trailer isn't available here, skipping");
          setTimeout(() => feed.slide === slide && next(), 1400);
        },
      },
    });
    feed.player = player;
  }

  function applySound(player) {
    if (!player || !player.mute) return;
    if (feed.sound) { player.unMute(); player.setVolume(85); } else player.mute();
  }

  // Loop the slice and drive the progress bar and timer.
  setInterval(() => {
    const p = feed.player;
    if (!p || !p.getCurrentTime || !feed.slide) return;
    const start = Number(feed.slide.dataset.start || 0);
    const t = p.getCurrentTime() - start;
    if (t >= CLIP_SECONDS) p.seekTo(start, true);
    const clamped = Math.max(0, Math.min(CLIP_SECONDS, t));
    feed.t = Math.max(feed.t, clamped);
    $("progress").style.transform = `scaleX(${clamped / CLIP_SECONDS})`;
    $("clip-time").textContent = `${clock(clamped)} / ${clock(CLIP_SECONDS)}`;
  }, 250);

  function pausePlayer() { try { feed.player && feed.player.pauseVideo(); } catch (e) {} }
  function resumePlayer() { try { feed.player && feed.player.playVideo(); } catch (e) {} }

  // ---------- actions ----------
  function love() {
    const id = current().movie.id;
    const r = rec.reactions[id];
    if (r === "love" || r === "like") {
      rec.undo(id);
      toast("Removed from your loves");
    } else {
      rec.record(id, "love");
      current().judged = true;
      const b = $("burst");
      b.innerHTML = ICONS.heart;
      b.classList.remove("go");
      void b.offsetWidth;
      b.classList.add("go");
      const t = rec.traits(id);
      toast(`Got it: more ${t.vibe.replace(/-/g, " ")} ${t.genre.toLowerCase()}`);
    }
    renderRail();
  }

  function pass() {
    const item = current();
    rec.record(item.movie.id, "pass");
    item.judged = true;
    toast("Fewer like this");
    next();
  }

  function save() {
    const added = rec.toggleWatchlist(current().movie.id);
    toast(added ? "Added to your watchlist" : "Removed from your watchlist");
    renderRail();
  }

  function toggleSound() {
    feed.sound = !feed.sound;
    applySound(feed.player);
    toast(feed.sound ? "Sound on" : "Sound off", 1200);
    renderRail();
  }

  const ACTIONS = { love, pass, save, sound: toggleSound };

  let railIndex = 0;
  function renderRail() {
    const item = current();
    const id = item && item.movie.id;
    const loved = id && (rec.reactions[id] === "love" || rec.reactions[id] === "like");
    const saved = id && rec.watchlist.includes(id);
    const icons = { love: ICONS.heart, pass: ICONS.x, save: saved ? ICONS.check : ICONS.plus, sound: feed.sound ? ICONS.soundOn : ICONS.soundOff };
    $("rail").querySelectorAll(".rail-btn").forEach((b, i) => {
      const act = b.dataset.act;
      b.querySelector(".ic").innerHTML = icons[act];
      b.classList.toggle("active", (act === "love" && !!loved) || (act === "save" && !!saved));
      b.classList.toggle("focus", mode === "rail" && i === railIndex);
      if (act === "save") b.querySelector(".lbl").textContent = saved ? "Saved" : "Watchlist";
      if (act === "sound") b.querySelector(".lbl").textContent = feed.sound ? "Sound on" : "Mute";
    });
  }

  // ---------- nav rail (left of the feed) ----------
  let navIndex = 0;
  const NAV_ICONS = { browse: ICON.home, search: ICON.search, watchlist: ICONS.bookmark, taste: ICON.taste };
  function renderNav() {
    $("nav").querySelectorAll(".nav-btn").forEach((b, i) => {
      if (!b.innerHTML) b.innerHTML = NAV_ICONS[b.dataset.go];
      b.classList.toggle("here", b.dataset.go === "browse" && mode !== "nav");
      b.classList.toggle("focus", mode === "nav" && i === navIndex);
    });
    $("feed").classList.toggle("nav-mode", mode === "nav");
  }
  function navGo(target) {
    if (target === "browse") openBrowse("foryou");
    else if (target === "search") openBrowse("search", true);
    else openPanel(target, "feed");
  }

  // ---------- browse ----------
  const SIDE = [
    ["foryou", "For you", ICON.home], ["search", "Search", ICON.search], ["genres", "Genres", ICONS.grid],
    ["watchlist", "Watchlist", ICONS.bookmark], ["taste", "Your taste", ICON.taste], ["reset", "Start over", ICONS.reset],
  ];
  const browse = { section: "foryou", zone: "side", sideIndex: 0, query: "", confirmReset: false };

  function openBrowse(section, intoContent = false) {
    const m = current() && current().movie;
    $("b-bg").style.backgroundImage = m ? `url("${still(m)}")` : "";
    showScreen("browse");
    mode = "browse";
    browse.sideIndex = Math.max(0, SIDE.findIndex((s) => s[0] === section));
    browse.confirmReset = false;
    renderSide();
    renderSection(section);
    if (intoContent) enterContent(); else { browse.zone = "side"; setFocus(null); renderSide(); }
  }

  function renderSide() {
    $("b-list").innerHTML = SIDE.map(([id, label, icon], i) => {
      const text = id === "reset" && browse.confirmReset ? "Press OK again" : label;
      const cls = [i === browse.sideIndex && browse.zone === "content" ? "here" : "",
        i === browse.sideIndex && browse.zone === "side" ? "focus" : ""].join(" ");
      return `<button class="b-item ${cls}" data-sec="${id}">${icon}<span>${text}</span></button>`;
    }).join("");
  }

  function renderSection(section) {
    browse.section = section;
    const c = $("b-content");
    c.classList.remove("enter");
    if (section === "foryou") {
      const picks = rec.queue(10, { genre: feed.genre }).map((p) => p.movie);
      const cont = rec.continueWatching();
      c.innerHTML = `<div class="b-row" data-row="picks">${picks.map((m) => cardHtml(m)).join("")}</div>
        <div class="b-label">Continue watching</div>
        ${cont.length ? `<div class="b-row" data-row="cont">${cont.map((x) => cardHtml(x.movie, { wide: true, progress: x.progress })).join("")}</div>`
          : `<p class="b-empty">Clips you start and don't finish show up here.</p>`}`;
    } else if (section === "genres") {
      c.innerHTML = `<div class="g-grid">${["All", ...ALL_GENRES].map((g) =>
        `<button class="g-tile focusable${(g === "All" ? !feed.genre : feed.genre === g) ? " here" : ""}" data-genre="${g}">${GENRE_ICONS[g]}${g === "All" ? "Everything" : g}</button>`).join("")}</div>`;
    } else if (section === "search") {
      c.innerHTML = `<div class="search-box focusable" id="search-box">${ICON.search}<input id="search-input" placeholder="Search films, directors, actors, moods" value="${esc(browse.query)}" spellcheck="false" autocomplete="off"></div>
        <div class="s-results" id="s-results"></div>`;
      renderResults();
      const input = $("search-input");
      input.addEventListener("input", () => { browse.query = input.value; renderResults(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          input.blur();
          const first = $("s-results").querySelector(".card");
          setFocus(first || $("search-box"));
        } else if (e.key === "Escape") {
          e.preventDefault();
          input.blur();
          setFocus($("search-box"));
        }
      });
    } else {
      const words = { watchlist: "Your saved films.", taste: "What Queue has learned about you.", reset: "Forget everything and pick your moods again." };
      c.innerHTML = `<p class="b-empty">${words[section]} Press OK to open.</p>`;
    }
    void c.offsetWidth;
    c.classList.add("enter");
  }

  function renderResults() {
    const box = $("s-results");
    if (!box) return;
    const found = rec.search(browse.query);
    box.innerHTML = found.length ? found.map((m) => cardHtml(m)).join("")
      : browse.query ? `<p class="b-empty">Nothing matches “${esc(browse.query)}”.</p>`
      : `<p class="b-empty">Try “Nolan”, “space”, “cozy” or “Zendaya”.</p>`;
  }

  function enterContent() {
    const first = $("b-content").querySelector(".focusable");
    if (!first) return;
    browse.zone = "content";
    scope = $("b-content");
    setFocus(first);
    renderSide();
    if (first.id === "search-box") first.querySelector("input").focus();
  }

  function backToSide() {
    browse.zone = "side";
    setFocus(null);
    renderSide();
  }

  // A row longer than the screen slides so the focused card stays in view.
  function scrollRow(el) {
    const row = el.parentElement;
    if (!row.classList.contains("b-row")) return;
    const i = [...row.children].indexOf(el);
    row.style.transform = `translateX(${-Math.max(0, i - 2) * (el.offsetWidth + 24)}px)`;
  }

  function browseKey(key) {
    if (browse.zone === "side") {
      const n = SIDE.length;
      if (key === "up" || key === "down") {
        browse.sideIndex = (browse.sideIndex + (key === "down" ? 1 : n - 1)) % n;
        browse.confirmReset = false;
        renderSide();
        renderSection(SIDE[browse.sideIndex][0]);
      } else if (key === "ok" || key === "right") {
        const sec = SIDE[browse.sideIndex][0];
        if (sec === "watchlist" || sec === "taste") { if (key === "ok") openPanel(sec, "browse"); }
        else if (sec === "reset") { if (key === "ok") startOver(); }
        else enterContent();
      } else if (key === "back") startFeed(false);
      return;
    }
    // content
    if (key === "back") return backToSide();
    if (key === "ok") {
      if (!focused) return;
      if (focused.id === "search-box") return focused.querySelector("input").focus();
      if (focused.dataset.genre) {
        const g = focused.dataset.genre;
        setGenre(g === "All" ? null : g);
        return startFeed(false);
      }
      return playFilm(focused.dataset.id, browse.section === "search" ? "From your search" : null);
    }
    if (key === "mute") return;
    if (!moveFocus(key) && key === "left") return backToSide();
    if (focused) scrollRow(focused);
  }

  function setGenre(g) {
    feed.genre = g;
    $("filter").innerHTML = g ? `${GENRE_ICONS[g]}${g}` : "";
    feed.history = feed.history.slice(0, feed.index + 1);
    feed.index = feed.history.length - 1;
    next();
    toast(g ? `Only ${g.toLowerCase()} for now` : "Back to everything");
  }

  function startOver() {
    if (!browse.confirmReset) { browse.confirmReset = true; renderSide(); return; }
    rec.reset();
    feed.history = []; feed.index = -1; feed.genre = null;
    $("filter").innerHTML = "";
    showGenres();
  }

  // ---------- light panels ----------
  let panelReturn = "feed";
  function openPanel(kind, returnTo) {
    panelReturn = returnTo;
    showScreen(kind);
    mode = kind;
    const back = `<span class="p-hint"><kbd>Back</kbd> Return</span>`;
    const el = $(kind);
    if (kind === "watchlist") {
      const films = rec.watchlist.map((id) => rec.byId[id]).filter(Boolean);
      el.innerHTML = `${back}<h1 class="p-title">Your watchlist</h1>
        <p class="p-sub">${films.length} ${films.length === 1 ? "movie" : "movies"}</p>
        ${films.length ? `<div class="poster-grid"></div>` : `<p class="p-empty">Nothing saved yet. On any clip, press → then Watchlist.</p>`}`;
      const grid = el.querySelector(".poster-grid");
      if (grid) for (const m of films) grid.append(posterEl(m));
      scope = el;
      setFocus(el.querySelector(".focusable"));
    } else {
      const s = rec.summary();
      const initials = (name) => name.split(/[\s&,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
      el.innerHTML = `${back}
        <h1 class="p-title">Your taste</h1>
        <p class="p-sub">Here's what we've learned so far</p>
        <div class="stats-pill">
          <div class="love">${ICONS.heart}<div><b>${s.loved}</b><span>Loved</span></div></div>
          <div>${ICONS.x}<div><b>${s.skipped}</b><span>Skipped</span></div></div>
          <div>${ICONS.bookmark}<div><b>${s.saved}</b><span>Saved</span></div></div>
        </div>
        <div class="taste-cols">
          <div class="t-col"><h3>Genres</h3><div class="t-card t-bars">
            ${s.genres.length ? s.genres.map((g, i) => `<div class="t-bar"><span>${esc(g.name)}</span>
              <span class="track"><i style="width:${Math.max(4, g.pct * 2)}%;background:${BAR_COLOURS[i % BAR_COLOURS.length]}"></i></span><b>${g.pct}%</b></div>`).join("")
              : `<p class="t-none">Love a few clips and this fills in.</p>`}
          </div></div>
          <div class="t-col"><h3>Your vibes</h3><div class="t-card t-chips">
            ${s.vibes.map((v) => `<span>${esc(v.name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()))}</span>`).join("") || `<p class="t-none">Nothing yet.</p>`}
          </div></div>
          <div class="t-col"><h3>Top directors</h3><div class="t-card t-dirs">
            ${s.directors.map((d, i) => `<div class="t-dir"><i style="background:${AVATAR_COLOURS[i]}">${esc(initials(d.name))}</i>${esc(d.name)}</div>`).join("") || `<p class="t-none">Nothing yet.</p>`}
          </div></div>
        </div>`;
      scope = el;
      setFocus(null);
    }
  }

  function closePanel() {
    if (panelReturn === "browse") openBrowse(browse.section === "watchlist" || browse.section === "taste" ? browse.section : "foryou");
    else startFeed(false);
  }

  // Play a film's clip next in the feed.
  function playFilm(id, reason) {
    const m = rec.byId[id];
    if (!m) return;
    const s = rec.score(m, null);
    const item = { movie: m, match: rec.match(s), reason: reason || rec.reason(m, s, null), judged: true };
    feed.history.splice(feed.index + 1, 0, item);
    leaveCurrent();
    feed.index++;
    showScreen("feed");
    mode = "feed";
    renderNav();
    show("next");
  }

  // ---------- input ----------
  TV.onKey((key) => {
    switch (mode) {
      case "genres":
      case "seeds":
        if (key === "ok") activateOnboard(focused);
        else if (key === "back") { if (mode === "seeds") showGenres(); else TV.exitApp(); }
        else if (key !== "mute") moveFocus(key);
        break;
      case "feed":
        if (key === "down") next();
        else if (key === "up") prev();
        else if (key === "ok") love();
        else if (key === "right") { mode = "rail"; railIndex = 0; renderRail(); }
        else if (key === "left") { mode = "nav"; navIndex = 0; renderNav(); }
        else if (key === "mute") toggleSound();
        else if (key === "back") { pausePlayer(); TV.exitApp(); }
        break;
      case "rail": {
        const n = $("rail").children.length;
        if (key === "up") railIndex = (railIndex + n - 1) % n;
        else if (key === "down") railIndex = (railIndex + 1) % n;
        else if (key === "left" || key === "back") mode = "feed";
        else if (key === "ok") ACTIONS[$("rail").children[railIndex].dataset.act]();
        else if (key === "mute") toggleSound();
        renderRail();
        break;
      }
      case "nav": {
        const btns = $("nav").children, n = btns.length;
        if (key === "up") navIndex = (navIndex + n - 1) % n;
        else if (key === "down") navIndex = (navIndex + 1) % n;
        else if (key === "right" || key === "back") mode = "feed";
        else if (key === "ok") return navGo(btns[navIndex].dataset.go);
        renderNav();
        break;
      }
      case "browse":
        browseKey(key);
        break;
      case "watchlist":
      case "taste":
        if (key === "back") closePanel();
        else if (key === "ok" && focused) playFilm(focused.dataset.id, "From your watchlist");
        else if (key !== "mute") moveFocus(key);
        break;
    }
  });

  // Mouse and trackpad, for trying the sample in a browser.
  document.addEventListener("click", (e) => {
    const rail = e.target.closest(".rail-btn");
    if (rail) return ACTIONS[rail.dataset.act]();
    const nav = e.target.closest(".nav-btn");
    if (nav) return navGo(nav.dataset.go);
    const side = e.target.closest(".b-item");
    if (side) {
      browse.sideIndex = SIDE.findIndex((s) => s[0] === side.dataset.sec);
      browse.zone = "side";
      renderSection(side.dataset.sec);
      return browseKey("ok");
    }
    const el = e.target.closest(".focusable");
    if (!el) return;
    setFocus(el);
    if (mode === "browse") { browse.zone = "content"; return browseKey("ok"); }
    if (mode === "watchlist") return playFilm(el.dataset.id, "From your watchlist");
    if (mode === "genres" || mode === "seeds") activateOnboard(el);
  });
  let wheelAt = 0;
  document.addEventListener("wheel", (e) => {
    if (mode !== "feed" || Date.now() - wheelAt < 700 || Math.abs(e.deltaY) < 20) return;
    wheelAt = Date.now();
    if (e.deltaY > 0) next(); else prev();
  }, { passive: true });

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "vtv:pause") pausePlayer();
    if (e.data && e.data.type === "vtv:resume" && mode === "feed") resumePlayer();
  });
  // On the TV the native app sends these when Queue goes to the background and comes back.
  window.addEventListener("vtv:pause", pausePlayer);
  window.addEventListener("vtv:resume", () => { if (mode === "feed") resumePlayer(); });

  // Opened from the home screen's banner (queue/index.html?film=<id>): start on that film.
  const film = rec.byId[new URLSearchParams(location.search).get("film")];
  if (film) {
    const s = rec.score(film, null);
    feed.history.push({ movie: film, match: rec.match(s), reason: rec.reason(film, s, null) });
    startFeed(false);
  } else if (rec.onboarded) startFeed(false);
  else showGenres();
})();
