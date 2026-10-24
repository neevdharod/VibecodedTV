package com.gathin.tvhome;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Log;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.widget.FrameLayout;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

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
 *
 * One ExoPlayer plays them all as a looping playlist. Stopping one player and starting another between
 * clips blanked the whole screen on this Sony (its picture processing drops out of video mode, Home's
 * apps with it) and stalled Home while the decoder shut down. In one playlist the video never stops, and
 * with every clip the same format (3840x2160 H.264) the decoder carries straight on into the next.
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
    private ExoPlayer player;
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
        dropRetired();
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

    /** Clips no longer in the list (and half-finished downloads) give their space back. */
    private void dropRetired() {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            boolean keep = false;
            for (Scene s : scenes) if (f.getName().equals(s.id + ".mp4")) keep = true;
            //noinspection ResultOfMethodCallIgnored
            if (!keep) f.delete();
        }
    }

    private Scene sceneFor(String id) {
        for (Scene s : scenes) if (s.id.equals(id)) return s;
        return null;
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

    private MediaItem itemFor(Scene s) {
        return new MediaItem.Builder().setMediaId(s.id).setUri(android.net.Uri.fromFile(fileFor(s))).build();
    }

    /**
     * Starts the looping playlist of every clip already on the TV, from where it last was; clips that land
     * later join the end of it (fetchMissing). Nothing on the TV yet: plays once the first download lands.
     */
    private void play() {
        if (!enabled || !resumed || !surfaceReady || player != null || scenes.isEmpty()) return;
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < scenes.size(); i++) {
            Scene s = scenes.get(Math.floorMod(index + i, scenes.size()));
            if (fileFor(s).isFile()) items.add(itemFor(s));
        }
        if (items.isEmpty()) {
            fetchMissing();
            return;
        }
        ExoPlayer p = new ExoPlayer.Builder(ctx).build();
        p.setVideoSurfaceHolder(surface.getHolder());
        p.setVolume(0f);
        p.setRepeatMode(Player.REPEAT_MODE_ALL);
        p.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                announce(item);
            }

            @Override public void onPlayerError(PlaybackException error) {
                // A clip the TV can't play (a broken download): drop it, fetch it again later, carry on.
                MediaItem bad = p.getCurrentMediaItem();
                Log.w(TAG, "can't play " + (bad == null ? "?" : bad.mediaId), error);
                if (bad != null) {
                    Scene s = sceneFor(bad.mediaId);
                    //noinspection ResultOfMethodCallIgnored
                    if (s != null) fileFor(s).delete();
                    p.removeMediaItem(p.getCurrentMediaItemIndex());
                }
                if (p.getMediaItemCount() > 0) {
                    p.prepare();
                    p.play();
                } else {
                    main.post(() -> { release(); fetchMissing(); });
                }
            }
        });
        p.setMediaItems(items);
        p.prepare();
        p.play();
        player = p;
        announce(items.get(0));
        fetchMissing();
    }

    /** The caption, and where to start next time. */
    private void announce(MediaItem item) {
        if (item == null) return;
        Scene s = sceneFor(item.mediaId);
        if (s == null) return;
        index = scenes.indexOf(s);
        prefs.edit().putInt("index", index).apply();
        listener.sceneChanged(s.name, s.place);
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
                else player.addMediaItem(itemFor(s));   // joins the end of the playlist, no restart
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
