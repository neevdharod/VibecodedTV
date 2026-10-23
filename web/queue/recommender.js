// Queue's recommender: a small content-based model that learns from what you like, pass on and
// watch, blended with a "good movie" quality prior and a little exploration. It runs entirely on
// the TV; nothing leaves the device.
//
// Each film is a sparse feature vector (genres, vibe tags, director, decade). Your taste is a
// weighted sum of the vectors of films you reacted to. A candidate's score is
//
//   3.5 x taste-similarity x confidence  +  0.6 x (rating - 7.3)  +  genre filter  +  exploration
//
// and the next clip is picked greedily with a diversity penalty, so the feed doesn't serve three
// films by the same director in a row.
(function () {
  const FEATURE_WEIGHT = { g: 1.0, t: 0.6, d: 0.9, y: 0.25 };
  // How much each reaction moves your taste. Implicit signals (dwell time) count, but less.
  const EVENT_WEIGHT = { love: 2.0, like: 1.0, save: 1.2, watched: 0.3, bounce: -0.35, pass: -0.9 };
  const DECAY = 0.985;           // older reactions fade a little with every new one
  const STORAGE_KEY = "queue.v1";

  function features(m) {
    const f = {};
    for (const g of m.genres) f["g:" + g] = FEATURE_WEIGHT.g;
    for (const t of m.tags) f["t:" + t] = FEATURE_WEIGHT.t;
    f["d:" + m.director] = FEATURE_WEIGHT.d;
    f["y:" + Math.floor(m.year / 10) * 10 + "s"] = FEATURE_WEIGHT.y;
    return f;
  }

  function norm(v) {
    let s = 0;
    for (const k in v) s += v[k] * v[k];
    return Math.sqrt(s);
  }

  function cosine(a, b) {
    let dot = 0;
    for (const k in a) if (k in b) dot += a[k] * b[k];
    const n = norm(a) * norm(b);
    return n ? dot / n : 0;
  }

  // Box-Muller, seeded per film and per session so a film's noise is stable while you browse.
  function noise(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    const u1 = ((h >>> 0) % 100000) / 100000 + 1e-6;
    const u2 = ((Math.imul(h, 2654435761) >>> 0) % 100000) / 100000;
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(-1.8, Math.min(1.8, n));
  }

  class Recommender {
    constructor(catalog, storage = window.localStorage) {
      this.catalog = catalog;
      this.byId = Object.fromEntries(catalog.map((m) => [m.id, m]));
      this.vec = Object.fromEntries(catalog.map((m) => [m.id, features(m)]));
      this.storage = storage;
      this.session = String(Date.now());
      this.load();
    }

    load() {
      let s = {};
      try { s = JSON.parse(this.storage.getItem(STORAGE_KEY)) || {}; } catch (e) { /* first run */ }
      this.taste = s.taste || {};
      this.reactions = s.reactions || {};   // id -> last explicit reaction (love/like/save/pass)
      this.seen = new Set(s.seen || []);
      this.watchlist = s.watchlist || [];
      this.moods = s.moods || [];            // genres picked during onboarding
      this.events = s.events || 0;
      this.progress = s.progress || {};      // id -> how far into its clip you got (0-1)
      this.recent = s.recent || [];          // ids, most recently watched first
      this.skipped = s.skipped || 0;
    }

    save() {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify({
          taste: this.taste, reactions: this.reactions, seen: [...this.seen],
          watchlist: this.watchlist, moods: this.moods, events: this.events,
          progress: this.progress, recent: this.recent, skipped: this.skipped,
        }));
      } catch (e) { /* storage full or blocked: keep working in memory */ }
    }

    get onboarded() { return this.moods.length > 0; }

    reset() {
      this.taste = {}; this.reactions = {}; this.seen = new Set();
      this.watchlist = []; this.moods = []; this.events = 0;
      this.progress = {}; this.recent = []; this.skipped = 0;
      this.save();
    }

    // Remember how far into a clip you got, for "Continue watching".
    setProgress(id, fraction) {
      this.progress[id] = Math.max(0, Math.min(1, fraction));
      this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 20);
      this.save();
    }

    // Clips you started but didn't finish (and didn't pass on), most recent first.
    continueWatching(n = 6) {
      return this.recent
        .filter((id) => this.byId[id] && this.reactions[id] !== "pass" && this.progress[id] > 0.08 && this.progress[id] < 0.92)
        .slice(0, n)
        .map((id) => ({ movie: this.byId[id], progress: this.progress[id] }));
    }

    // Films whose title, director, cast, genres or vibe match the text.
    search(text, n = 12) {
      const q = text.trim().toLowerCase();
      if (!q) return [];
      const hay = (m) => [m.title, m.director, m.cast, ...m.genres, ...m.tags].join(" ").toLowerCase();
      return this.catalog
        .filter((m) => hay(m).includes(q))
        .sort((a, b) => (b.title.toLowerCase().startsWith(q) - a.title.toLowerCase().startsWith(q)) || b.rating - a.rating)
        .slice(0, n);
    }

    setMoods(genres) {
      this.moods = genres;
      for (const g of genres) this.taste["g:" + g] = (this.taste["g:" + g] || 0) + 1.5;
      this.save();
    }

    record(id, kind) {
      const w = EVENT_WEIGHT[kind];
      if (w === undefined) return;
      for (const k in this.taste) this.taste[k] *= DECAY;
      const f = this.vec[id];
      for (const k in f) this.taste[k] = (this.taste[k] || 0) + w * f[k];
      if (kind === "love" || kind === "like" || kind === "pass") this.reactions[id] = kind;
      if (kind === "pass" || kind === "bounce") this.skipped++;
      this.seen.add(id);
      this.events++;
      this.save();
    }

    // Take back an explicit reaction (pressing Love a second time).
    undo(id) {
      const kind = this.reactions[id];
      if (!kind) return;
      const f = this.vec[id];
      for (const k in f) this.taste[k] = (this.taste[k] || 0) - EVENT_WEIGHT[kind] * f[k];
      delete this.reactions[id];
      this.save();
    }

    // The two strongest things a film says about your taste, for "Got it: more ..." feedback.
    traits(id) {
      const m = this.byId[id];
      return { genre: m.genres[0], vibe: m.tags[0] };
    }

    toggleWatchlist(id) {
      const i = this.watchlist.indexOf(id);
      if (i >= 0) this.watchlist.splice(i, 1);
      else { this.watchlist.unshift(id); this.record(id, "save"); }
      this.save();
      return i < 0;
    }

    liked() {
      return Object.keys(this.reactions).filter((id) => this.reactions[id] !== "pass");
    }

    // Score one film. Returns the parts too, so the UI can explain itself.
    score(m, genre) {
      const conf = Math.min(1, this.events / 6 + (this.moods.length ? 0.35 : 0));
      const affinity = cosine(this.taste, this.vec[m.id]);
      const quality = (m.rating - 7.3) * 0.6;
      const filter = genre ? (m.genres.includes(genre) ? 0.6 : -Infinity) : 0;
      const explore = (0.45 / Math.sqrt(1 + this.events)) * noise(m.id + this.session);
      // The moods picked at the start steer the first clips, then hand over to what you actually do.
      const mood = m.genres.some((g) => this.moods.includes(g)) ? 0.9 * Math.max(0, 1 - this.events / 15) : 0;
      return { total: 3.5 * affinity * conf + quality + filter + explore + mood, affinity, quality, explore };
    }

    // The next `n` films, best first, skipping anything already seen.
    queue(n, { genre = null, recent = [], exclude = [] } = {}) {
      const skip = new Set([...this.seen, ...exclude]);
      let pool = this.catalog.filter((m) => !skip.has(m.id) && (!genre || m.genres.includes(genre)));
      if (pool.length < n) {
        // Ran out of unseen films: let the ones you didn't pass on come back around.
        pool = this.catalog.filter((m) => this.reactions[m.id] !== "pass" && !exclude.includes(m.id)
          && (!genre || m.genres.includes(genre)));
      }
      const scored = pool.map((m) => ({ m, s: this.score(m, genre) }));
      const picked = [];
      const context = recent.map((id) => this.vec[id]).filter(Boolean);
      while (picked.length < n && scored.length) {
        let best = -1, bestVal = -Infinity;
        for (let i = 0; i < scored.length; i++) {
          const last = context.slice(-3);
          const crowd = last.length ? Math.max(...last.map((v) => cosine(v, this.vec[scored[i].m.id]))) : 0;
          const val = scored[i].s.total - 1.1 * crowd;
          if (val > bestVal) { bestVal = val; best = i; }
        }
        const [{ m, s }] = scored.splice(best, 1);
        picked.push({ movie: m, score: s, match: this.match(s), reason: this.reason(m, s, genre) });
        context.push(this.vec[m.id]);
      }
      return picked;
    }

    match(s) {
      const x = 1 / (1 + Math.exp(-(s.total * 1.1 - 0.2)));
      return Math.round(62 + 37 * x);
    }

    reason(m, s, genre) {
      const sims = this.liked()
        .filter((id) => id !== m.id && this.byId[id])
        .map((id) => ({ id, sim: cosine(this.vec[id], this.vec[m.id]) }))
        .filter((x) => x.sim > 0.32)
        .sort((a, b) => b.sim - a.sim);
      if (sims.length >= 2) return `Because you liked ${this.byId[sims[0].id].title} and ${this.byId[sims[1].id].title}`;
      if (sims.length === 1) return `Because you liked ${this.byId[sims[0].id].title}`;
      if (s.explore > 0.25 && s.affinity < 0.25 && this.events > 2) return "Something a little different";
      if (genre) return `Top-rated ${genre.toLowerCase()}`;
      const mood = m.genres.find((g) => this.moods.includes(g));
      if (mood) return `A highly rated ${mood.toLowerCase()} pick`;
      return "Critically loved";
    }

    // Top learned preferences, for the "Your taste" screen.
    summary() {
      const groups = { g: [], t: [], d: [] };
      for (const k in this.taste) {
        const [kind, name] = [k[0], k.slice(2)];
        if (groups[kind] && this.taste[k] > 0.15) groups[kind].push({ name, w: this.taste[k] });
      }
      for (const k in groups) groups[k].sort((a, b) => b.w - a.w);
      const counts = { love: 0, like: 0, pass: 0 };
      for (const id in this.reactions) counts[this.reactions[id]]++;
      // Each genre's share of everything you lean towards, as a percentage.
      const total = groups.g.reduce((sum, g) => sum + g.w, 0) || 1;
      for (const g of groups.g) g.pct = Math.round((100 * g.w) / total);
      return {
        genres: groups.g.slice(0, 5), vibes: groups.t.slice(0, 8), directors: groups.d.slice(0, 3), counts,
        loved: counts.love + counts.like, skipped: this.skipped, saved: this.watchlist.length,
      };
    }
  }

  window.Recommender = Recommender;
})();
