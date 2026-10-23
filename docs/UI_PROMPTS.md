# Prompts for exploring other UI directions

Paste one of these into another AI (Claude, ChatGPT, Gemini, v0, etc.). Each asks for **three very
different design directions** as standalone HTML files you can open in a browser and drive with the
arrow keys, so you can compare them side by side with the current sample (`python3 tools/serve_sample.py`).

If you have screenshots of a look you like (like the Instagram reel), attach them along with the prompt.

---

## Prompt 1: the TV home screen (the general app)

```
I'm building a custom home screen (launcher) for my Android TV / Google TV. Design THREE visually
distinct directions for it, each as a single self-contained HTML file (inline CSS and vanilla JS, no
frameworks, Google Fonts allowed). I'll open them in a desktop browser to compare.

THE DEVICE AND HOW IT'S USED
- A 55-65" TV viewed from ~3 metres. Lay everything out on a fixed 1920x1080 canvas and scale it to fit
  the browser window (letterboxed), so pixel values are TV pixels.
- Controlled ONLY with a TV remote: arrow keys, OK (Enter), Back (Escape/Backspace). No mouse, no
  hover, no touch. Every interactive thing must be reachable with arrows, and there must always be
  exactly one clearly focused element. Focus must be obvious from across the room (scale, ring, lift,
  glow: your call, but unmistakable).
- Keep content inside a 5% safe margin (96px sides, 54px top/bottom) because TVs crop the edges.
- Minimum body text 22px, labels 18px at 1920x1080. High contrast. Dark UI (it's watched in dim rooms).
- Motion should feel smooth and physical but quick (150-450ms). No continuous distracting animation.

WHAT THE SCREEN CONTAINS
- Clock, date and a short greeting.
- Status pills: network (e.g. "Home-5G"), Inputs, Settings.
- A dock of 6 favourite apps: Queue (my movie-discovery app), Mirror Boost (my iPhone mirroring helper),
  Netflix, YouTube, Prime Video, Disney+. Use simple typographic wordmarks in each brand's colour,
  not real logos.
- A second row: PlayStation 5 (HDMI 1), Live TV, Spotify, Plex, All apps, Settings.
- A large "hero" area that changes with focus. When Queue is focused, it shows tonight's recommended
  film: title, "98% match", a reason like "Because you liked Arrival and Interstellar", rating, genres,
  runtime, a one-line blurb, and full-bleed film artwork behind it. For other apps, show something
  appropriate (a colour mood for streaming apps; "Lag-free mirroring, readiness 38/100" for Mirror Boost).
- For artwork, use these real image URLs:
  https://i.ytimg.com/vi/Way9Dexny3w/maxresdefault.jpg  (Dune: Part Two)
  https://i.ytimg.com/vi/tFMo3UJ4B4g/maxresdefault.jpg  (Arrival)
  https://i.ytimg.com/vi/2LqzF5WauAw/maxresdefault.jpg  (Interstellar)

WHAT I LIKE
- Cinematic and crisp: full-bleed film artwork with a colour grade / duotone and a vignette, thin
  precise geometric type (like Outfit), hairline borders, restrained colour, lots of breathing room.
  Think premium streaming box, not a cluttered smart-TV menu. No ads, no "sponsored" rows.
- It should feel calmer and sharper than stock Google TV and closer to Apple TV, but with its own identity.

GIVE ME THREE DIRECTIONS THAT ARE GENUINELY DIFFERENT, for example:
  A) "Cinema": artwork-led, editorial typography, duotone-graded hero, minimal chrome.
  B) "Swiss grid": strict grid, big numerals, monochrome with one accent colour, zero glass or blur.
  C) "Spatial glass": layered frosted panels, depth and parallax on focus, soft light.
(Feel free to propose better ones, but don't give me three variations of the same idea.)

FOR EACH DIRECTION
- One HTML file, working arrow-key navigation between status pills, dock and second row (the second
  row can slide up when focused), OK shows a small toast like "Opens Netflix", Back returns focus to
  the dock.
- A short note at the top of the file (HTML comment) with: the direction's name, its idea in two
  sentences, the font(s) and the colour palette as CSS variables.
- Keep all colours and sizes as CSS custom properties on :root so I can tweak them.
```

---

## Prompt 2: Queue, the movie-finder app

```
I'm building "Queue", a movie-discovery app for my Android TV. It works like TikTok for film trailers:
you pick moods, then scroll a full-screen feed of 30-second trailer clips, and it learns your taste
from what you love, skip and watch through. Design THREE visually distinct directions for it, each as
a single self-contained HTML file (inline CSS and vanilla JS, no frameworks, Google Fonts allowed).

THE DEVICE AND HOW IT'S USED
- A TV viewed from ~3 metres. Fixed 1920x1080 canvas scaled to fit the browser window.
- Remote only: arrow keys, OK (Enter), Back (Escape/Backspace), plus M for mute. No mouse or hover.
  One clearly focused element at all times, obvious from across the room.
- 5% safe margins (96px sides, 54px top/bottom). Body text at least 22px. Dark UI.

SCREENS TO DESIGN (all in the one file, switchable with the remote)
1. Mood picker: "What are you in the mood for?" with 12 genres (Action, Comedy, Drama, Sci-Fi,
   Thriller, Horror, Romance, Mystery, Animation, Crime, Adventure, Documentary). Multi-select, then Continue.
2. "Any of these you already love?": a grid of ~16 film posters to multi-select, then Start watching.
3. The feed (the main screen): the trailer plays full-bleed. Over it: match % ("94% match"), the
   reason it was picked ("Because you liked Arrival"), title, year, runtime, rating, director, genres,
   a one-line blurb, and actions: Love, Not for me, Watchlist, Sound. Up/Down moves between clips
   with a vertical slide like TikTok; OK = Love (with a satisfying animation); Right = action rail;
   Left = menu. Show a clip progress bar.
4. Menu drawer: For you, a genre filter list, Watchlist, Your taste, Start over.
5. Watchlist: poster grid.
6. Your taste: what the app has learned, e.g. genre bars, "vibe" tags (mind-bending, cozy, twisty),
   favourite directors, and counts of loved / passed / saved.

DATA: use this shape and these real films so the designs plug straight into my code:
  { id, title, year, genres: [..], tags: [..], director, rating, runtime, cast, blurb,
    trailer: "<YouTube id>", poster: "<image url>" }
  - Arrival (2016), trailer tFMo3UJ4B4g, Denis Villeneuve, 7.9, 116 min, Sci-Fi/Drama/Mystery
  - Dune: Part Two (2024), trailer Way9Dexny3w, Denis Villeneuve, 8.5, 166 min, Sci-Fi/Adventure/Action
  - Interstellar (2014), trailer 2LqzF5WauAw, Christopher Nolan, 8.7, 169 min, Sci-Fi/Drama/Adventure
  - Parasite (2019), trailer isOGD_7hNIY, Bong Joon Ho, 8.5, 132 min, Thriller/Drama/Comedy
  - La La Land (2016), trailer 0pdqf4P9MB8, Damien Chazelle, 8.0, 128 min, Romance/Music/Comedy
  - Get Out (2017), trailer DzfpyUB60YY, Jordan Peele, 7.8, 104 min, Horror/Thriller/Mystery
  For backgrounds use https://i.ytimg.com/vi/<trailer id>/maxresdefault.jpg . For the real trailer,
  embed https://www.youtube-nocookie.com/embed/<id>?autoplay=1&mute=1&controls=0&start=30 (it must be
  served over http(s), so also show the still image as a fallback while it loads).

WHAT I LIKE
- Cinematic and crisp: full-bleed footage, thin precise geometric type, hairlines, restrained colour,
  a single accent colour. The overlay must stay readable over any trailer frame (scrims/gradients),
  but must not smother the video. Feels premium and fun, not like a settings menu.

GIVE ME THREE GENUINELY DIFFERENT DIRECTIONS, for example:
  A) "Vertical feed": closest to TikTok/Reels, chunky right-hand action rail, playful micro-animations.
  B) "Film festival": editorial, poster-forward, serif titles, credits-style metadata, calm.
  C) "Cockpit / data": the "why it was picked" made visual, e.g. a live taste meter, match breakdown,
     similar-film chips, showing the algorithm at work.

FOR EACH DIRECTION
- One HTML file with all six screens working by remote (arrow keys + Enter + Escape).
- An HTML comment at the top: the direction's name, its idea in two sentences, fonts and palette as
  CSS variables on :root.
- Don't invent features that need a server; everything is local and offline except the images and trailers.
```

---

## Tips

- Ask for a fourth direction if none of the three clicks, and say which parts you liked from each
  ("the hero from B, the focus style from A"). Mixing is how you get to a final look fast.
- Bring the winning file back here and I'll port it into the real sample, the recommender and,
  later, the native launcher on the TV.
