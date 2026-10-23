package com.gathin.tvhome;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Cover art for Queue and the Top Shelf: downloaded on two background threads, decoded as RGB_565 at no
 * more than the size asked for (a 2 GB TV can't hold many full-size ARGB backdrops), kept in a small LRU.
 */
final class ImageLoader {
    interface Done { void loaded(Bitmap bitmap); }
    /** Work done to a picture once, in the background, before it is cached (Queue bakes its scrim in). */
    interface Transform { Bitmap apply(Bitmap bitmap); }

    private static final LruCache<String, Bitmap> CACHE = new LruCache<String, Bitmap>(
            (int) Math.min(Runtime.getRuntime().maxMemory() / 1024 / 6, 24 * 1024)) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getByteCount() / 1024; }
    };
    private static final ExecutorService POOL = Executors.newFixedThreadPool(2);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Map<String, List<Done>> PENDING = new HashMap<>();

    private ImageLoader() {}

    static Bitmap cached(String url) {
        return cached(url, null);
    }

    static Bitmap cached(String url, String tag) {
        return url == null ? null : CACHE.get(key(url, tag));
    }

    /** Loads url (decoded to at most maxWidth px wide) and calls done on the main thread; null on failure. */
    static void load(String url, int maxWidth, Done done) {
        load(url, maxWidth, null, null, done);
    }

    /** The same, with transform applied before caching; tag names the transform in the cache. */
    static void load(String url, int maxWidth, String tag, Transform transform, Done done) {
        load(url, maxWidth, tag, transform, false, done);
    }

    /** Pictures with transparency (logos) need alpha: keep them ARGB instead of the usual RGB_565. */
    static void loadWithAlpha(String url, int maxWidth, Done done) {
        load(url, maxWidth, "argb", null, true, done);
    }

    static Bitmap cachedWithAlpha(String url) {
        return cached(url, "argb");
    }

    private static void load(String url, int maxWidth, String tag, Transform transform, boolean alpha, Done done) {
        if (url == null) { if (done != null) done.loaded(null); return; }
        String key = key(url, tag);
        Bitmap hit = CACHE.get(key);
        if (hit != null) { if (done != null) done.loaded(hit); return; }
        synchronized (PENDING) {
            List<Done> waiting = PENDING.get(key);
            if (waiting != null) { if (done != null) waiting.add(done); return; }
            waiting = new ArrayList<>();
            if (done != null) waiting.add(done);
            PENDING.put(key, waiting);
        }
        POOL.execute(() -> {
            Bitmap bmp = fetch(url, maxWidth, alpha ? Bitmap.Config.ARGB_8888 : Bitmap.Config.RGB_565);
            if (bmp != null && transform != null) {
                try {
                    bmp = transform.apply(bmp);
                } catch (Exception | OutOfMemoryError e) {
                    bmp = null;
                }
            }
            if (bmp != null) {
                // Starts the GPU upload now, on the render thread, rather than in the first frame that
                // draws it (a full-screen backdrop's upload was the slow frame at the start of a slide).
                bmp.prepareToDraw();
                CACHE.put(key, bmp);
            }
            final Bitmap result = bmp;
            List<Done> callbacks;
            synchronized (PENDING) { callbacks = PENDING.remove(key); }
            MAIN.post(() -> { if (callbacks != null) for (Done d : callbacks) d.loaded(result); });
        });
    }

    static void prefetch(String url, int maxWidth) {
        load(url, maxWidth, null);
    }

    private static String key(String url, String tag) {
        return tag == null ? url : url + "#" + tag;
    }

    private static Bitmap fetch(String url, int maxWidth, Bitmap.Config config) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            byte[] bytes;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                bytes = out.toByteArray();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = config;
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= maxWidth) sample *= 2;
            opts.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        } catch (Exception | OutOfMemoryError e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
