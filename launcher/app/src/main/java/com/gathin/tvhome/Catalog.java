package com.gathin.tvhome;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Films and shows for Queue and the Top Shelf, built on the computer by tools/build_catalog.py (TMDB for
 * art, descriptions and services; IMDb for ratings). A newer copy pushed to the TV at
 * /sdcard/Android/data/com.gathin.tvhome/files/catalog.json wins over the one bundled in the APK, so the
 * list can be refreshed without reinstalling. Loaded once, off the main thread.
 */
final class Catalog {
    static final class Title {
        String id, type, title, overview, cert, imdb, maker, backdrop, poster, logo;
        int year, length, votes;
        double rating;
        String[] genres, keywords, cast, services, because;
        /** service id -> a link that opens this title in that service's app (where Wikidata knows one). */
        final Map<String, String> links = new HashMap<>();
        boolean isShow() { return "tv".equals(type); }
    }

    final List<Title> titles;
    final List<Title> watched;
    final Map<String, Title> byId = new HashMap<>();
    final String imageBase;
    final String attribution;

    private static Catalog instance;

    private Catalog(List<Title> titles, List<Title> watched, String imageBase, String attribution) {
        this.titles = titles;
        this.watched = watched;
        this.imageBase = imageBase;
        this.attribution = attribution;
        for (Title t : titles) byId.put(t.id, t);
    }

    /** The catalog, loading it on first use (call from a background thread). Never null; empty on failure. */
    static synchronized Catalog get(Context ctx) {
        if (instance == null) instance = load(ctx.getApplicationContext());
        return instance;
    }

    String backdrop(Title t, String size) {
        return t.backdrop == null ? null : imageBase + size + t.backdrop;
    }

    /** The title's logo (a transparent PNG), or null when TMDB has no English one. */
    String logo(Title t, String size) {
        return t.logo == null ? null : imageBase + size + t.logo;
    }

    private static Catalog load(Context ctx) {
        try {
            String json;
            File pushed = new File(ctx.getExternalFilesDir(null), "catalog.json");
            if (pushed.isFile() && pushed.length() > 0) {
                try (InputStream in = new FileInputStream(pushed)) { json = read(in); }
            } else {
                try (InputStream in = ctx.getAssets().open("catalog.json")) { json = read(in); }
            }
            JSONObject doc = new JSONObject(json);
            return new Catalog(titles(doc.optJSONArray("titles")), titles(doc.optJSONArray("watched")),
                    doc.optString("image_base", "https://image.tmdb.org/t/p/"), doc.optString("attribution", ""));
        } catch (Exception e) {
            return new Catalog(Collections.emptyList(), Collections.emptyList(), "", "");
        }
    }

    private static List<Title> titles(JSONArray arr) {
        List<Title> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Title t = new Title();
            t.id = o.optString("id");
            t.type = o.optString("type");
            t.title = o.optString("title");
            t.overview = o.optString("overview");
            t.cert = o.isNull("cert") ? null : o.optString("cert", null);
            t.imdb = o.isNull("imdb") ? null : o.optString("imdb", null);
            t.maker = o.optString("maker");
            t.backdrop = o.isNull("backdrop") ? null : o.optString("backdrop", null);
            t.poster = o.isNull("poster") ? null : o.optString("poster", null);
            t.logo = o.isNull("logo") ? null : o.optString("logo", null);
            t.year = o.optInt("year");
            t.length = o.optInt("length");
            t.votes = o.optInt("votes");
            t.rating = o.optDouble("rating", 0);
            t.genres = strings(o.optJSONArray("genres"));
            t.keywords = strings(o.optJSONArray("keywords"));
            t.cast = strings(o.optJSONArray("cast"));
            t.services = strings(o.optJSONArray("services"));
            t.because = strings(o.optJSONArray("because"));
            JSONObject links = o.optJSONObject("links");
            if (links != null) for (java.util.Iterator<String> it = links.keys(); it.hasNext(); ) {
                String s = it.next();
                t.links.put(s, links.optString(s));
            }
            out.add(t);
        }
        return out;
    }

    private static String[] strings(JSONArray a) {
        if (a == null) return new String[0];
        String[] out = new String[a.length()];
        for (int i = 0; i < a.length(); i++) out[i] = a.optString(i);
        return out;
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
