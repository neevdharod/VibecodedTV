#!/usr/bin/env python3
"""Tests for mirror_boost.py's parsing and boost/restore round trip, against a fake TV.

    python3 -I tools/test_mirror_boost.py
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mirror_boost as mb

WIFI = ('mWifiInfo SSID: "Home-5G", BSSID: aa:bb:cc:dd:ee:ff, MAC: 02:00:00:00:00:00, Security type: 2, '
        'Supplicant state: COMPLETED, Wi-Fi standard: 11ac, RSSI: -52, Link speed: 433Mbps, '
        'Tx Link speed: 433Mbps, Max Supported Tx Link speed: 433Mbps, Rx Link speed: 390Mbps, '
        'Frequency: 5745MHz, Net ID: 0\n')
WIFI_24 = 'mWifiInfo SSID: "Home", RSSI: -71, Link speed: 72Mbps, Frequency: 2437MHz\n'
MEMINFO = "MemTotal:        2010000 kB\nMemFree:          120000 kB\nMemAvailable:     905000 kB\n"
LRU = """ACTIVITY MANAGER LRU PROCESSES (dumpsys activity lru)
  Activities:
  #12: fg     TOP  LCMNFUA 1234:com.google.android.tvlauncher/u0a40  act:activities|recents
  #11: cch+ 5 CEM ---- 2345:com.netflix.ninja/u0a88
  #10: cch+15 CEM ---- 3456:com.google.android.youtube.tv/u0a91
  #9: cch+25 CEM ---- 4567:com.amazon.amazonvideo.livingroom/u0a92
  #8: prcp  IMPS ---- 5678:com.google.android.katniss/u0a30
"""
PACKAGES = "package:com.netflix.ninja\npackage:com.ionitech.airscreen\npackage:com.android.settings\n"
# Android 9 (Sony BRAVIA ATV3) has no `dumpsys activity lru`; processes look like this instead.
PROCESSES_9 = """    Proc # 0: fore  T/A/TOP  trm: 0 2091:com.android.tv.settings/1000 (top-activity)
    Proc #12: cch   B/ /CE   trm: 0 6227:com.tubitv/u0a120 (cch-empty)
    Proc #13: cch+ 5 B/ /CE  trm: 0 2283:com.spotify.tv.android/u0a98 (cch-empty)
"""


class FakeTV:
    def __init__(self):
        self.settings = {"wifi_scan_always_enabled": "1", "ble_scan_always_enabled": "1",
                         "window_animation_scale": "1.0", "transition_animation_scale": "1.0",
                         "animator_duration_scale": "null"}
        self.ran = []

    def __call__(self, cmd):
        self.ran.append(cmd)
        parts = cmd.split()
        if parts[:2] == ["settings", "get"]:
            return self.settings.get(parts[3], "null") + "\n"
        if parts[:2] == ["settings", "put"]:
            self.settings[parts[3]] = parts[4]
        elif parts[:2] == ["settings", "delete"]:
            self.settings.pop(parts[3], None)
        elif cmd == "dumpsys wifi":
            return WIFI
        elif cmd == "cat /proc/meminfo":
            return MEMINFO
        elif cmd == "dumpsys activity lru":
            return LRU
        elif cmd in ("pm list packages", "pm list packages -e"):
            return PACKAGES
        elif cmd.startswith("getprop"):
            return "BRAVIA 4K\n"
        return ""


class Parsing(unittest.TestCase):
    def test_wifi_5ghz(self):
        w = mb.parse_wifi(WIFI)
        self.assertEqual(w, {"ssid": "Home-5G", "rssi": -52, "link_mbps": 433, "freq_mhz": 5745, "band": "5 GHz"})

    def test_wifi_24ghz(self):
        self.assertEqual(mb.parse_wifi(WIFI_24)["band"], "2.4 GHz")

    def test_wifi_unreadable(self):
        self.assertEqual(mb.parse_wifi("nothing here")["band"], None)

    def test_meminfo(self):
        self.assertEqual(mb.parse_meminfo(MEMINFO), {"available_mb": 883, "total_mb": 1962})

    def test_cached(self):
        self.assertEqual(mb.count_cached(LRU), 3)

    def test_receivers(self):
        self.assertEqual(mb.find_receivers(PACKAGES), ["com.ionitech.airscreen"])

    def test_cached_android9(self):
        self.assertEqual(mb.count_cached(PROCESSES_9), 2)

    def test_receivers_all_kinds(self):
        pkgs = "".join(f"package:{p}\n" for p in ("com.boost.airplay.receiver", "com.nero.swiftlink.mirror.tv",
                                                 "com.sand.aircasttv", "com.benq.screenshareios", "com.tubitv"))
        self.assertEqual(len(mb.find_receivers(pkgs)), 4)

    def test_miracast_is_not_an_airplay_receiver(self):
        self.assertEqual(mb.find_receivers("package:screnmirroring.com\npackage:com.ionitech.airscreen\n"),
                         ["com.ionitech.airscreen"])


class BoostRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        mb.BACKUP = os.path.join(self.tmp, "backup.json")

    def test_boost_then_restore_puts_everything_back(self):
        tv = FakeTV()
        before = dict(tv.settings)
        report = mb.gather(tv)
        mb.boost(tv, report)
        self.assertEqual(tv.settings["wifi_scan_always_enabled"], "0")
        self.assertEqual(tv.settings["window_animation_scale"], "0.5")
        self.assertIn("am kill-all", tv.ran)
        self.assertTrue(any(c.startswith("monkey -p com.ionitech.airscreen") for c in tv.ran))
        self.assertGreater(mb.score(mb.gather(tv)), report["score"])
        self.assertEqual(mb.restore(tv), 0)
        # "null" means the key was unset before; restore deletes it rather than writing "null".
        expected = {k: v for k, v in before.items() if v != "null"}
        self.assertEqual(tv.settings, expected)
        self.assertFalse(os.path.exists(mb.BACKUP))

    def test_second_boost_keeps_the_original_backup(self):
        tv = FakeTV()
        mb.boost(tv, mb.gather(tv))
        mb.boost(tv, mb.gather(tv))   # settings are boosted values now; the backup must not change
        mb.restore(tv)
        self.assertEqual(tv.settings["wifi_scan_always_enabled"], "1")


if __name__ == "__main__":
    unittest.main()
