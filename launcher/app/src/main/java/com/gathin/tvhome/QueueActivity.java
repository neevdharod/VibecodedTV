package com.gathin.tvhome;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Queue: one film or show at a time, full screen, like a vertical video feed but with the cover instead of
 * a trailer. No setup: it opens straight on the best pick.
 *
 *   Up / Down   previous / next
 *   OK          watch it in the app that has it (Netflix, Prime Video, Disney+), else Love
 *   Right       the rail: Love, Not for me, Watchlist (Up/Down to choose, OK, Left to go back)
 *   Back        leave
 *
 * Skipping a card within 4 s counts a little against it, staying 12 s counts a little for it.
 */
public class QueueActivity extends Activity {
    static final String EXTRA_TITLE = "title_id";
    private static final int ART_WIDTH = 1280;
    private static final String SCRIM_TAG = "scrim";
    private static final int SLIDE_MS = 200;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<Taste.Pick> history = new ArrayList<>();
    private int index = -1;
    private long shownAt;
    private boolean judged;
    private Taste taste;
    private Catalog catalog;
    private Taste.Pick upcoming;          // the next pick, worked out in the background after each card

    private View pageA, pageB, front, back, rail, root;
    private TextView toast, hints;
    private View[] railItems;
    private int railIndex = -1;           // -1: focus is on the card, not the rail
    private boolean animating;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_queue);
        // The two cards always cover the screen between them, so the window's own black is never seen.
        getWindow().setBackgroundDrawable(null);
        root = findViewById(R.id.queueRoot);
        pageA = findViewById(R.id.pageA);
        pageB = findViewById(R.id.pageB);
        front = pageA;
        back = pageB;
        back.setVisibility(View.INVISIBLE);
        toast = findViewById(R.id.toast);
        hints = findViewById(R.id.hints);
        rail = findViewById(R.id.rail);
        railItems = new View[]{findViewById(R.id.railLove), findViewById(R.id.railPass), findViewById(R.id.railSave)};
        setRail(0, R.drawable.ic_q_heart, "Love");
        setRail(1, R.drawable.ic_q_close, "Not for me");
        setRail(2, R.drawable.ic_q_plus, "Watchlist");
        hints.setText("↑ ↓  Browse     OK  Watch     →  More");

        String start = getIntent().getStringExtra(EXTRA_TITLE);
        worker.execute(() -> {
            Taste t = Queue.taste(this);
            Catalog c = Catalog.get(this);
            Taste.Pick first = null;
            if (start != null && c.byId.containsKey(start)) first = t.pick(c.byId.get(start));
            if (first == null) {
                List<Taste.Pick> picks = t.next(1, new ArrayList<>(), null);
                if (!picks.isEmpty()) first = picks.get(0);
            }
            Taste.Pick firstPick = first;
            main.post(() -> {
                taste = t;
                catalog = c;
                ((TextView) findViewById(R.id.credit)).setText(c.attribution);
                if (firstPick == null) { showToast("Nothing to show yet"); return; }
                history.add(firstPick);
                index = 0;
                bind(front, firstPick);
                markShown();
                planAhead();
            });
        });
    }

    // ---------- cards ----------

    private void bind(View page, Taste.Pick p) {
        Catalog.Title t = p.title;
        ((TextView) page.findViewById(R.id.match)).setText(p.match + "% match");
        ((TextView) page.findViewById(R.id.why)).setText(p.reason);
        ((TextView) page.findViewById(R.id.title)).setText(t.title);
        ((TextView) page.findViewById(R.id.year)).setText(t.year > 0 ? String.valueOf(t.year) : "");
        TextView cert = page.findViewById(R.id.cert);
        cert.setText(t.cert == null ? "" : t.cert);
        cert.setVisibility(t.cert == null || t.cert.isEmpty() ? View.GONE : View.VISIBLE);
        ((TextView) page.findViewById(R.id.length)).setText(Queue.length(t));
        ((TextView) page.findViewById(R.id.rating)).setText(String.format(java.util.Locale.US, "%.1f", t.rating));
        ((TextView) page.findViewById(R.id.votes)).setText(t.votes > 0 ? Queue.votes(t.votes) : "");
        StringBuilder g = new StringBuilder(String.join("  ·  ", t.genres));
        if (t.cast.length > 0) g.append("     ").append(String.join(", ", java.util.Arrays.copyOf(t.cast, Math.min(2, t.cast.length))));
        ((TextView) page.findViewById(R.id.genres)).setText(g);
        ((TextView) page.findViewById(R.id.overview)).setText(t.overview);
        TextView watch = page.findViewById(R.id.watch);
        String service = Queue.installedService(this, t);
        watch.setText(service != null ? "▶  Watch on " + Queue.serviceName(service)
                : t.services.length > 0 ? "On " + Queue.serviceName(t.services[0]) + " (not installed)" : "♥  Love it");
        page.setTag(p);

        ImageView art = page.findViewById(R.id.art);
        String url = catalog.backdrop(t, "w1280");
        Bitmap hit = ImageLoader.cached(url, SCRIM_TAG);
        art.setImageBitmap(hit);
        art.setAlpha(hit != null ? 1f : 0f);
        // The card's black only shows until its cover is in: then it would be one more full-screen fill a frame.
        if (hit != null) page.setBackground(null);
        else page.setBackgroundColor(0xFF000000);
        if (hit == null) {
            ImageLoader.load(url, ART_WIDTH, SCRIM_TAG, QueueActivity::bakeScrim, bmp -> {
                if (page.getTag() != p || bmp == null) return;
                art.setImageBitmap(bmp);
                art.animate().alpha(1f).setDuration(220).withEndAction(() -> {
                    if (page.getTag() == p) page.setBackground(null);
                }).start();
            });
        }
        updateRail(p);
    }

    private Taste.Pick current() {
        return index >= 0 && index < history.size() ? history.get(index) : null;
    }

    private void markShown() {
        shownAt = System.currentTimeMillis();
        judged = false;
    }

    /** Implicit feedback for the card being left, unless you already reacted to it. */
    private void leave() {
        Taste.Pick p = current();
        if (p == null || judged || taste.reactions.containsKey(p.title.id)) return;
        long dwell = System.currentTimeMillis() - shownAt;
        String id = p.title.id;
        worker.execute(() -> {
            if (dwell < 4000) taste.record(id, "bounce");
            else if (dwell > 12000) taste.record(id, "watched");
            else taste.markSeen(id);
        });
        judged = true;
    }

    /**
     * Darkens the left side and the bottom of a cover so the text reads over it: drawn into the picture
     * once, in the background, instead of a full-screen gradient view over it in every frame.
     */
    static Bitmap bakeScrim(Bitmap src) {
        Bitmap out = src.isMutable() ? src : src.copy(Bitmap.Config.RGB_565, true);
        int w = out.getWidth(), h = out.getHeight();
        android.graphics.Canvas canvas = new android.graphics.Canvas(out);
        android.graphics.Paint paint = new android.graphics.Paint();
        paint.setDither(true);
        paint.setShader(new android.graphics.LinearGradient(0, 0, w, 0,
                new int[]{0xE6000000, 0x66000000, 0x00000000}, new float[]{0f, 0.5f, 1f},
                android.graphics.Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, paint);
        paint.setShader(new android.graphics.LinearGradient(0, h, 0, 0,
                new int[]{0xF2000000, 0x40000000, 0x00000000}, new float[]{0f, 0.5f, 1f},
                android.graphics.Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, paint);
        return out;
    }

    /** Work out the next pick and fetch its cover while you look at this one. */
    private void planAhead() {
        List<String> recent = recentIds();
        upcoming = null;
        worker.execute(() -> {
            List<Taste.Pick> picks = taste.next(1, recent, null);
            Taste.Pick next = picks.isEmpty() ? null : picks.get(0);
            main.post(() -> {
                upcoming = next;
                if (next != null) {
                    ImageLoader.load(catalog.backdrop(next.title, "w1280"), ART_WIDTH, SCRIM_TAG, QueueActivity::bakeScrim, null);
                }
            });
        });
    }

    private List<String> recentIds() {
        List<String> ids = new ArrayList<>();
        for (Taste.Pick p : history) ids.add(p.title.id);
        return ids;
    }

    private void go(int step) {
        if (animating || taste == null) return;
        if (step < 0 && index <= 0) { showToast("You're at the start"); return; }
        Taste.Pick target;
        if (step > 0) {
            if (index + 1 < history.size()) target = history.get(index + 1);
            else {
                target = upcoming;
                if (target == null) {
                    List<Taste.Pick> picks = taste.next(1, recentIds(), null);   // not ready yet: work it out now
                    if (picks.isEmpty()) { showToast("That's everything for now"); return; }
                    target = picks.get(0);
                }
                history.add(target);
            }
        } else {
            target = history.get(index - 1);
        }
        leave();
        index += step;
        slide(target, step);
        markShown();
        if (step > 0 && index == history.size() - 1) planAhead();
    }

    private void slide(Taste.Pick p, int step) {
        int h = root.getHeight();
        bind(back, p);
        back.setTranslationY(step > 0 ? h : -h);
        back.setVisibility(View.VISIBLE);
        animating = true;
        DecelerateInterpolator ease = new DecelerateInterpolator(2f);
        // Short enough that browsing feels quick; the decelerate curve keeps it from looking like a cut.
        View out = front;
        // Each card is one picture with its scrim baked in (bakeScrim) and some text, so a frame of the slide
        // is about two full-screen fills; this TV's GPU, not the app, was what made the slide slow.
        out.animate().translationY(step > 0 ? -h : h).setDuration(SLIDE_MS).setInterpolator(ease).start();
        back.animate().translationY(0).setDuration(SLIDE_MS).setInterpolator(ease).withEndAction(() -> {
            out.setVisibility(View.INVISIBLE);
            out.setTranslationY(0);
            animating = false;
        }).start();
        front = back;
        back = out;
    }

    // ---------- actions ----------

    private void love() {
        Taste.Pick p = current();
        if (p == null) return;
        String id = p.title.id;
        if ("love".equals(taste.reactions.get(id))) {
            taste.undo(id);
            showToast("Removed from your loves");
        } else {
            judged = true;
            worker.execute(() -> taste.record(id, "love"));
            taste.reactions.put(id, "love");   // so the rail updates now; record() sets it too
            showToast("Got it: more like " + p.title.title);
            planAhead();   // the next pick should already reflect this
        }
        updateRail(p);
    }

    private void pass() {
        Taste.Pick p = current();
        if (p == null) return;
        judged = true;
        String id = p.title.id;
        taste.reactions.put(id, "pass");
        worker.execute(() -> taste.record(id, "pass"));
        showToast("Fewer like this");
        upcoming = null;
        planAhead();
        main.postDelayed(() -> go(1), 120);
    }

    private void save() {
        Taste.Pick p = current();
        if (p == null) return;
        boolean added = taste.toggleWatchlist(p.title.id);
        showToast(added ? "Added to your watchlist" : "Removed from your watchlist");
        updateRail(p);
    }

    private void watch() {
        Taste.Pick p = current();
        if (p == null) return;
        String service = Queue.installedService(this, p.title);
        if (service == null) { love(); return; }
        boolean searched = Queue.watchOn(this, service, p.title);
        if (!searched) showToast("Search for “" + p.title.title + "” in " + Queue.serviceName(service));
    }

    // ---------- rail ----------

    private void setRail(int i, int icon, String label) {
        ((ImageView) railItems[i].findViewById(R.id.icon)).setImageResource(icon);
        ((TextView) railItems[i].findViewById(R.id.label)).setText(label);
    }

    private void updateRail(Taste.Pick p) {
        boolean loved = p != null && "love".equals(taste == null ? null : taste.reactions.get(p.title.id));
        boolean saved = p != null && taste != null && taste.watchlist.contains(p.title.id);
        setRail(0, loved ? R.drawable.ic_q_heart_on : R.drawable.ic_q_heart, loved ? "Loved" : "Love");
        setRail(2, saved ? R.drawable.ic_q_check : R.drawable.ic_q_plus, saved ? "Saved" : "Watchlist");
        for (int i = 0; i < railItems.length; i++) {
            View circle = railItems[i].findViewById(R.id.circle);
            boolean on = i == railIndex;
            circle.setSelected(on);
            ImageView icon = railItems[i].findViewById(R.id.icon);
            icon.setColorFilter(on && !(i == 0 && loved) && !(i == 2 && saved) ? 0xFF101014 : 0);
            circle.animate().scaleX(on ? 1.12f : 1f).scaleY(on ? 1.12f : 1f).setDuration(150).start();
        }
        View watch = front.findViewById(R.id.watch);
        watch.setAlpha(railIndex < 0 ? 1f : 0.55f);
    }

    // ---------- input ----------

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e);
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_BACK) {
            if (railIndex >= 0) { railIndex = -1; updateRail(current()); return true; }
            leave();
            finish();
            return true;
        }
        if (taste == null) return true;
        if (railIndex >= 0) {
            switch (k) {
                case KeyEvent.KEYCODE_DPAD_UP: railIndex = (railIndex + railItems.length - 1) % railItems.length; break;
                case KeyEvent.KEYCODE_DPAD_DOWN: railIndex = (railIndex + 1) % railItems.length; break;
                case KeyEvent.KEYCODE_DPAD_LEFT: railIndex = -1; break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (railIndex == 0) love();
                    else if (railIndex == 1) { railIndex = -1; pass(); }
                    else save();
                    break;
                default: return super.dispatchKeyEvent(e);
            }
            updateRail(current());
            return true;
        }
        switch (k) {
            case KeyEvent.KEYCODE_DPAD_DOWN: go(1); return true;
            case KeyEvent.KEYCODE_DPAD_UP: go(-1); return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT: railIndex = 0; updateRail(current()); return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER: watch(); return true;
            default: return super.dispatchKeyEvent(e);
        }
    }

    private final Runnable hideToast = () -> toast.animate().alpha(0f).setDuration(250).start();

    private void showToast(String text) {
        toast.setText(text);
        toast.animate().alpha(1f).setDuration(150).start();
        main.removeCallbacks(hideToast);
        main.postDelayed(hideToast, 2200);
    }

    @Override
    protected void onDestroy() {
        worker.shutdown();
        super.onDestroy();
    }
}
