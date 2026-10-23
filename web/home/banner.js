// The top banner: a few slides that rotate on their own. Tonight's picks come from Queue's
// recommender; new releases are the newest films in the catalog (a TMDB "now playing" feed can
// replace that later); the watchlist slide appears once you've saved something.
window.Banner = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const runtime = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;

  let slides = [], index = 0, timer = null, paused = false, onChange = () => {};
  let front = null;

  // Art for a film: a plain frame from inside the trailer (no "OFFICIAL TRAILER" text, zoomed to
  // crop the letterbox bars), else the trailer thumbnail, else the poster (blurred).
  function art(m) {
    if (m.still) return { url: `https://i.ytimg.com/vi/${m.trailer}/maxres${m.still}.jpg`, kind: "still" };
    if (m.hd && !m.branded) return { url: `https://i.ytimg.com/vi/${m.trailer}/maxresdefault.jpg`, kind: "thumb" };
    return { url: m.poster || `https://i.ytimg.com/vi/${m.trailer}/hqdefault.jpg`, kind: "poster" };
  }

  const firstSentence = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z"])/)[0];

  function whyHtml(reason) {
    const m = /^Because you liked (.+?)(?: and (.+))?$/.exec(reason);
    if (!m) return esc(reason);
    return "Because you liked " + `<b>${esc(m[1])}</b>` + (m[2] ? ` and <b>${esc(m[2])}</b>` : "");
  }

  // The banner is mostly picture, so it only features films with clean, full-size art.
  const clean = (m) => m.still > 0;

  function build(rec, mode) {
    const picks = rec.queue(14).filter((p) => clean(p.movie)).slice(0, 3);
    const maxYear = Math.max(...rec.catalog.map((m) => m.year));
    const newest = [...rec.catalog]
      .filter((m) => m.year >= maxYear - 1 && clean(m))
      .sort((a, b) => b.year - a.year || b.rating - a.rating);
    const slide = (m, eyebrow, reason) => {
      const s = rec.score(m, null);
      return { film: m, eyebrow, match: rec.match(s), why: reason || rec.reason(m, s, null) };
    };
    const forYou = picks.map((p, i) => slide(p.movie, i === 0 ? "Tonight's pick" : "Picked for you", p.reason));
    const fresh = newest.map((m) => {
      const r = rec.reason(m, rec.score(m, null), null);
      return slide(m, m.year === maxYear ? "New release" : "Recently released", r === "Critically loved" ? `New in ${m.year}` : r);
    });
    const saved = rec.watchlist.slice(0, 1).map((id) => slide(rec.byId[id], "On your watchlist", "You saved this one"));

    let out;
    if (mode === "foryou") out = [...forYou, ...saved];
    else if (mode === "new") out = fresh.slice(0, 4);
    else out = [forYou[0], fresh[0], forYou[1], fresh[1], ...saved];
    const seen = new Set();
    return out.filter((s) => s && !seen.has(s.film.id) && seen.add(s.film.id)).slice(0, 5);
  }

  function render(dir = 1) {
    const s = slides[index];
    if (!s) return;
    const m = s.film;
    // Cross-fade the art.
    const holder = $("banner-art");
    const a = art(m);
    const layer = document.createElement("div");
    layer.className = `art ${a.kind}`;
    layer.style.backgroundImage = `url("${a.url}")`;
    holder.append(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("on")));
    if (front) { const old = front; old.classList.remove("on"); setTimeout(() => old.remove(), 1000); }
    front = layer;

    const title = m.title;
    const body = $("banner-body");
    body.classList.remove("enter");
    body.innerHTML = `
      <div class="b-eyebrow">${esc(s.eyebrow)}</div>
      <h1 class="${title.length > 28 ? "long" : title.length > 18 ? "mid" : ""}">${esc(title)}</h1>
      <div class="b-meta"><span class="match">${s.match}% match</span><span>${m.year}</span>${ICONS.cert(m)}
        <span>${runtime(m.runtime)}</span>${ICONS.imdb(m)}</div>
      <div class="b-genres">${m.genres.map(esc).join(" &nbsp;·&nbsp; ")}</div>
      <p class="b-blurb">${esc(firstSentence(m.blurb))}</p>
      <div class="b-why">${whyHtml(s.why)}</div>`;
    // Long titles take two lines; give back room from the blurb so nothing runs into the button.
    body.classList.remove("t1", "t2", "t3");
    for (const c of ["t1", "t2", "t3"]) {
      if (body.scrollHeight <= 344) break;   // room above the Watch button
      body.classList.add(c);
    }
    void body.offsetWidth;
    body.classList.add("enter");
    $("dots").innerHTML = slides.map((_, i) => `<i class="${i === index ? "on" : ""}"></i>`).join("");
    onChange(m, a);
  }

  function schedule() {
    clearInterval(timer);
    const secs = Prefs.get("rotate");
    if (secs > 0) timer = setInterval(() => { if (!paused) go(1); }, secs * 1000);
  }

  function go(step) {
    if (slides.length < 2) return;
    index = (index + step + slides.length) % slides.length;
    render(step);
  }

  return {
    // Rebuild the slides (on start, after Queue learns something, or when settings change).
    refresh(rec, keepFilm = true) {
      const current = slides[index] && slides[index].film.id;
      slides = build(rec, Prefs.get("banner"));
      const i = keepFilm ? slides.findIndex((s) => s.film.id === current) : -1;
      index = i >= 0 ? i : 0;
      render();
      schedule();
    },
    next: () => { go(1); schedule(); },
    prev: () => { go(-1); schedule(); },
    current: () => slides[index] && slides[index].film,
    films: () => slides.map((s) => s.film),
    setPaused(p) { paused = p; },
    reschedule: schedule,
    onChange(fn) { onChange = fn; },
    art,
  };
})();
