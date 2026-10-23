// Line icons for each genre, 24x24, stroked with currentColor.
window.GENRE_ICONS = (function () {
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r=".9" fill="currentColor" stroke="none"/>`;
  return {
    Action: svg('<path d="M4 4l11 11M4 4h3.5M4 4v3.5M14 17l3-3M17.5 20.5l-3-3"/><path d="M20 4L9 15M20 4h-3.5M20 4v3.5M10 17l-3-3M6.5 20.5l3-3"/>'),
    Comedy: svg(`<circle cx="12" cy="12" r="9"/><path d="M8.3 14.2a4.3 4.3 0 007.4 0"/>${dot(9, 10)}${dot(15, 10)}`),
    Drama: svg('<path d="M5 4.5h14V11a7 7 0 01-14 0z"/><path d="M8.3 9.2h2.2M13.5 9.2h2.2M9.2 14.6a3.8 3.8 0 015.6 0"/>'),
    "Sci-Fi": svg('<path d="M12 2.8c3 2.1 4.6 5.6 4.1 10.2L12 16l-4.1-3C7.4 8.4 9 4.9 12 2.8z"/><circle cx="12" cy="9.3" r="1.7"/><path d="M7.9 12.6L5 15.8l3.4.9M16.1 12.6l2.9 3.2-3.4.9M10.4 18.4L12 21.2l1.6-2.8"/>'),
    Thriller: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/>'),
    Horror: svg(`<path d="M5 20.5V11a7 7 0 0114 0v9.5l-2.4-1.7-2.3 1.7-2.3-1.7-2.3 1.7-2.3-1.7z"/>${dot(9.6, 11)}${dot(14.4, 11)}`),
    Romance: svg('<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2.1 0 3.8 1.2 5 3 1.2-1.8 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>'),
    Mystery: svg(`<circle cx="10.5" cy="10.5" r="6.8"/><path d="M15.6 15.6L21 21M8.7 8.9a1.9 1.9 0 113 1.6c-.8.5-1.2.9-1.2 1.7"/>${dot(10.5, 14.2)}`),
    Animation: svg(`<circle cx="12" cy="13.2" r="6.8"/><circle cx="6.3" cy="6.6" r="2.4"/><circle cx="17.7" cy="6.6" r="2.4"/>${dot(9.6, 12.4)}${dot(14.4, 12.4)}<path d="M10.6 16h2.8"/>`),
    Crime: svg('<path d="M12 3l7 3v5.2c0 4.8-3 8.3-7 9.8-4-1.5-7-5-7-9.8V6z"/><path d="M12 8.4l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z"/>'),
    Adventure: svg('<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>'),
    Documentary: svg('<rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3z"/>'),
    Fantasy: svg('<path d="M4.5 19.5L14 10M15 3.5v3M19.5 5l-2.1 2.1M20.5 9.5h-3M12.6 8.6l2.8 2.8"/>'),
    Music: svg('<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    Sport: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c3.6 3.6 3.6 9.2 0 12.8M18.4 5.6c-3.6 3.6-3.6 9.2 0 12.8"/>'),
    War: svg('<path d="M4.5 15a7.5 7.5 0 0115 0z"/><path d="M2.5 15h19M7 18.5h10"/>'),
    All: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  };
})();
