// Every app, input and shortcut that can sit on Home. Brand tiles use plain wordmarks in the
// service's colours (no logos); inputs and system shortcuts use an icon and a label.
window.APPS = (function () {
  const I = window.ICONS;
  const gamepad = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h10a4 4 0 014 4.3l-.5 4A2.6 2.6 0 0116 17.5L14.5 15h-5L8 17.5a2.6 2.6 0 01-4.5-1.2l-.5-4A4 4 0 017 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="17" cy="13.2" r=".6" fill="currentColor"/></svg>`;
  const word = (cls, html) => `<span class="w ${cls}">${html}</span>`;
  const sys = (icon, label, sub) => `<span class="sys">${icon}<span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span></span>`;

  const list = [
    { id: "queue", name: "Queue", kind: "app", art: word("w-queue", "Queue") },
    { id: "mirror", name: "Mirror Boost", kind: "app", art: word("w-mirror", "Mirror Boost") },
    { id: "netflix", name: "Netflix", kind: "app", art: word("w-netflix", "NETFLIX") },
    { id: "youtube", name: "YouTube", kind: "app", art: word("w-youtube", "<i></i>YouTube") },
    { id: "prime", name: "Prime Video", kind: "app", art: word("w-prime", "prime video<small></small>") },
    { id: "disney", name: "Disney+", kind: "app", art: word("w-disney", "Disney+") },
    { id: "espn", name: "ESPN", kind: "app", art: word("w-espn", "ESPN") },
    { id: "hulu", name: "Hulu", kind: "app", art: word("w-hulu", "hulu") },
    { id: "max", name: "Max", kind: "app", art: word("w-max", "max") },
    { id: "appletv", name: "Apple TV", kind: "app", art: word("w-appletv", "Apple TV") },
    { id: "twitch", name: "Twitch", kind: "app", art: word("w-twitch", "twitch") },
    { id: "crunchyroll", name: "Crunchyroll", kind: "app", art: word("w-crunchy", "crunchyroll") },
    { id: "spotify", name: "Spotify", kind: "app", art: word("w-spotify", "<i></i>Spotify") },
    { id: "plex", name: "Plex", kind: "app", art: word("w-plex", "PLE<b>X</b>") },
    { id: "ps5", name: "PS5", kind: "input", art: sys(gamepad, "PS5", "HDMI 1") },
    { id: "hdmi2", name: "HDMI 2", kind: "input", art: sys(I.input, "HDMI 2", "Nothing connected") },
    { id: "livetv", name: "Live TV", kind: "input", art: sys(I.tv, "Live TV") },
    { id: "library", name: "All apps", kind: "system", art: sys(I.grid, "All apps") },
    { id: "settings", name: "Settings", kind: "system", art: sys(I.gear, "Settings") },
  ];
  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  return { list, byId };
})();
