#!/usr/bin/env python3
"""Refresh Queue's film ratings from IMDb.

    python3 -I tools/update_ratings.py

For each film in web/queue/catalog.js it:
  1. finds the film's Wikidata item through its Wikipedia page (batched, 50 titles a request),
  2. reads the IMDb ID (Wikidata P345) and the US age rating (P1657, e.g. "PG-13"),
  3. looks the IMDb ID up in IMDb's official ratings file (datasets.imdbws.com/title.ratings.tsv.gz,
     refreshed daily by IMDb, free for personal non-commercial use),
and writes `imdb`, `cert`, `rating` (IMDb's average) and `votes` back into the catalog.
IMDb IDs found once are kept, so later runs only download the ratings file. Run it again any time
to pick up today's numbers. Information courtesy of IMDb (https://www.imdb.com).
"""
import gzip
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CATALOG = os.path.join(ROOT, "web", "queue", "catalog.js")
RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
UA = {"User-Agent": "VibecodedTV/0.1 (personal TV project; ratings refresh)"}

# Wikipedia titles that the usual "<title> (<year> film)" / "<title> (film)" guesses miss.
TITLE_HINTS = {
    "glass-onion": "Glass Onion: A Knives Out Mystery",
    "se7en": "Seven (1995 film)",
    "talk-to-me": "Talk to Me (2022 film)",
    "mission-impossible-fallout": "Mission: Impossible – Fallout",
    "f1": "F1 (film)",
}

# US age ratings that Wikidata doesn't have yet (checked by hand). Wikidata wins when it has one.
CERT_FALLBACK = {
    "her": "R", "superbad": "R", "moneyball": "PG-13", "rush": "R",
    "about-time": "R", "it-follows": "R", "free-solo": "PG-13",
}


def get_json(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == tries - 1:
                raise
            # Rate limited: wait as long as the server asks, a little longer each time.
            time.sleep(float(e.headers.get("Retry-After") or 1) + 2 * i)


def load_catalog():
    src = open(CATALOG, encoding="utf-8").read()
    start = src.index("window.QUEUE_CATALOG")
    header = src[:start]
    films = json.loads(src[src.index("[", start):src.rindex("]") + 1])
    return header, films


def save_catalog(header, films):
    body = "window.QUEUE_CATALOG = [\n" + ",\n".join(json.dumps(f, ensure_ascii=False) for f in films) + "\n];\n"
    with open(CATALOG, "w", encoding="utf-8") as f:
        f.write(header + body)


def wikipedia_items(titles):
    """Wikipedia title -> Wikidata item id, following redirects. 50 titles per request."""
    out = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "pageprops", "ppprop": "wikibase_item",
                                    "redirects": 1, "titles": "|".join(chunk)})
        data = get_json("https://en.wikipedia.org/w/api.php?" + q)["query"]
        hop = {}
        for kind in ("normalized", "redirects"):
            for r in data.get(kind, []):
                hop[r["from"]] = r["to"]
        found = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in data["pages"].values() if "missing" not in p}
        for t in chunk:
            final = t
            for _ in range(3):
                final = hop.get(final, final)
            if found.get(final):
                out[t] = found[final]
        time.sleep(0.5)
    return out


def wikidata(ids):
    """Wikidata item id -> entity (claims and labels). Uses the plain per-item JSON pages, which
    stay available when the API endpoint rate-limits a network."""
    out = {}
    for qid in dict.fromkeys(ids):
        data = get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
        out.update(data.get("entities", {}))
        time.sleep(0.3)
    return out


def claim_values(entity, prop):
    claims = entity.get("claims", {}).get(prop, [])
    # Preferred-rank statements first, deprecated ones never.
    claims = sorted((c for c in claims if c.get("rank") != "deprecated"), key=lambda c: c.get("rank") != "preferred")
    return [c["mainsnak"]["datavalue"]["value"] for c in claims if "datavalue" in c["mainsnak"]]


def year_of(entity):
    years = [int(v["time"][1:5]) for v in claim_values(entity, "P577") if isinstance(v, dict) and "time" in v]
    return years


def find_ids(films):
    """Fill in `imdb` and `cert` for films that don't have them yet."""
    todo = [f for f in films if not f.get("imdb")]
    if not todo:
        return
    guesses = {f["id"]: [TITLE_HINTS.get(f["id"]), f"{f['title']} ({f['year']} film)", f"{f['title']} (film)", f["title"]] for f in todo}
    titles = list(dict.fromkeys(t for g in guesses.values() for t in g if t))
    items = wikipedia_items(titles)
    entities = wikidata(list(set(items.values())))
    cert_items = set()
    for f in todo:
        for t in filter(None, guesses[f["id"]]):
            e = entities.get(items.get(t, ""), {})
            imdb = next((v for v in claim_values(e, "P345") if isinstance(v, str) and v.startswith("tt")), None)
            # The right page is the film's own: an IMDb title ID and a release year within one of ours.
            if imdb and any(abs(y - f["year"]) <= 1 for y in year_of(e)):
                f["imdb"] = imdb
                certs = [v["id"] for v in claim_values(e, "P1657") if isinstance(v, dict) and "id" in v]
                f["_cert_item"] = certs[0] if certs else None
                if certs:
                    cert_items.add(certs[0])
                break
    labels = wikidata(list(cert_items)) if cert_items else {}
    for f in todo:
        item = f.pop("_cert_item", None)
        if item:
            label = labels.get(item, {}).get("labels", {}).get("en", {}).get("value", "")
            f["cert"] = label.replace("Motion Picture Association film rating", "").strip() or None


def imdb_ratings(wanted):
    """IMDb ID -> (average rating, votes) from IMDb's daily ratings file."""
    with urllib.request.urlopen(urllib.request.Request(RATINGS_URL, headers=UA), timeout=120) as r:
        raw = r.read()
    out = {}
    with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8") as f:
        next(f)   # header: tconst, averageRating, numVotes
        for line in f:
            tconst, avg, votes = line.rstrip("\n").split("\t")
            if tconst in wanted:
                out[tconst] = (float(avg), int(votes))
    return out


def main():
    header, films = load_catalog()
    find_ids(films)
    ratings = imdb_ratings({f["imdb"] for f in films if f.get("imdb")})
    changed, missing = [], []
    for f in films:
        r = ratings.get(f.get("imdb"))
        if not r:
            missing.append(f["title"])
            continue
        if abs(r[0] - f["rating"]) >= 0.1:
            changed.append(f"{f['title']}: {f['rating']} -> {r[0]}")
        f["rating"], f["votes"] = r
        f["ratingSource"] = "imdb"
        if not f.get("cert") and f["id"] in CERT_FALLBACK:
            f["cert"] = CERT_FALLBACK[f["id"]]
    note = "// Ratings, votes and IMDb IDs: refreshed by tools/update_ratings.py. Information courtesy of IMDb (https://www.imdb.com).\n"
    if note not in header:
        header = header + note
    save_catalog(header, films)
    print(f"{len(films) - len(missing)} of {len(films)} films have IMDb ratings; {len(changed)} changed.")
    for c in changed:
        print("  ", c)
    if missing:
        print("No IMDb rating found for:", ", ".join(missing))
    certs = sum(1 for f in films if f.get("cert"))
    print(f"{certs} films have a US age rating.")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
