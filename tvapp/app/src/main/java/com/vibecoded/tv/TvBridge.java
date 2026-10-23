package com.vibecoded.tv;

import android.Manifest;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * window.Android in the web code: what a web page can't do on its own. Every method is called on a
 * WebView background thread; anything that touches the activity goes through runOnUiThread.
 */
public class TvBridge {
    // AirPlay receivers Mirror Boost can hand off to, best first.
    private static final String[] RECEIVERS = {"com.ionitech.airscreen", "com.waxrain.airplaydmr", "com.sand.aircasttv"};
    private static final String[] SCAN_KEYS = {"wifi_scan_always_enabled", "ble_scan_always_enabled"};
    private static final String LIVE_TV = "com.sony.dtv.tvx";

    private final WebActivity activity;
    private final Context ctx;
    private final PackageManager pm;

    TvBridge(WebActivity activity, WebView web) {
        this.activity = activity;
        this.ctx = activity.getApplicationContext();
        this.pm = ctx.getPackageManager();
    }

    @JavascriptInterface
    public boolean isTv() {
        return true;
    }

    // ---------- apps ----------

    /** Launchable TV apps: [{pkg, label, art (PNG data URL), banner (true if a real 16:9 banner)}]. */
    @JavascriptInterface
    public String apps() {
        JSONArray out = new JSONArray();
        Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        Set<String> seen = new HashSet<>();
        for (ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(ctx.getPackageName()) || !seen.add(pkg)) continue;
            try {
                Drawable banner = ri.activityInfo.loadBanner(pm);
                if (banner == null) banner = ri.activityInfo.applicationInfo.loadBanner(pm);
                Drawable art = banner != null ? banner : ri.loadIcon(pm);
                out.put(new JSONObject()
                        .put("pkg", pkg)
                        .put("label", String.valueOf(ri.loadLabel(pm)))
                        .put("banner", banner != null)
                        .put("art", dataUrl(art, banner != null)));
            } catch (JSONException | RuntimeException ignored) {
                // one app's broken icon shouldn't hide the rest
            }
        }
        return out.toString();
    }

    @JavascriptInterface
    public boolean launch(String pkg) {
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        return i != null && start(i);
    }

    @JavascriptInterface
    public boolean installed(String pkg) {
        try {
            return pm.getApplicationInfo(pkg, 0).enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    // ---------- inputs ----------

    /** HDMI and other inputs: [{id, label, type, passthrough, connected}]. CEC device names win over port names. */
    @JavascriptInterface
    public String inputs() {
        JSONArray out = new JSONArray();
        TvInputManager tim = (TvInputManager) ctx.getSystemService(Context.TV_INPUT_SERVICE);
        if (tim == null) return out.toString();
        List<TvInputInfo> list = tim.getTvInputList();
        Set<String> parentsWithDevice = new HashSet<>();
        for (TvInputInfo info : list) if (info.getParentId() != null) parentsWithDevice.add(info.getParentId());
        for (TvInputInfo info : list) {
            try {
                if (info.isHidden(ctx)) continue;
                if (parentsWithDevice.contains(info.getId())) continue;   // shown as its CEC device instead
                CharSequence custom = info.loadCustomLabel(ctx);
                String label = String.valueOf(custom != null && custom.length() > 0 ? custom : info.loadLabel(ctx));
                String port = info.getParentId() != null ? portLabel(list, info.getParentId()) : label;
                out.put(new JSONObject()
                        .put("id", info.getId())
                        .put("label", label)
                        .put("port", port)
                        .put("type", info.getType())
                        .put("passthrough", info.isPassthroughInput())
                        .put("connected", tim.getInputState(info.getId()) == TvInputManager.INPUT_STATE_CONNECTED));
            } catch (JSONException | RuntimeException ignored) {
            }
        }
        return out.toString();
    }

    private String portLabel(List<TvInputInfo> list, String id) {
        for (TvInputInfo i : list) if (i.getId().equals(id)) return String.valueOf(i.loadLabel(ctx));
        return "";
    }

    /** Switch to an input: passthrough inputs (HDMI, AV) through their channel URI, which Sony's Live TV
     *  app plays; the tuner by opening Live TV itself. */
    @JavascriptInterface
    public boolean openInput(String id) {
        TvInputManager tim = (TvInputManager) ctx.getSystemService(Context.TV_INPUT_SERVICE);
        TvInputInfo info = tim == null ? null : tim.getTvInputInfo(id);
        if (info != null && info.isPassthroughInput()) {
            Uri uri = TvContract.buildChannelUriForPassthroughInput(id);
            if (start(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "vnd.android.cursor.item/channel"))) return true;
        }
        return launch(LIVE_TV);
    }

    // ---------- other screens ----------

    @JavascriptInterface
    public void openSettings(String which) {
        String action = "picture".equals(which) ? Settings.ACTION_DISPLAY_SETTINGS
                : "network".equals(which) ? Settings.ACTION_WIRELESS_SETTINGS
                : Settings.ACTION_SETTINGS;
        if (!start(new Intent(action))) start(new Intent(Settings.ACTION_SETTINGS));
    }

    @JavascriptInterface
    public void openQueue(String film) {
        start(new Intent(ctx, QueueActivity.class).putExtra(QueueActivity.EXTRA_FILM, film == null ? "" : film));
    }

    @JavascriptInterface
    public void openMirror() {
        start(new Intent(ctx, MirrorActivity.class));
    }

    @JavascriptInterface
    public void exit() {
        activity.runOnUiThread(activity::exitFromPage);
    }

    // ---------- network ----------

    /** {type: ethernet|wifi|none, name, band, mbps, rssi} */
    @JavascriptInterface
    public String network() {
        JSONObject o = new JSONObject();
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            if (nc == null) return o.put("type", "none").toString();
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                return o.put("type", "ethernet").put("name", "Ethernet")
                        .put("mbps", nc.getLinkDownstreamBandwidthKbps() / 1000).toString();
            }
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
                WifiInfo wi = wm == null ? null : wm.getConnectionInfo();
                o.put("type", "wifi").put("name", "Wi-Fi");
                if (wi != null) {
                    String ssid = wi.getSSID();
                    if (ssid != null && !ssid.contains("unknown ssid")) o.put("name", ssid.replace("\"", ""));
                    int f = wi.getFrequency();
                    o.put("band", f >= 5925 ? "6 GHz" : f >= 4900 ? "5 GHz" : "2.4 GHz")
                            .put("mbps", wi.getLinkSpeed()).put("rssi", wi.getRssi());
                }
                return o.toString();
            }
            return o.put("type", "other").put("name", "Connected").toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    // ---------- Mirror Boost ----------

    @JavascriptInterface
    public String mirrorStatus() {
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            JSONObject o = new JSONObject()
                    .put("network", new JSONObject(network()))
                    .put("memFreeMb", mi.availMem / 1048576)
                    .put("memTotalMb", mi.totalMem / 1048576)
                    .put("canWriteSettings", canWriteSettings())
                    .put("boosted", prefs().getBoolean("boosted", false))
                    .put("receiver", receiver() == null ? JSONObject.NULL : receiver())
                    .put("receiverLabel", receiver() == null ? JSONObject.NULL : label(receiver()));
            for (String k : SCAN_KEYS) o.put(k, Settings.Global.getInt(ctx.getContentResolver(), k, 1));
            return o.toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    /** Turn background scanning off (saving what it was), close background apps, report memory before/after. */
    @JavascriptInterface
    public String mirrorBoost() {
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            long before = availMb(am);
            boolean scansOff = false;
            if (canWriteSettings()) {
                SharedPreferences p = prefs();
                SharedPreferences.Editor e = p.edit();
                for (String k : SCAN_KEYS) {
                    if (!p.contains("orig_" + k)) e.putInt("orig_" + k, Settings.Global.getInt(ctx.getContentResolver(), k, 1));
                    Settings.Global.putInt(ctx.getContentResolver(), k, 0);
                }
                e.putBoolean("boosted", true).apply();
                scansOff = true;
            }
            String keep = receiver();
            int closed = 0;
            for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
                if (ai.packageName.equals(ctx.getPackageName()) || ai.packageName.equals(keep)) continue;
                am.killBackgroundProcesses(ai.packageName);
                closed++;
            }
            return new JSONObject().put("scansOff", scansOff).put("checked", closed)
                    .put("memBeforeMb", before).put("memAfterMb", availMb(am)).toString();
        } catch (JSONException | SecurityException e) {
            return "{\"error\":\"" + e.getClass().getSimpleName() + "\"}";
        }
    }

    /** Put scanning back the way it was before the first boost. */
    @JavascriptInterface
    public boolean mirrorUndo() {
        if (!canWriteSettings()) return false;
        SharedPreferences p = prefs();
        SharedPreferences.Editor e = p.edit();
        for (String k : SCAN_KEYS) {
            if (p.contains("orig_" + k)) Settings.Global.putInt(ctx.getContentResolver(), k, p.getInt("orig_" + k, 1));
            e.remove("orig_" + k);
        }
        e.putBoolean("boosted", false).apply();
        return true;
    }

    @JavascriptInterface
    public boolean openReceiver() {
        String r = receiver();
        return r != null && launch(r);
    }

    // ---------- helpers ----------

    private String receiver() {
        for (String r : RECEIVERS) if (installed(r)) return r;
        return null;
    }

    private String label(String pkg) {
        try {
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
    }

    private boolean canWriteSettings() {
        return ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED;
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences("mirror_boost", Context.MODE_PRIVATE);
    }

    private static long availMb(ActivityManager am) {
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        return mi.availMem / 1048576;
    }

    private boolean start(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** A drawable as a PNG data URL: banners at 320x180, icons centred on a transparent 320x180. */
    private static String dataUrl(Drawable d, boolean isBanner) {
        int w = 320, h = 180;
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        if (isBanner) {
            d.setBounds(0, 0, w, h);
        } else {
            int s = 120;
            d.setBounds((w - s) / 2, (h - s) / 2, (w + s) / 2, (h + s) / 2);
        }
        d.draw(c);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        bmp.recycle();
        return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }
}
