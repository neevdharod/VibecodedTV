# Sony BRAVIA XBR-75X850F

| | |
|---|---|
| Model | XBR-75X850F (2018), reports `BRAVIA 4K GB ATV3`, device `BRAVIA_ATV3_4K` |
| Software | Android TV 9 (SDK 28), build `PTT1.190515.001.S43 671651`, US |
| Network | Ethernet, 192.168.0.182. ADB on port 5555 once Developer options > USB debugging is on |
| Memory | 2 GB. Before cleanup ~86-290 MB free; after cleanup and a restart ~1.1 GB free right after boot |

## What was done (2026-10-22)

1. Backup of packages, settings and properties: `backup/20261022-220137/`.
2. 23 apps the owner had installed were **uninstalled** (`uninstalled.txt`); reinstall any from the Play Store.
3. 51 built-in packages **disabled** with `tools/disable.sh debloat.txt` (see the list for what and why).
   The safety check kept `com.sony.dtv.smarthomesettings` on: it requests `TV_INPUT_HARDWARE`.
4. Restarted. Checked: Home, both TV input services (HDMI and ATSC tuner), Netflix, Prime Video,
   Disney+, ESPN, Spotify, AirScreen, Play Store and Settings all enabled and working.

Kept on purpose: Inputs, Settings, Netflix, Prime Video, Disney+, ESPN, Spotify, Play Store and Google
services, AirScreen (the AirPlay receiver for Mirror Boost), the keyboard, and Google's stock home
screen until the new launcher replaces it.

5. Installed VibecodedTV (`tools/install_tvapp.sh --make-home`): the new home screen is Home,
   Google's stock home screen (`com.google.android.tvlauncher`) is disabled and in `debloat.txt`.
   Queue and Mirror Boost are also in the app list. Mirror Boost has WRITE_SECURE_SETTINGS (granted over
   ADB) and reached 100/100 on this TV: Ethernet, scanning off, background apps closed.

## Undo

```bash
TV_HOST=192.168.0.182 bash tools/restore.sh devices/sony-xbr-75x850f/debloat.txt
```

turns every disabled package back on and gives Home back to Google's home screen.
To remove the new app too: `tools/tv.py pm uninstall com.vibecoded.tv`. The recovery record is
`~/.cleanyourtv/recovery-192.168.0.182-6b5fbbae.json`; keep it.

## Things learned on this set

- **The TV dropping off the network mid-run was standby, not a crash** (uptime was 21 days). A Sony in
  standby cuts its network, so wake it first: `tools/tv.py "input keyevent KEYCODE_WAKEUP"`.
- `dumpsys activity lru` does not exist on Android 9; Mirror Boost reads `dumpsys activity processes`.
- `netd` had grown to 343 MB over 21 days without a restart. A restart cleared it.
- The Moana banner, "Free Live TV" / "Top Selling" rows, the Shop tab and the Freeplay tile all come
  from `com.google.android.tvlauncher` itself and go away only when the new launcher replaces it.
- Mirror Boost readiness after cleanup: 66/100. Left: background scanning on, picture mode, and
  background apps (Boost handles the first and last).
- **Performance (measured with `dumpsys gfxinfo`, 8 focus moves).** The first install used the browser
  design as is: 74% CPU while idle and ~300 ms per frame (~3 fps), because live blur over an animated
  backdrop made the 32-bit MediaTek GPU recomposite the whole screen every frame. Fast mode (`html.lite`,
  on automatically in the app) drops live blur, loops and blurred shadows and flattens the backdrop:
  0% CPU idle, ~28 ms per frame on Home. Baseline: Sony's own Settings app is ~18 ms per frame.
  Queue plays trailers at 720p scaled up on the GPU: ~25 fps playback; switching clips still
  hitches (~53 ms) while YouTube's player loads.
- **Native Home and Queue (2026-10-23).** The web app was replaced by the native launcher
  (`launcher/`, Apple TV mode) and a native Queue. Home: ~6 ms per frame median. Queue's slide went from
  25 ms median / 65 ms at the 90th percentile to **18 ms / 22–29 ms**. The time was all GPU fill
  (`framestats`: under 10 ms of app work, up to 60 ms in swap): each frame painted about eight
  full-screen layers. Each cover now has its scrim baked in once, off the main thread, and the black
  backgrounds behind the covers are dropped, so a frame paints about two.
- A cold start of Home (after a reboot or reinstall) takes ~4 s to first frame; the Top Shelf fills in
  a moment later. Pressing Home normally is instant.
- Netflix, Prime Video and Disney+ all accept direct title links (`ACTION_VIEW`, see `Queue.watchOn`);
  none answer `ACTION_SEARCH`. Netflix and the other DRM apps show black in `screencap`.
- **Apple TV look, tuned (2026-10-23).** `tools/bench_ui.py` times every action (results in `bench.md`).
  After the logo/frosted-dock redesign, moving along the dock was 17 ms median, 27 ms at the 90th
  percentile and ~100 ms at the 99th; it is now **6 / 10 / 20 ms**. `framestats` showed the GPU spending
  ~15 ms a frame on full-screen layers, plus ~95 ms main-thread stalls. The fixes: the shade is painted
  into each backdrop on ImageLoader's thread, so there is no scrim layer; the dock glass's blurred copy
  is made on that thread too, with the white veil painted in (one fill of the band, not three); and the
  shelf stops rotating while a menu is open.
- The top menu (Up) is now 5 frames (no drop shadow, a 0.12 s fade) instead of ~50. With any popup on
  screen this TV recomposes the whole screen each frame (~21 ms), so fewer frames is the lever.
- The remote's Menu key is handled by Sony's system first: it pauses and resumes Home, which then
  redraws the whole shelf. Hold OK for the app menu instead.
- Home cold start (release build, compiled ahead of time): ~0.75 s, down from ~4 s with the debug build.
