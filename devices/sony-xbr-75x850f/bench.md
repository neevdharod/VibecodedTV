# UI timings, 2026-10-23 22:17

Frame times from `dumpsys gfxinfo` (16.7 ms = 60 fps); starts from `am start -W`.

| Action | Frames | Median | 90th % | 99th % | Slow frames |
|---|---:|---:|---:|---:|---:|
| Home: move along the dock and back (8 moves) | 437 | 17 ms | 27 ms | 101 ms | 53% |
| Home: Top Shelf changes title by itself (20 s idle) | 100 | 6 ms | 7 ms | 9 ms | 0% |
| Home: down into the app grid and back up | 147 | 11 ms | 18 ms | 20 ms | 43% |
| Home: open the app menu (Move, Replace) | 14 | 17 ms | 22 ms | 24 ms | 78% |
| Home: open the top menu (Up) | 52 | 32 ms | 44 ms | 117 ms | 90% |
| Home: sitting idle (10 s) | 50 | 17 ms | 18 ms | 93 ms | 72% |
| Queue: next title (8 times) | 105 | 14 ms | 19 ms | 24 ms | 48% |
| Queue: previous title (3 times) | 39 | 6 ms | 8 ms | 11 ms | 0% |
| Queue: side buttons (Love, Not for me, Watchlist) and back | 60 | 5 ms | 7 ms | 11 ms | 0% |
| Queue: Back to Home | 33 | 18 ms | 36 ms | 48 ms | 93% |

| Start | Time to first frame |
|---|---:|
| Home, cold start (after a reboot or update) | 880 ms |
| Open Queue | 153 ms |
| Open Netflix | - |
| Open Prime Video | 145 ms |
| Open Disney+ | 414 ms |
| Home button from an app (Home already running) | 0 ms |

Home's CPU use while idle: 0.0%
