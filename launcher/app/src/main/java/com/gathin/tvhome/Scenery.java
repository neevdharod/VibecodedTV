package com.gathin.tvhome;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Log;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Apple TV mode's other top banner: slow aerial scenery (New York, clouds, mountains) playing behind Home,
 * like Apple TV's and macOS's aerial wallpapers.
 *
 * The video plays in a SurfaceView behind the window, so the TV's video decoder and its own video plane do
 * the work, as they do for Netflix; the launcher's GPU-drawn frames are untouched. Each clip (assets
 * scenery.json, or a pushed copy in the app's files) is downloaded once into the app's files, one at a time,
 * and plays from there; until the first is in, Home shows its plain background.
 */
final class Scenery implements SurfaceHolder.Callback {
    interface Listener { void sceneChanged(String name, String place); }

    private static final String TAG = "TvHome.Scenery";
    /** Leave this much free on the TV: scenery is nice to have, not worth filling the storage for. */
    private static final long KEEP_FREE_BYTES = 1024L * 1024 * 1024;

    static final class Scene {
        final String id, name, place, url;
        Scene(String id, String name, String place, String url) {
            this.id = id; this.name = name; this.place = place; this.url = url;
        }
    }

    private final Context ctx;
    private final SurfaceView surface;
    private final List<Scene> scenes = new ArrayList<>();
    private final File dir;
    private final SharedPreferences prefs;
    private final ExecutorService downloader = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private MediaPlayer player;
    private boolean enabled, resumed, surfaceReady, downloading;
    private int index;
    String credit = "";

    Scenery(Context ctx, FrameLayout root, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        prefs = ctx.getSharedPreferences("scenery", Context.MODE_PRIVATE);
        index = prefs.getInt("index", 0);
        File base = ctx.getExternalFilesDir(null);
        dir = new File(base != null ? base : ctx.getFilesDir(), "scenery");
        load(ctx);
        surface = new SurfaceView(ctx);
        surface.getHolder().addCallback(this);
        surface.setVisibility(View.GONE);
        surface.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        // Behind everything in the window: Home's own views draw over it, with the window clear where they don't.
        root.addView(surface, 0, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void load(Context ctx) {
        try {
            File pushed = new File(ctx.getExternalFilesDir(null), "scenery.json");
            String json;
            if (pushed.isFile()) {
                try (InputStream in = new java.io.FileInputStream(pushed)) { json = read(in); }
            } else {
                try (InputStream in = ctx.getAssets().open("scenery.json")) { json = read(in); }
            }
            JSONObject doc = new JSONObject(json);
            credit = doc.optString("credit");
            JSONArray arr = doc.optJSONArray("scenes");
            for (int i = 0; arr != null && i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String id = o.optString("id"), url = o.optString("url");
                if (id.isEmpty() || !url.startsWith("https://")) continue;
                scenes.add(new Scene(id, o.optString("name"), o.optString("place"), url));
            }
        } catch (Exception e) {
            Log.w(TAG, "no scenery list", e);
        }
    }

    private static String read(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    boolean isEnabled() { return enabled; }

    /** Scenery on or off: on shows the video layer and starts playing (or fetching) the next clip. */
    void setEnabled(boolean on) {
        if (on == enabled) return;
        enabled = on;
        surface.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) play();
        else release();
    }

    void resume() {
        resumed = true;
        if (enabled) play();
    }

    void pause() {
        resumed = false;
        release();
    }

    void close() {
        release();
        downloader.shutdownNow();
    }

    // ---- SurfaceHolder.Callback ----

    @Override public void surfaceCreated(SurfaceHolder holder) {
        surfaceReady = true;
        play();
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}

    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        release();
    }

    // ---- playback ----

    private File fileFor(Scene s) {
        return new File(dir, s.id + ".mp4");
    }

    /** Plays the current clip if it is on the TV, else the next one that is; fetches what is missing. */
    private void play() {
        if (!enabled || !resumed || !surfaceReady || player != null || scenes.isEmpty()) return;
        for (int tries = 0; tries < scenes.size(); tries++) {
            Scene s = scenes.get(Math.floorMod(index, scenes.size()));
            File f = fileFor(s);
            if (f.isFile()) {
                start(s, f);
                fetchMissing();
                return;
            }
            index++;
        }
        fetchMissing();   // nothing here yet: play() runs again when the first download lands
    }

    private void start(Scene s, File f) {
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setDataSource(f.getPath());
            mp.setDisplay(surface.getHolder());
            mp.setVolume(0f, 0f);
            mp.setOnPreparedListener(MediaPlayer::start);
            mp.setOnCompletionListener(done -> next());
            mp.setOnErrorListener((bad, what, extra) -> {
                Log.w(TAG, "can't play " + s.id + " (" + what + "/" + extra + "), skipping it");
                //noinspection ResultOfMethodCallIgnored
                f.delete();   // a broken download: fetched again later
                main.post(this::next);
                return true;
            });
            mp.prepareAsync();
            player = mp;
            listener.sceneChanged(s.name, s.place);
        } catch (Exception e) {
            Log.w(TAG, "can't open " + f, e);
            mp.release();
        }
    }

    private void next() {
        release();
        index++;
        prefs.edit().putInt("index", Math.floorMod(index, Math.max(1, scenes.size()))).apply();
        play();
    }

    private void release() {
        if (player == null) return;
        try {
            player.release();
        } catch (Exception ignored) {
        }
        player = null;
    }

    // ---- downloads ----

    /** Fetches the first clip that isn't on the TV yet, one at a time, while there is room. */
    private void fetchMissing() {
        if (downloading || !enabled) return;
        Scene missing = null;
        for (int i = 0; i < scenes.size(); i++) {
            Scene s = scenes.get(Math.floorMod(index + i, scenes.size()));
            if (!fileFor(s).isFile()) { missing = s; break; }
        }
        if (missing == null) return;
        downloading = true;
        final Scene s = missing;
        downloader.execute(() -> {
            boolean ok = download(s);
            main.post(() -> {
                downloading = false;
                if (!ok) return;
                if (player == null) play();
                fetchMissing();
            });
        });
    }

    private boolean download(Scene s) {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        try {
            if (new StatFs(dir.getPath()).getAvailableBytes() < KEEP_FREE_BYTES) {
                Log.w(TAG, "less than 1 GB free: not fetching more scenery");
                return false;
            }
        } catch (IllegalArgumentException ignored) {
        }
        File part = new File(dir, s.id + ".part");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(s.url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return part.renameTo(fileFor(s));
        } catch (Exception e) {
            Log.w(TAG, "download of " + s.id + " failed", e);
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
