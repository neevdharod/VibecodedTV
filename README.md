# VibecodedTV

My own take on [cleanyourtv](https://github.com/Gathin23/cleanyourtv) (MIT, see `LICENSE-cleanyourtv`):
the same debloat-over-Wi-Fi approach for an Android TV / Google TV, plus a sharper home screen and
two add-ons of my own.

| Part | What it is | Where |
|---|---|---|
| **Home** | Apple TV-style home screen: a dock of your apps, and a Top Shelf that fills the screen with recommended titles for whichever streaming app is highlighted | `launcher/` (native Android, forked from cleanyourtv), Apple TV mode |
| **Queue** | A straight-to-feed recommender: one full-screen cover at a time with the title, IMDb rating, a short description and why it was picked. Up/Down to browse, OK to watch it in the right app | `launcher/` (`QueueActivity`), catalog built by `tools/build_catalog.py` |
| **Mirror Boost** | Makes iPhone → TV AirPlay mirroring less laggy | `tools/mirror_boost.py`, and on the TV in `tvapp/` |
| **Debloat** | Disable ads, telemetry and junk with `pm disable-user`, with a one-line restore | Upstream `tools/` and `PROMPT.md` workflow, unchanged |

Everything on the TV is native, because the first version (a web app in a WebView, still in `web/`
and `tvapp/`) was far too slow on this TV's 32-bit MediaTek chip. Measured with `dumpsys gfxinfo`:
Home draws a frame in about 6 ms and Queue's slide in about 18 ms (60 fps is 16.7 ms).

## Update the TV

```bash
tools/update_tv.sh              # build, install and pre-compile Home + Queue, keep it as Home
tools/update_tv.sh --catalog    # ...and refresh Queue's titles and ratings
```

The TV's address is read from `tools/.tv_host` (gitignored) or `TV_HOST`. The script wakes the TV,
runs `launcher/build-and-install.sh` (release build, R8-optimised, compiled ahead of time on the TV),
and halves Android's window animations so apps open and close faster (`--normal-animations` undoes it).

## Home

| | |
|---|---|
| **Dock** | Queue, Netflix, Prime Video, Disney+, ESPN; the rest of your apps sit in the grid below. Up from the dock opens the top menu (inputs, settings). |
| **Top Shelf** | Highlight Queue, Netflix, Prime Video or Disney+ and the screen behind the dock becomes a full, bright backdrop with the title's logo: IMDb's newest hits (this year or last) and biggest hits (most-rated classics) on that service, in turn, a different handful each day. It moves on every 8 seconds; each app shows its own titles. The dock sits on frosted glass. No anime (`SKIP_ANIME` in `tools/build_catalog.py`). |
| **Rearrange apps** | Hold OK on an app → **Move**, arrows to carry it, Back to put it down. Hold OK → **Add to dock** / **Replace in dock** to change the dock. |

## Queue

No genres to pick and no trailers: it opens straight into the feed.

| Remote | |
|---|---|
| Up / Down | Next / previous title (a 0.2 s slide) |
| OK | Open it in Netflix, Prime Video or Disney+ (straight to the title where we know its id; otherwise the app's search or start screen, with a hint), or Love it if it isn't on your services |
| Right | Love / Not for me / Watchlist |
| Back | Home |

**The catalog** (`tools/build_catalog.py`, about 1,100 films and shows) comes from TMDB (art,
descriptions, genres, cast, age ratings, and which services carry each title in the US), IMDb's
official ratings file (rating and votes on every card), and Wikidata (each title's id on Netflix,
Prime Video and Disney+, for direct links). The TMDB key lives in `tools/.tmdb_key`, never in the repo.

**How it picks.** Each title is a feature vector (genres, keywords, director/creator, cast, decade,
film or show). Your taste is the weighted sum of what you reacted to: Love +2.0, Watchlist +1.2,
stayed on a card 12 s+ +0.3, skipped within 4 s −0.35, Not for me −0.9, all fading slowly. A title
scores `3.5 × similarity × confidence + 0.6 × (IMDb rating − 7.2)`, plus a bonus when your watch
history led to it, a bonus when one of your apps has it, and a little exploration; the next card
avoids being too like the last three. It all runs on the TV.

**Your Prime Video history** makes it personal ("Because you watched …"):

1. Sign in to Amazon in a browser and open https://www.amazon.com/gp/video/settings/watch-history.
2. Run `tools/prime_history.js` in that tab (developer console); save what it returns as a file.
3. `python3 -I tools/import_prime_history.py <file>` writes `data/prime_history.json` (gitignored).
4. `tools/refresh_queue.sh` rebuilds the catalog around your history and pushes it to the TV.

This product uses the TMDB API but is not endorsed or certified by TMDB. Ratings: information
courtesy of IMDb (https://www.imdb.com), used under IMDb's non-commercial datasets terms; this
project is personal and not affiliated with IMDb.

## Mirror Boost: what actually helps

iPhone mirroring goes iPhone → router → TV, and the TV decodes a live video stream. In order of impact:

1. **For videos, don't mirror.** Tap the AirPlay icon inside the app (YouTube, Photos, Netflix). The
   TV fetches the video itself, in full quality and with no lag.
2. **Network.** TV on Ethernet (one wireless hop instead of two), or both devices on 5 GHz.
3. **Picture mode.** Game mode / low latency, and motion smoothing off. Up to ~100 ms on some sets.
4. **Background scanning.** Wi-Fi and Bluetooth scans pause the radio briefly → stutter.
5. **Background apps and memory**, and the receiver's own settings (1080p + hardware decoding).

`tools/mirror_boost.py` does 4 and 5 for you and reports the rest:

```bash
TV_HOST=<tv ip> tools/venv/bin/python -I tools/mirror_boost.py --check     # read-only report
TV_HOST=<tv ip> tools/venv/bin/python -I tools/mirror_boost.py --boost     # apply, then open the receiver
TV_HOST=<tv ip> tools/venv/bin/python -I tools/mirror_boost.py --restore   # undo everything
python3 -I tools/test_mirror_boost.py                                      # tests, no TV needed
```

## The first version (web)

`web/` is the original browser sample (frosted-glass home, trailer-feed Queue, Mirror Boost screen):
`python3 tools/serve_sample.py`, then http://localhost:8765, arrow keys as the remote. `tvapp/` wraps
it in a WebView app; on the TV it now only provides **Mirror Boost** (`tools/install_tvapp.sh`).
`docs/UI_PROMPTS.md` has prompts for asking another AI for alternative UI directions.

What was done to the Sony, with measurements, is in `devices/sony-xbr-75x850f/README.md`.
