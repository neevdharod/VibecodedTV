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
import androidx.media3.exoplayer.DefaultLoadControl;
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
 * scenery.json from tools/build_scenery.py, 100+ clips) is downloaded into the app's files and plays from
 * there; until the first is in, Home shows its plain background.
 *
 * Kept light on a 2 GB TV with little storage: at most KEEP_CLIPS clips (and KEEP_BYTES) are on the TV;
 * once that is full, a few new ones a day (NEW_PER_DAY) replace the ones that have been there longest, so
 * the whole list comes round over time. Downloads run only while Home is in front (one at a time, and they
 * stop the moment another app opens), never below 1 GB free; the player reads only a few seconds ahead.
 *
 * One ExoPlayer plays them all as a looping playlist. Stopping one player and starting another between
 * clips blanked the whole screen on this Sony (its picture processing drops out of video mode, Home's
 * apps with it) and stalled Home while the decoder shut down. In one playlist the video never stops, and
 * with every clip the same format (1920x1080 H.264) the decoder carries straight on into the next.
 */
final class Scenery implements SurfaceHolder.Callback {
    interface Listener { void sceneChanged(String name, String place); }

    private static final String TAG = "TvHome.Scenery";
    /** Leave this much free on the TV: scenery is nice to have, not worth filling the storage for. */
    private static final long KEEP_FREE_BYTES = 1024L * 1024 * 1024;
    /** The rotating set on the TV: about 30 1080p clips, never more than ~600 MB. */
    private static final int KEEP_CLIPS = 30;
    private static final long KEEP_BYTES = 600L * 1024 * 1024;
    /** Once the set is full, this many new clips a day replace the oldest. */
    private static final int NEW_PER_DAY = 6;

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
    /** Cleared the moment Home leaves the screen: a running download stops, so it never competes with an app. */
    private volatile boolean allowDownloads;
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
        allowDownloads = true;
        if (enabled) play();
        topUp();
    }

    void pause() {
        resumed = false;
        allowDownloads = false;
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
     * later join the end of it (topUp). Nothing on the TV yet: plays once the first download lands.
     */
    private void play() {
        if (!enabled || !resumed || !surfaceReady || player != null || scenes.isEmpty()) return;
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < scenes.size(); i++) {
            Scene s = scenes.get(Math.floorMod(index + i, scenes.size()));
            if (fileFor(s).isFile()) items.add(itemFor(s));
        }
        if (items.isEmpty()) {
            topUp();
            return;
        }
        // The clips are on the TV already: read a few seconds ahead, not ExoPlayer's default ~50 s / tens of MB.
        DefaultLoadControl buffer = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(2500, 6000, 1000, 1500)
                .setTargetBufferBytes(8 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(false)
                .build();
        ExoPlayer p = new ExoPlayer.Builder(ctx).setLoadControl(buffer).build();
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
                    main.post(() -> { release(); topUp(); });
                }
            }
        });
        p.setMediaItems(items);
        p.prepare();
        p.play();
        player = p;
        announce(items.get(0));
        topUp();
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

    /** The list's clips that are on the TV now. */
    private List<File> onTv() {
        List<File> out = new ArrayList<>();
        for (Scene s : scenes) if (fileFor(s).isFile()) out.add(fileFor(s));
        return out;
    }

    private int fetchedToday() {
        long day = System.currentTimeMillis() / 86_400_000L;
        return prefs.getLong("fetch_day", -1) == day ? prefs.getInt("fetched_today", 0) : 0;
    }

    private void countFetch() {
        long day = System.currentTimeMillis() / 86_400_000L;
        prefs.edit().putLong("fetch_day", day).putInt("fetched_today", fetchedToday() + 1).apply();
    }

    /**
     * Fetches the next clip of the list that isn't on the TV, one at a time, while Home is in front. Until
     * the set is full that is all; once full, up to NEW_PER_DAY a day, each replacing the clip that has been
     * on the TV longest (never the one playing).
     */
    private void topUp() {
        if (downloading || !enabled || !resumed || scenes.isEmpty()) return;
        List<File> have = onTv();
        long bytes = 0;
        for (File f : have) bytes += f.length();
        boolean full = have.size() >= KEEP_CLIPS || bytes >= KEEP_BYTES;
        if (full && fetchedToday() >= NEW_PER_DAY) return;
        int start = prefs.getInt("next_fetch", 0);
        Scene next = null;
        int at = -1;
        for (int i = 0; i < scenes.size(); i++) {
            int k = Math.floorMod(start + i, scenes.size());
            if (!fileFor(scenes.get(k)).isFile()) { next = scenes.get(k); at = k; break; }
        }
        if (next == null) return;   // the whole list is on the TV
        if (full && !evictOldest(have)) return;
        downloading = true;
        final Scene s = next;
        final int fetched = at;
        downloader.execute(() -> {
            boolean ok = download(s);
            main.post(() -> {
                downloading = false;
                if (!ok) return;
                prefs.edit().putInt("next_fetch", fetched + 1).apply();
                countFetch();
                if (player == null) play();
                else player.addMediaItem(itemFor(s));   // joins the end of the playlist, no restart
                topUp();
            });
        });
    }

    /** Makes room: deletes the clip that has been on the TV longest, unless it is the one playing. */
    private boolean evictOldest(List<File> have) {
        String playing = player != null && player.getCurrentMediaItem() != null ? player.getCurrentMediaItem().mediaId : null;
        File oldest = null;
        for (File f : have) {
            if (playing != null && f.getName().equals(playing + ".mp4")) continue;
            if (oldest == null || f.lastModified() < oldest.lastModified()) oldest = f;
        }
        if (oldest == null) return false;
        String id = oldest.getName().substring(0, oldest.getName().length() - 4);
        if (player != null) {
            for (int i = 0; i < player.getMediaItemCount(); i++) {
                if (player.getMediaItemAt(i).mediaId.equals(id)) { player.removeMediaItem(i); break; }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        oldest.delete();
        return true;
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
                while ((n = in.read(buf)) > 0) {
                    if (!allowDownloads) throw new java.io.InterruptedIOException("Home left the screen");
                    out.write(buf, 0, n);
                }
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
