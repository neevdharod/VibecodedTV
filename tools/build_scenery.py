#!/usr/bin/env python3
"""Build Scenery's clip list (Apple TV mode's aerial top banner) from Pixabay: 100+ calm aerial clips.

    python3 -I tools/build_scenery.py               # picks automatically -> launcher/app/src/main/assets/scenery.json
    python3 -I tools/build_scenery.py --candidates  # the whole pool, for picking by hand (tools/scenery_picker.py)

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
    ("New York", "new york aerial", 15),
    ("New York", "manhattan drone", 10),
    ("New York", "new york city skyline", 10),
    ("New York", "brooklyn bridge", 5),
    ("New York", "times square", 4),
    ("New York", "central park", 4),
    ("New York", "statue of liberty", 3),
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
# More to choose from in the picker (tools/scenery_picker.py); the automatic list leaves these out.
EXTRA_THEMES = [
    ("Cities at Night", "night skyline timelapse"), ("City Skylines", "aerial city"),
    ("Tokyo", "tokyo aerial"), ("Paris", "paris aerial"), ("London", "london aerial"), ("Dubai", "dubai aerial"),
    ("Chicago", "chicago aerial"), ("San Francisco", "san francisco aerial"), ("Hong Kong", "hong kong aerial"),
    ("Waterfalls", "waterfall drone"), ("Canyons", "canyon aerial"), ("Iceland", "iceland drone"),
    ("Tropical Islands", "tropical island aerial"), ("Mountains", "mountain sunrise drone"),
    ("Ocean", "waves aerial"), ("Above the Clouds", "above clouds sunset"),
]
MIN_SECONDS, MAX_SECONDS = 12, 90
# A clip counts for a theme only when its own tags say so: Pixabay's search alone returns beaches for
# "new york aerial".
NEEDS = {
    "New York": ["new york", "manhattan", "nyc", "brooklyn", "empire state", "statue of liberty", "times square",
                 "central park", "hudson"],
    "Cities at Night": ["night"],
    "City Skylines": ["skyline", "skyscraper", "downtown", "city"],
    "Mountains": ["mountain"],
    "Above the Clouds": ["cloud"],
    "Ocean": ["ocean", "sea"],
    "Coastlines": ["coast", "beach", "cliff", "shore"],
    "Forests": ["forest", "trees", "woods"],
    "Deserts": ["desert", "dune"],
    "Snow": ["snow", "winter", "glacier"],
    "Lakes": ["lake"],
    "Tokyo": ["tokyo"], "Paris": ["paris", "eiffel"], "London": ["london", "thames"], "Dubai": ["dubai"],
    "Chicago": ["chicago"], "San Francisco": ["san francisco", "golden gate"], "Hong Kong": ["hong kong"],
    "Waterfalls": ["waterfall"], "Canyons": ["canyon"], "Iceland": ["iceland"],
    "Tropical Islands": ["island", "tropical", "maldives"],
}
# The caption's second half, New York only: its landmarks, by the tag that names them.
LANDMARKS = [("brooklyn bridge", "Brooklyn Bridge"), ("statue of liberty", "Statue of Liberty"),
             ("times square", "Times Square"), ("central park", "Central Park"), ("empire state", "Empire State"),
             ("one world trade", "One World Trade"), ("hudson", "Hudson River"), ("brooklyn", "Brooklyn"),
             ("midtown", "Midtown"), ("manhattan", "Manhattan")]   # "downtown" is on half of them: too vague


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
    if caption != "New York":
        return ""   # like Apple's aerials: "Mountains", not a guess from a stock site's tags
    for tag, name in LANDMARKS:
        if tag in tags:
            return name
    return ""


def clips(api_key, caption, q):
    """Every clip a search turns up that passes the filters, best first (Pixabay's popular order)."""
    out = []
    for h in search(api_key, q).get("hits", []):
        tags = (h.get("tags") or "").lower()
        if "ai generated" in tags or "ai-generated" in tags or "generated" in tags:
            continue
        if not any(word in tags for word in NEEDS[caption]):
            continue
        if not (MIN_SECONDS <= (h.get("duration") or 0) <= MAX_SECONDS):
            continue
        # Pixabay's renditions: large is usually 4K, medium usually 1920x1080. Keep true 1080p only.
        videos = h.get("videos") or {}
        r = next((v for v in videos.values()
                  if v.get("url") and abs(v.get("width", 0) - 1920) <= 4 and abs(v.get("height", 0) - 1080) <= 4), None)
        if not r:
            continue
        preview = (videos.get("tiny") or {}).get("url") or (videos.get("small") or {}).get("url") or r["url"]
        out.append({"id": f"px{h['id']}", "name": caption, "place": place(tags, caption), "url": r["url"],
                    "mb": round((r.get("size") or 0) / 1048576, 1), "thumb": r.get("thumbnail", ""),
                    "preview": preview, "seconds": h.get("duration"), "page": h.get("pageURL", ""),
                    "tags": h.get("tags", "")})
    return out


def mix(scenes):
    """New York spread through the list (one in three), the rest shuffled, so a day's new clips vary."""
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
    return mixed


def write(scenes):
    """The list the TV reads: id, caption and the 1080p file for each clip."""
    keep = ("id", "name", "place", "url", "mb")
    with open(OUT, "w") as f:
        f.write('{\n  "credit": "Scenery videos from Pixabay, under the Pixabay Content License",\n  "scenes": [\n')
        f.write(",\n".join("    " + json.dumps({k: s[k] for k in keep}, ensure_ascii=False) for s in scenes))
        f.write("\n  ]\n}\n")
    total = sum(s["mb"] for s in scenes)
    print(f"{len(scenes)} clips, {total / 1024:.1f} GB if all were on the TV at once (it keeps ~30) -> {OUT}")


def candidates(api_key):
    """The whole pool for the picker: every theme's clips, each clip once."""
    pool, seen = [], set()
    for caption, q, *_ in THEMES + EXTRA_THEMES:
        found = [c for c in clips(api_key, caption, q) if c["id"] not in seen]
        seen.update(c["id"] for c in found)
        pool.extend(found)
        print(f"{caption:18} {q:26} {len(found):4} clips")
    return pool


def main():
    api_key = key()
    if "--candidates" in sys.argv:
        pool = candidates(api_key)
        path = os.path.join(ROOT, "tools", "cache", "scenery_candidates.json")
        json.dump(pool, open(path, "w"))
        print(f"{len(pool)} candidates -> {path}")
        return
    scenes, seen = [], set()
    for caption, q, want in THEMES:
        kept = [c for c in clips(api_key, caption, q) if c["id"] not in seen][:want]
        seen.update(c["id"] for c in kept)
        scenes.extend(kept)
        print(f"{caption:18} {q:22} {len(kept):3} clips")
    write(mix(scenes))


if __name__ == "__main__":
    main()
