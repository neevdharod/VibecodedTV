#!/usr/bin/env python3
"""Turn what tools/prime_history.js read off the Prime Video watch-history page into data/prime_history.json.

    python3 -I tools/import_prime_history.py history.json     # or pipe the JSON in on stdin

One entry per show or film (episodes of a show fold into the show), newest first, as
tools/build_catalog.py reads it. data/ is gitignored: your history stays on this computer.
"""
import json
import os
import re
import sys
from datetime import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "prime_history.json")

# "The Boys - Season 3", "Reacher: Season 2", "Invincible Season 1, Ep. 4" -> the show's own name.
SEASON = re.compile(r"\s*(?:[-:–,]\s*)?(?:Season|Series|Volume|Part|Staffel)\s+\d+.*$", re.I)


def show_name(title):
    return SEASON.sub("", title).strip(" -:–,")


def iso(date):
    try:
        return datetime.strptime(date, "%B %d, %Y").date().isoformat()
    except (TypeError, ValueError):
        return None


def main():
    raw = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()
    entries = json.loads(raw)
    if isinstance(entries, str):   # the browser hands back the JSON as a string
        entries = json.loads(entries)
    merged = {}
    for e in entries:
        name = show_name(e.get("title") or "")
        if not name:
            continue
        key = name.casefold()
        date = iso(e.get("date"))
        prev = merged.get(key)
        if prev is None:
            merged[key] = {"title": name, "date": date, "asin": e.get("asin"), "plays": 1}
        else:
            prev["plays"] += 1
            if date and (prev["date"] is None or date > prev["date"]):
                prev["date"] = date
    history = sorted(merged.values(), key=lambda h: h["date"] or "", reverse=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(history, f, indent=1, ensure_ascii=False)
    print(f"{len(entries)} history entries -> {len(history)} titles -> {OUT}")
    for h in history[:10]:
        print(f"  {h['date'] or '?':10}  {h['title']}  ({h['plays']}x)")


if __name__ == "__main__":
    main()
