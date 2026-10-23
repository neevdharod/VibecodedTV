// Line icons, 24x24, stroked with currentColor.
window.ICONS = (function () {
  const svg = (body, extra = "") =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
  return {
    // "IMDb 8.4 · 800K": the badge, the rating and the vote count (from tools/update_ratings.py).
    imdb(m) {
      const v = m.votes || 0;
      const votes = v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v ? String(v) : "";
      return `<span class="imdb"><b>IMDb</b>${m.rating.toFixed(1)}${votes ? `<small>${votes}</small>` : ""}</span>`;
    },
    cert(m) { return m.cert ? `<span class="cert">${m.cert}</span>` : ""; },
    heart: svg('<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2.1 0 3.8 1.2 5 3 1.2-1.8 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>'),
    soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    star: svg('<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="currentColor" stroke="none"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
    bookmark: svg('<path d="M6 4h12v16l-6-4-6 4z"/>'),
    wifi: svg('<path d="M2.5 9a14 14 0 0119 0M5.5 12.2a9.5 9.5 0 0113 0M8.6 15.4a5 5 0 016.8 0"/><circle cx="12" cy="18.6" r="1" fill="currentColor"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    input: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    mirror: svg('<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><rect x="15" y="9" width="6.5" height="11" rx="1.5"/><path d="M6 18h6"/>'),
    bolt: svg('<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/>'),
    grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    tv: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 3l4 3 4-3"/>'),
    play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
    reset: svg('<path d="M4 12a8 8 0 108-8 8.4 8.4 0 00-5.8 2.4L4 8.5"/><path d="M4 4v4.5h4.5"/>'),
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    cable: svg('<path d="M7 3v5M11 3v5M5 8h8v3a4 4 0 01-8 0zM9 15v3a3 3 0 006 0V9a3 3 0 016 0v12"/>'),
  };
})();
