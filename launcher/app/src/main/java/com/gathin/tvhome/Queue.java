package com.gathin.tvhome;

import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

/** What Queue and the Top Shelf share: the streaming services, the taste model, and opening a title. */
final class Queue {
    /** id, name, package: the services this TV has, in the order the catalog lists them. */
    static final String[][] SERVICES = {
            {"netflix", "Netflix", "com.netflix.ninja"},
            {"prime", "Prime Video", "com.amazon.amazonvideo.livingroom"},
            {"disney", "Disney+", "com.disney.disneyplus"},
    };

    /** volatile so tasteIfLoaded never waits on the lock taste() holds while the catalog loads (seconds on the TV). */
    private static volatile Taste taste;

    private Queue() {}

    /** The shared taste model (call off the main thread the first time: it loads the catalog). */
    static synchronized Taste taste(Context ctx) {
        if (taste == null) taste = new Taste(ctx.getApplicationContext(), Catalog.get(ctx));
        return taste;
    }

    static Taste tasteIfLoaded() {
        return taste;
    }

    static String serviceName(String id) {
        for (String[] s : SERVICES) if (s[0].equals(id)) return s[1];
        return id;
    }

    static String servicePackage(String id) {
        for (String[] s : SERVICES) if (s[0].equals(id)) return s[2];
        return null;
    }

    /** The service a package is, or null: "com.netflix.ninja" -> "netflix". */
    static String serviceForPackage(String pkg) {
        for (String[] s : SERVICES) if (s[2].equals(pkg)) return s[0];
        return null;
    }

    /** The title's best service that's installed here (one that can open it directly first), or null. */
    static String installedService(Context ctx, Catalog.Title t) {
        PackageManager pm = ctx.getPackageManager();
        String any = null;
        for (String id : t.services) {
            String pkg = servicePackage(id);
            if (pkg == null) continue;
            try {
                if (!pm.getApplicationInfo(pkg, 0).enabled) continue;
            } catch (PackageManager.NameNotFoundException e) {
                continue;
            }
            if (t.links.containsKey(id)) return id;
            if (any == null) any = id;
        }
        return any;
    }

    /**
     * Opens the title in that service's app: straight on its page when the catalog has a link for it,
     * else the app's own search where it answers ACTION_SEARCH, else the app's start screen.
     * Returns true when it landed on the title (or a search for it).
     */
    static boolean watchOn(Context ctx, String service, Catalog.Title t) {
        String pkg = servicePackage(service);
        if (pkg == null) return false;
        String link = t.links.get(service);
        if (link != null) {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(pkg)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if ("netflix".equals(service)) view.putExtra("source", "30");   // Netflix's partner deep-link marker
            try {
                if (ctx.getPackageManager().resolveActivity(view, 0) != null) {
                    ctx.startActivity(view);
                    return true;
                }
            } catch (ActivityNotFoundException | SecurityException ignored) {
            }
        }
        if ("prime".equals(service)) {
            // Most Prime titles have no id we can find (Wikidata knows few). The app takes any
            // app.primevideo.com link, so try its search page; the caller still shows the search hint in
            // case this firmware's app opens its start screen instead.
            Intent view = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://app.primevideo.com/search?phrase=" + Uri.encode(t.title)))
                    .setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                if (ctx.getPackageManager().resolveActivity(view, 0) != null) {
                    ctx.startActivity(view);
                    return false;
                }
            } catch (ActivityNotFoundException | SecurityException ignored) {
            }
        }
        Intent search = new Intent(Intent.ACTION_SEARCH).setPackage(pkg)
                .putExtra(SearchManager.QUERY, t.title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            if (ctx.getPackageManager().resolveActivity(search, 0) != null) {
                ctx.startActivity(search);
                return true;
            }
        } catch (ActivityNotFoundException | SecurityException ignored) {
        }
        PackageManager pm = ctx.getPackageManager();
        Intent launch = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (launch == null) launch = pm.getLaunchIntentForPackage(pkg);
        if (launch == null) return false;
        ctx.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return false;
    }

    /** "2019 · 2h 12m" or "2008 · 5 seasons". */
    static String length(Catalog.Title t) {
        if (t.isShow()) return t.length == 1 ? "1 season" : t.length + " seasons";
        if (t.length <= 0) return "";
        return t.length >= 60 ? (t.length / 60) + "h " + (t.length % 60) + "m" : t.length + "m";
    }

    /** "2.7M" / "801K" votes. */
    static String votes(int v) {
        if (v >= 1_000_000) return String.format(java.util.Locale.US, "%.1fM", v / 1e6).replace(".0M", "M");
        if (v >= 1000) return (v / 1000) + "K";
        return String.valueOf(v);
    }
}
