#!/usr/bin/env python3
"""Build the movie/show catalog for the feed and the Top Shelf.

    python3 -I tools/build_catalog.py              # writes launcher/app/src/main/assets/catalog.json

Sources:
  - TMDB (key in tools/.tmdb_key, never committed): titles, cover art, descriptions, genres, keywords,
    director/creator, cast, US age rating, and which streaming services carry each title in the US.
  - IMDb's official ratings file (datasets.imdbws.com, daily, personal non-commercial use): the rating
    and vote count shown on every card.
  - data/prime_history.json if present (from the Prime Video watch-history page): titles you watched.
    They become "seeds": TMDB's recommendations for each seed join the pool, every card remembers which
    seeds led to it ("Because you watched ..."), and seeds themselves are kept out of the feed.

Pool: trending this week, top-rated films and shows, the most popular titles on Netflix, Prime Video
and Disney+ (US), and the seeds' recommendations. Thin entries (no art, no description, few votes) are
dropped. This product uses the TMDB API but is not endorsed or certified by TMDB.
"""
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
KEY = open(os.path.join(ROOT, "tools", ".tmdb_key")).read().strip()
OUT = os.path.join(ROOT, "launcher", "app", "src", "main", "assets", "catalog.json")
HISTORY = os.path.join(ROOT, "data", "prime_history.json")
CACHE = os.path.join(ROOT, "tools", "cache")
API = "https://api.themoviedb.org/3"
REGION = "US"
# Services this TV has, by TMDB provider name -> the launcher's short id.
SERVICES = {"Netflix": "netflix", "Amazon Prime Video": "prime", "Amazon Prime Video with Ads": "prime",
            "Disney Plus": "disney"}
SERVICE_IDS = "8|9|337"   # TMDB provider ids for Netflix, Prime Video, Disney+
MIN_VOTES = 3000          # IMDb votes for a title to count as established
# Wikidata properties holding each service's own id for a title, and how the TV app's links look.
# Netflix's app opens /title/<id> directly; Prime Video's opens watch.amazon.com/detail?asin=<ASIN>;
# Disney+'s answers disneyplus.com links.
LINKS = {
    "netflix": ("P1874", "https://www.netflix.com/title/{}"),
    "prime": ("P8055", "https://watch.amazon.com/detail?asin={}"),
    "disney_movie": ("P7595", "https://www.disneyplus.com/movies/wd/{}"),
    "disney_series": ("P7596", "https://www.disneyplus.com/series/wd/{}"),
}


def get(path, **params):
    params["api_key"] = KEY
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429 or e.code >= 500:
                time.sleep(1 + attempt * 2)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1 + attempt * 2)
    return None


def pages(path, n, **params):
    out = []
    for p in range(1, n + 1):
        d = get(path, page=p, **params)
        if not d:
            break
        out += d.get("results", [])
        if p >= d.get("total_pages", 1):
            break
    return out


def key_of(kind, tmdb_id):
    return ("m" if kind == "movie" else "t") + str(tmdb_id)


def imdb_ratings():
    """tconst -> (rating, votes), from IMDb's daily file (cached for a day)."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "title.ratings.tsv.gz")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > 86400:
        with urllib.request.urlopen("https://datasets.imdbws.com/title.ratings.tsv.gz", timeout=120) as r:
            open(path, "wb").write(r.read())
    out = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            t, avg, votes = line.rstrip("\n").split("\t")
            out[t] = (float(avg), int(votes))
    return out


def find_seed(title):
    """A watched title from Prime's history -> (kind, tmdb id, name), best TMDB match."""
    clean = re.sub(r"\s*[-:]\s*(Season|Series|Volume|Part)\s+\d+.*$", "", title, flags=re.I).strip()
    d = get("/search/multi", query=clean, include_adult="false")
    for r in (d or {}).get("results", []):
        if r.get("media_type") in ("movie", "tv"):
            return r["media_type"], r["id"], r.get("title") or r.get("name")
    return None


def short(text, limit=260):
    """The overview cut at a sentence end, so cards stay quick to read."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end > 80 else cut.rsplit(" ", 1)[0] + "…"


def details(kind, tmdb_id):
    extra = "external_ids,keywords,watch/providers,images," + ("credits,release_dates" if kind == "movie" else "aggregate_credits,content_ratings")
    # images: the title's logo (English) for the Top Shelf, and backdrops without text on them.
    return get(f"/{kind}/{tmdb_id}", append_to_response=extra, include_image_language="en,null")


def best_images(d):
    """(logo, backdrop): the best English PNG logo (Android can't draw TMDB's SVG ones), and the best
    textless backdrop, so the logo is the only title on screen; the default backdrop when there is none."""
    images = d.get("images") or {}
    logos = [i for i in images.get("logos", []) if i.get("iso_639_1") == "en" and i.get("file_path", "").endswith(".png")]
    logos.sort(key=lambda i: (i.get("vote_average") or 0, i.get("vote_count") or 0), reverse=True)
    clean = [i for i in images.get("backdrops", []) if i.get("iso_639_1") is None and (i.get("width") or 0) >= 1280]
    clean.sort(key=lambda i: (i.get("vote_average") or 0, i.get("vote_count") or 0), reverse=True)
    return (logos[0]["file_path"] if logos else None,
            clean[0]["file_path"] if clean else d.get("backdrop_path"))


def cert_of(kind, d):
    if kind == "movie":
        for r in d.get("release_dates", {}).get("results", []):
            if r["iso_3166_1"] == REGION:
                for x in r["release_dates"]:
                    if x.get("certification"):
                        return x["certification"]
    else:
        for r in d.get("content_ratings", {}).get("results", []):
            if r["iso_3166_1"] == REGION and r.get("rating"):
                return r["rating"]
    return None


def entry(kind, d, ratings, seeds_for):
    imdb = (d.get("external_ids") or {}).get("imdb_id")
    rating, votes = ratings.get(imdb, (None, 0))
    if rating is None:
        rating, votes = round(d.get("vote_average") or 0, 1), d.get("vote_count") or 0
    prov = (d.get("watch/providers") or {}).get("results", {}).get(REGION, {})
    services = sorted({SERVICES[p["provider_name"]] for p in prov.get("flatrate", []) + prov.get("free", [])
                       if p["provider_name"] in SERVICES})
    if kind == "movie":
        crew = (d.get("credits") or {}).get("crew", [])
        maker = next((c["name"] for c in crew if c.get("job") == "Director"), "")
        cast = [c["name"] for c in (d.get("credits") or {}).get("cast", [])[:3]]
        date = d.get("release_date") or ""
        length = d.get("runtime") or 0
    else:
        maker = ", ".join(c["name"] for c in d.get("created_by", [])[:2])
        cast = [c["name"] for c in (d.get("aggregate_credits") or {}).get("cast", [])[:3]]
        date = d.get("first_air_date") or ""
        length = d.get("number_of_seasons") or 0
    kw = (d.get("keywords") or {}).get("keywords" if kind == "movie" else "results", [])
    k = key_of(kind, d["id"])
    logo, backdrop = best_images(d)
    return {
        "id": k, "type": kind, "title": d.get("title") or d.get("name"), "year": int(date[:4]) if date[:4].isdigit() else 0,
        "length": length, "genres": [g["name"] for g in d.get("genres", [])], "keywords": [x["name"] for x in kw[:10]],
        "maker": maker, "cast": cast, "overview": short(d.get("overview")), "cert": cert_of(kind, d),
        "imdb": imdb, "rating": rating, "votes": votes, "services": services,
        "backdrop": backdrop, "logo": logo, "poster": d.get("poster_path"),
        "because": sorted(seeds_for.get(k, [])),
        "wikidata": (d.get("external_ids") or {}).get("wikidata_id"),
    }


def wikidata_entity(qid):
    """One Wikidata item, from its plain JSON page (the query service rate-limits hard). Cached on disk."""
    folder = os.path.join(CACHE, "wikidata")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, qid + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "VibecodedTV/0.1 (personal TV project)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                ent = json.load(r).get("entities", {}).get(qid, {})
            claims = {p: [c["mainsnak"]["datavalue"]["value"] for c in ent.get("claims", {}).get(p, [])
                          if "datavalue" in c["mainsnak"] and c.get("rank") != "deprecated"]
                      for p, _ in LINKS.values()}
            json.dump(claims, open(path, "w"))
            return claims
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            time.sleep(float(e.headers.get("Retry-After") or 1) + attempt * 2)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1 + attempt * 2)
    return {}


def add_links(card):
    """Direct links into the service apps for a card, from Wikidata, for the services that carry it."""
    links = {}
    if card.get("wikidata") and card["services"]:
        claims = wikidata_entity(card["wikidata"])
        for service in card["services"]:
            keys = ["disney_series" if card["type"] == "tv" else "disney_movie"] if service == "disney" else [service]
            for key in keys:
                prop, fmt = LINKS[key]
                values = claims.get(prop) or []
                if values:
                    links[service] = fmt.format(urllib.parse.quote(str(values[0]), safe=".:"))
    card["links"] = links
    card.pop("wikidata", None)
    return card


def main():
    ratings = imdb_ratings()
    print(f"IMDb ratings: {len(ratings)} titles", flush=True)

    history = json.load(open(HISTORY)) if os.path.exists(HISTORY) else []
    with ThreadPoolExecutor(8) as ex:
        found = list(ex.map(lambda h: find_seed(h["title"]), history))
    seeds = {}
    for h, f in zip(history, found):
        if f:
            seeds[key_of(f[0], f[1])] = {"kind": f[0], "id": f[1], "title": f[2], "watched": h.get("date")}
    print(f"seeds from Prime history: {len(seeds)} of {len(history)} titles matched", flush=True)

    pool = {}   # key -> (kind, id)
    def add(kind, items):
        for r in items:
            if r.get("media_type") in (None, "movie", "tv"):
                kd = r.get("media_type") or kind
                pool.setdefault(key_of(kd, r["id"]), (kd, r["id"]))
    add(None, pages("/trending/all/week", 5))
    for kind in ("movie", "tv"):
        add(kind, pages(f"/{kind}/top_rated", 15))
        add(kind, pages(f"/discover/{kind}", 15, watch_region=REGION, with_watch_providers=SERVICE_IDS,
                        sort_by="popularity.desc", **{"vote_count.gte": 200}))
    seeds_for = {}
    def recs(s):
        return s, pages(f"/{s['kind']}/{s['id']}/recommendations", 2)
    with ThreadPoolExecutor(8) as ex:
        for s, items in ex.map(recs, seeds.values()):
            for r in items:
                kd = r.get("media_type") or s["kind"]
                k = key_of(kd, r["id"])
                pool.setdefault(k, (kd, r["id"]))
                seeds_for.setdefault(k, set()).add(s["title"])
    for k in seeds:
        pool.pop(k, None)   # already watched
    print(f"candidate pool: {len(pool)}", flush=True)

    with ThreadPoolExecutor(16) as ex:
        fetched = list(ex.map(lambda kv: (kv[0], details(*kv)), pool.values()))
    cards = []
    for (kind, d) in fetched:
        if not d or d.get("adult"):
            continue
        e = entry(kind, d, ratings, seeds_for)
        if not e["backdrop"] or not e["overview"] or not e["year"]:
            continue
        if e["votes"] < MIN_VOTES and not e["because"]:
            continue
        cards.append(e)
    cards.sort(key=lambda e: (-len(e["because"]), -e["rating"]))
    with ThreadPoolExecutor(4) as ex:
        cards = list(ex.map(add_links, cards))

    # The seeds' own features, so the feed knows your taste before you've reacted to anything.
    with ThreadPoolExecutor(8) as ex:
        seed_details = list(ex.map(lambda s: (s, details(s["kind"], s["id"])), seeds.values()))
    watched = []
    for s, d in seed_details:
        if d:
            e = entry(s["kind"], d, ratings, {})
            watched.append({k: e[k] for k in ("id", "type", "title", "year", "genres", "keywords", "maker", "cast")} | {"watched": s["watched"]})

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = {"built": time.strftime("%Y-%m-%d"), "region": REGION, "image_base": "https://image.tmdb.org/t/p/",
           "attribution": "This product uses the TMDB API but is not endorsed or certified by TMDB. Ratings courtesy of IMDb.",
           "watched": watched, "titles": cards}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    by_service = {s: sum(1 for c in cards if s in c["services"]) for s in ("netflix", "prime", "disney")}
    print(f"wrote {len(cards)} titles ({sum(1 for c in cards if c['type']=='movie')} films, "
          f"{sum(1 for c in cards if c['type']=='tv')} shows), {len(watched)} watched; on services: {by_service}; "
          f"{os.path.getsize(OUT) // 1024} KB -> {OUT}")
    links = {s: sum(1 for c in cards if s in c["links"]) for s in ("netflix", "prime", "disney")}
    print(f"direct app links: {links} (of the titles on each service: {by_service})")
    print(f"logos: {sum(1 for c in cards if c.get('logo'))} of {len(cards)} titles")


if __name__ == "__main__":
    sys.exit(main())
