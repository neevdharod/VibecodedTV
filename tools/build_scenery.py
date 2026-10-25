#!/usr/bin/env python3
"""Build Scenery's clip list (Apple TV mode's aerial top banner) from Pixabay: 100+ calm aerial clips.

    python3 -I tools/build_scenery.py        # writes launcher/app/src/main/assets/scenery.json

Then `tools/update_tv.sh` puts it on the TV. The TV downloads only a few of the clips at a time (Scenery
keeps a small rotating set, see Scenery.java), so a long list costs nothing but a few KB.

Every clip is Pixabay's 1920x1080 rendition, so the TV's decoder never re-tunes between clips, at about a
quarter of a 4K clip's size. Clips tagged as AI-generated, too short to settle or too long to rotate are
left out. The key lives in tools/.pixabay_key (gitignored). Pixabay asks for searches to be cached for 24
hours, so they are (tools/cache/pixabay). Videos are under the Pixabay Content License.
"""
import hashlib
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
KEY_FILE = os.path.join(ROOT, "tools", ".pixabay_key")
CACHE = os.path.join(ROOT, "tools", "cache", "pixabay")
OUT = os.path.join(ROOT, "launcher", "app", "src", "main", "assets", "scenery.json")
API = "https://pixabay.com/api/videos/"

# (caption, search, how many to keep). New York gets the most room; the rest keeps it varied.
THEMES = [
    ("New York", "new york aerial", 30),
    ("New York", "manhattan drone", 15),
    ("Cities at Night", "city night aerial", 15),
    ("City Skylines", "skyline drone", 15),
    ("Mountains", "mountains aerial", 15),
    ("Above the Clouds", "clouds aerial", 10),
    ("Ocean", "ocean drone", 12),
    ("Coastlines", "coast aerial", 12),
    ("Forests", "forest aerial", 10),
    ("Deserts", "desert aerial", 8),
    ("Snow", "snow mountains drone", 8),
    ("Lakes", "lake drone", 8),
]
MIN_SECONDS, MAX_SECONDS = 12, 90
# Tags that say more about where it is than "aerial" does; used for the caption's second half.
GENERIC = {"aerial", "drone", "aerial view", "aerial shot", "landscape", "nature", "city", "cityscape", "urban",
           "4k", "background", "view", "sky", "travel", "scenery", "outdoors", "panorama", "skyline", "drone shot",
           "footage", "video", "buildings", "building", "architecture", "dji", "flight", "flying", "above"}


def key():
    try:
        return open(KEY_FILE).read().strip()
    except OSError:
        sys.exit(f"Put your Pixabay API key in {KEY_FILE} (pixabay.com/api/docs shows it once you're logged in).")


def search(api_key, q):
    """One search, 200 results, cached for a day as Pixabay asks."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(q.encode()).hexdigest() + ".json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 24 * 3600:
        return json.load(open(path))
    params = {"key": api_key, "q": q, "video_type": "film", "safesearch": "true", "order": "popular",
              "min_width": 1920, "per_page": 200}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "VibecodedTV/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    json.dump(data, open(path, "w"))
    time.sleep(0.7)   # well under 100 requests a minute
    return data


def place(tags, caption):
    for t in (x.strip() for x in tags.split(",")):
        if t and t.lower() not in GENERIC and t.lower() not in caption.lower():
            return t.title()
    return ""


def main():
    api_key = key()
    scenes, seen = [], set()
    for caption, q, want in THEMES:
        hits = search(api_key, q).get("hits", [])
        kept = 0
        for h in hits:
            if kept >= want:
                break
            tags = (h.get("tags") or "").lower()
            if h["id"] in seen or "ai generated" in tags or "ai-generated" in tags or "generated" in tags:
                continue
            if not (MIN_SECONDS <= (h.get("duration") or 0) <= MAX_SECONDS):
                continue
            # Pixabay's renditions: large is usually 4K, medium usually 1920x1080. Keep true 1080p only.
            r = next((v for v in (h.get("videos") or {}).values()
                      if v.get("url") and abs(v.get("width", 0) - 1920) <= 4 and abs(v.get("height", 0) - 1080) <= 4), None)
            if not r:
                continue
            seen.add(h["id"])
            scenes.append({"id": f"px{h['id']}", "name": caption, "place": place(h.get("tags", ""), caption),
                           "url": r["url"], "mb": round((r.get("size") or 0) / 1048576, 1)})
            kept += 1
        print(f"{caption:18} {q:22} {kept:3} clips")
    # New York first, then shuffled so a day's handful of new clips isn't all one theme.
    rng = random.Random(7)
    ny = [s for s in scenes if s["name"] == "New York"]
    rest = [s for s in scenes if s["name"] != "New York"]
    rng.shuffle(ny)
    rng.shuffle(rest)
    mixed = []
    while ny or rest:
        if ny: mixed.append(ny.pop())
        for _ in range(2):
            if rest: mixed.append(rest.pop())
    doc = {"credit": "Scenery videos from Pixabay, under the Pixabay Content License", "scenes": mixed}
    with open(OUT, "w") as f:
        f.write('{\n  "credit": ' + json.dumps(doc["credit"]) + ',\n  "scenes": [\n')
        f.write(",\n".join("    " + json.dumps(s, ensure_ascii=False) for s in mixed))
        f.write("\n  ]\n}\n")
    total = sum(s["mb"] for s in mixed)
    print(f"{len(mixed)} clips, {total / 1024:.1f} GB if all were on the TV at once (it keeps ~30) -> {OUT}")


if __name__ == "__main__":
    main()
