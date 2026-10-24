# UI timings, 2026-10-23 22:41

Frame times from `dumpsys gfxinfo` (16.7 ms = 60 fps); starts from `am start -W`.

| Action | Frames | Median | 90th % | 99th % | Slow frames |
|---|---:|---:|---:|---:|---:|
| Home: move along the dock and back (8 moves) | 489 | 6 ms | 10 ms | 20 ms | 4% |
| Home: Top Shelf changes title by itself (20 s idle) | 100 | 5 ms | 6 ms | 7 ms | 0% |
| Home: down into the app grid and back up | 147 | 7 ms | 24 ms | 28 ms | 21% |
| Home: open the top menu (Up); the app menu is the same popup | 5 | 8 ms | 61 ms | 61 ms | 40% |
| Home: sitting idle (10 s) | 50 | 5 ms | 7 ms | 11 ms | 0% |
| Queue: next title (8 times) | 105 | 8 ms | 18 ms | 23 ms | 24% |
| Queue: previous title (3 times) | 39 | 6 ms | 8 ms | 11 ms | 0% |
| Queue: side buttons (Love, Not for me, Watchlist) and back | 61 | 6 ms | 8 ms | 10 ms | 0% |
| Queue: Back to Home | 34 | 5 ms | 23 ms | 29 ms | 14% |

| Start | Time to first frame |
|---|---:|
| Home, cold start (after a reboot or update) | 730 ms |
| Open Queue | 127 ms |
| Open Netflix | - |
| Open Prime Video | 138 ms |
| Open Disney+ | 478 ms |
| Home button from an app (Home already running) | 0 ms |

Home's CPU use while idle: 0.0%
