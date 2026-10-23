package com.gathin.tvhome;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Queue's recommender. Each title is a sparse feature vector (genres, keywords, director/creator, cast,
 * decade, film or show); your taste is a weighted sum of the vectors of what you reacted to, seeded from
 * the Prime Video history in the catalog. A title's score is
 *
 *   3.5 x similarity to your taste x confidence  +  0.6 x (IMDb rating - 7.2)
 *     +  a bonus when your history recommended it  +  a bonus when one of your apps has it  +  a little surprise
 *
 * and the next card is picked greedily with a penalty for being too like the last few. All on the TV.
 */
final class Taste {
    private static final float DECAY = 0.985f;
    private static final Map<String, Float> EVENT = new HashMap<>();
    static {
        EVENT.put("love", 2.0f);
        EVENT.put("save", 1.2f);
        EVENT.put("watched", 0.3f);
        EVENT.put("bounce", -0.35f);
        EVENT.put("pass", -0.9f);
    }

    static final class Pick {
        final Catalog.Title title;
        final int match;
        final String reason;
        Pick(Catalog.Title title, int match, String reason) { this.title = title; this.match = match; this.reason = reason; }
    }

    private final Catalog catalog;
    private final SharedPreferences prefs;
    private final Map<String, Map<String, Float>> vectors = new HashMap<>();
    private Map<String, Float> taste = new HashMap<>();
    final Map<String, String> reactions = new HashMap<>();   // id -> love | pass
    final Set<String> seen = new HashSet<>();
    final List<String> watchlist = new ArrayList<>();
    /** Watched titles already folded into your taste, so a catalog pushed later adds only the new ones. */
    private final Set<String> seeded = new HashSet<>();
    int events;
    private final long session = System.currentTimeMillis();

    Taste(Context ctx, Catalog catalog) {
        this.catalog = catalog;
        this.prefs = ctx.getSharedPreferences("queue_taste", Context.MODE_PRIVATE);
        for (Catalog.Title t : catalog.titles) vectors.put(t.id, features(t));
        load();
        // What you watched on Prime Video is your starting taste; history in a newer catalog
        // (tools/refresh_queue.sh) joins it without undoing what you have told Queue since.
        boolean added = false;
        for (Catalog.Title w : catalog.watched) {
            if (seeded.add(w.id)) {
                add(features(w), 1.0f);
                added = true;
            }
        }
        if (added) save();
    }

    static Map<String, Float> features(Catalog.Title t) {
        Map<String, Float> f = new HashMap<>();
        for (String g : t.genres) f.put("g:" + g, 1.0f);
        for (String k : t.keywords) f.put("k:" + k, 0.5f);
        if (t.maker != null && !t.maker.isEmpty()) f.put("d:" + t.maker, 0.9f);
        for (String c : t.cast) f.put("c:" + c, 0.35f);
        if (t.year > 0) f.put("y:" + (t.year / 10 * 10), 0.25f);
        f.put("t:" + t.type, 0.3f);
        return f;
    }

    // ---------- learning ----------

    void record(String id, String kind) {
        Float w = EVENT.get(kind);
        Map<String, Float> f = vectors.get(id);
        if (w == null || f == null) return;
        for (Map.Entry<String, Float> e : taste.entrySet()) e.setValue(e.getValue() * DECAY);
        add(f, w);
        if ("love".equals(kind) || "pass".equals(kind)) reactions.put(id, kind);
        seen.add(id);
        events++;
        save();
    }

    /** Pressing Love again takes it back. */
    void undo(String id) {
        String kind = reactions.remove(id);
        Map<String, Float> f = vectors.get(id);
        if (kind == null || f == null) return;
        add(f, -EVENT.get(kind));
        save();
    }

    boolean toggleWatchlist(String id) {
        if (watchlist.remove(id)) { save(); return false; }
        watchlist.add(0, id);
        record(id, "save");
        return true;
    }

    void markSeen(String id) { seen.add(id); save(); }

    private void add(Map<String, Float> f, float w) {
        for (Map.Entry<String, Float> e : f.entrySet()) {
            Float old = taste.get(e.getKey());
            taste.put(e.getKey(), (old == null ? 0f : old) + w * e.getValue());
        }
    }

    // ---------- picking ----------

    double score(Catalog.Title t) {
        double conf = Math.min(1.0, events / 6.0 + (catalog.watched.isEmpty() ? 0.0 : 0.5));
        double affinity = cosine(taste, vectors.get(t.id));
        double quality = (t.rating - 7.2) * 0.6;
        double history = Math.min(2, t.because.length) * 0.5;
        double onApp = t.services.length > 0 ? 0.35 : 0.0;
        double explore = 0.45 / Math.sqrt(1 + events) * noise(t.id);
        return 3.5 * affinity * Math.max(conf, 0.35) + quality + history + onApp + explore;
    }

    /** The next n titles, best first: not seen yet, optionally only those on one service, spread out. */
    List<Pick> next(int n, Collection<String> recent, String service) {
        List<Catalog.Title> pool = new ArrayList<>();
        for (Catalog.Title t : catalog.titles) {
            if (seen.contains(t.id) || recent.contains(t.id) || "pass".equals(reactions.get(t.id))) continue;
            if (service != null && !contains(t.services, service)) continue;
            pool.add(t);
        }
        if (pool.size() < n) {   // everything seen: let what you didn't pass on come back around
            for (Catalog.Title t : catalog.titles) {
                if (!pool.contains(t) && !"pass".equals(reactions.get(t.id)) && !recent.contains(t.id)
                        && (service == null || contains(t.services, service))) pool.add(t);
            }
        }
        Map<String, Double> scores = new HashMap<>();
        for (Catalog.Title t : pool) scores.put(t.id, score(t));
        List<Map<String, Float>> context = new ArrayList<>();
        for (String id : recent) if (vectors.containsKey(id)) context.add(vectors.get(id));
        List<Pick> out = new ArrayList<>();
        while (out.size() < n && !pool.isEmpty()) {
            Catalog.Title best = null;
            double bestVal = -1e9;
            int from = Math.max(0, context.size() - 3);
            for (Catalog.Title t : pool) {
                double crowd = 0;
                for (int i = from; i < context.size(); i++) crowd = Math.max(crowd, cosine(context.get(i), vectors.get(t.id)));
                double v = scores.get(t.id) - 1.1 * crowd;
                if (v > bestVal) { bestVal = v; best = t; }
            }
            pool.remove(best);
            double s = scores.get(best.id);
            out.add(new Pick(best, match(s), reason(best, s)));
            context.add(vectors.get(best.id));
        }
        return out;
    }

    Pick pick(Catalog.Title t) {
        double s = score(t);
        return new Pick(t, match(s), reason(t, s));
    }

    static int match(double s) {
        double x = 1 / (1 + Math.exp(-(s * 1.1 - 0.2)));
        return (int) Math.round(62 + 37 * x);
    }

    String reason(Catalog.Title t, double s) {
        String bestLiked = null;
        double bestSim = 0.32;
        for (Map.Entry<String, String> r : reactions.entrySet()) {
            if (!"love".equals(r.getValue()) || r.getKey().equals(t.id)) continue;
            double sim = cosine(vectors.get(r.getKey()), vectors.get(t.id));
            if (sim > bestSim) { bestSim = sim; bestLiked = r.getKey(); }
        }
        if (bestLiked != null && catalog.byId.containsKey(bestLiked)) return "Because you loved " + catalog.byId.get(bestLiked).title;
        if (t.because.length > 0) return "Because you watched " + t.because[0];
        if (events > 2 && 0.45 / Math.sqrt(1 + events) * noise(t.id) > 0.25 && cosine(taste, vectors.get(t.id)) < 0.25) {
            return "Something a little different";
        }
        if (t.rating >= 8.3) return "One of IMDb's highest rated";
        if (t.services.length > 0) return "Popular on " + Queue.serviceName(t.services[0]);
        return "Critically loved";
    }

    // ---------- maths ----------

    private static double cosine(Map<String, Float> a, Map<String, Float> b) {
        if (a == null || b == null || a.isEmpty() || b.isEmpty()) return 0;
        Map<String, Float> small = a.size() < b.size() ? a : b, big = small == a ? b : a;
        double dot = 0;
        for (Map.Entry<String, Float> e : small.entrySet()) {
            Float o = big.get(e.getKey());
            if (o != null) dot += e.getValue() * o;
        }
        double n = norm(a) * norm(b);
        return n == 0 ? 0 : dot / n;
    }

    private static double norm(Map<String, Float> v) {
        double s = 0;
        for (float x : v.values()) s += x * x;
        return Math.sqrt(s);
    }

    /** A stable pseudo-random number per title and session, roughly normal, clamped to +-1.8. */
    private double noise(String id) {
        int h = (id + session).hashCode() * 0x9E3779B1;
        double u1 = ((h >>> 8) % 100000) / 100000.0 + 1e-6;
        double u2 = (((h * 0x85EBCA6B) >>> 8) % 100000) / 100000.0;
        double n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.max(-1.8, Math.min(1.8, n));
    }

    private static boolean contains(String[] a, String s) {
        for (String x : a) if (x.equals(s)) return true;
        return false;
    }

    // ---------- storage ----------

    private void load() {
        try {
            JSONObject o = new JSONObject(prefs.getString("state", "{}"));
            JSONObject t = o.optJSONObject("taste");
            if (t != null) for (Iterator<String> it = t.keys(); it.hasNext(); ) {
                String k = it.next();
                taste.put(k, (float) t.optDouble(k));
            }
            JSONObject r = o.optJSONObject("reactions");
            if (r != null) for (Iterator<String> it = r.keys(); it.hasNext(); ) {
                String k = it.next();
                reactions.put(k, r.optString(k));
            }
            JSONArray s = o.optJSONArray("seen");
            if (s != null) for (int i = 0; i < s.length(); i++) seen.add(s.optString(i));
            JSONArray w = o.optJSONArray("watchlist");
            if (w != null) for (int i = 0; i < w.length(); i++) watchlist.add(w.optString(i));
            JSONArray sd = o.optJSONArray("seeded");
            if (sd != null) for (int i = 0; i < sd.length(); i++) seeded.add(sd.optString(i));
            events = o.optInt("events");
        } catch (Exception ignored) {
            // first run
        }
    }

    private void save() {
        try {
            JSONObject t = new JSONObject();
            // Keep the file small: drop features that have faded to nothing.
            for (Map.Entry<String, Float> e : taste.entrySet()) if (Math.abs(e.getValue()) > 0.02f) t.put(e.getKey(), e.getValue());
            JSONObject o = new JSONObject()
                    .put("taste", t)
                    .put("reactions", new JSONObject(reactions))
                    .put("seen", new JSONArray(new LinkedHashSet<>(seen)))
                    .put("watchlist", new JSONArray(watchlist))
                    .put("seeded", new JSONArray(seeded))
                    .put("events", events);
            prefs.edit().putString("state", o.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
