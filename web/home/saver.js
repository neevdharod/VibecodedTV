// Screensaver. "film" pans slowly across film art from your picks, like Apple TV's aerials;
// "clock" is a large clock that moves every minute so nothing burns in; "backdrop" just lets
// the backdrop drift with a small clock. Any key wakes the TV.
window.Saver = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let timers = [], active = false;

  function clockText(d = new Date()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: Prefs.get("clock") === 12 })
      .replace(/\s?[AP]M$/i, "");
  }

  function every(ms, fn) { fn(); timers.push(setInterval(fn, ms)); }

  function film(el, films) {
    el.className = "saver film";
    el.innerHTML = `<div class="shot"></div><div class="shot"></div><div class="cap"></div><div class="s-clock"></div>`;
    const shots = el.querySelectorAll(".shot");
    let i = 0, flip = 0;
    every(12000, () => {
      const m = films[i++ % films.length];
      const next = shots[flip ^= 1], prev = shots[flip ^ 1];
      const a = Banner.art(m);
      next.style.backgroundImage = `url("${a.url}")`;
      next.classList.toggle("still", a.kind === "still");
      next.classList.remove("on");
      void next.offsetWidth;
      next.classList.add("on");
      prev.classList.remove("on");
      el.querySelector(".cap").innerHTML = `<span>Queue · ${m.year}</span><b>${esc(m.title)}</b>`;
    });
    every(10000, () => { el.querySelector(".s-clock").textContent = clockText(); });
  }

  function clock(el) {
    el.className = "saver clock";
    el.innerHTML = `<div class="big"><b></b><span></span></div>`;
    const big = el.querySelector(".big");
    every(60000, () => {
      big.style.left = `${120 + Math.random() * 1000}px`;
      big.style.top = `${120 + Math.random() * 560}px`;
    });
    every(5000, () => {
      big.querySelector("b").textContent = clockText();
      big.querySelector("span").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    });
  }

  function backdrop(el) {
    el.className = "saver backdrop-only";
    el.innerHTML = `<div class="s-clock"></div>`;
    every(10000, () => { el.querySelector(".s-clock").textContent = clockText(); });
  }

  return {
    get active() { return active; },
    start(type, films) {
      if (active || type === "off") return;
      active = true;
      const el = $("saver");
      el.hidden = false;
      const pool = films.filter((m) => m.still || (m.hd && !m.branded));
      if (type === "film" && pool.length) film(el, pool);
      else if (type === "backdrop") backdrop(el);
      else clock(el);
    },
    stop() {
      if (!active) return false;
      timers.forEach(clearInterval);
      timers = [];
      active = false;
      const el = $("saver");
      el.hidden = true;
      el.innerHTML = "";
      return true;
    },
  };
})();
