package com.vibecoded.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * Hosts one page of the web code (../../web, bundled as assets) full screen. The page is served from
 * https://appassets.androidplatform.net/assets/ so YouTube's player accepts it and localStorage is
 * shared between Home, Queue and Mirror Boost. The remote's arrows and OK reach the page as arrow keys
 * and Enter; Back is turned into an Escape key press, which the page handles itself.
 */
public abstract class WebActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    protected WebView web;

    /** Path under the assets root, with any query string, e.g. "queue/index.html?film=dune". */
    protected abstract String startPath();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect over ADB, for fixing things on the TV
        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        // Holding OK means "options" in the page; don't let Android turn it into a text-selection long press.
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.setHapticFeedbackEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // trailers autoplay with sound when it's turned on
        s.setAllowFileAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay inside our own pages; YouTube embeds load in their own frames and aren't affected.
                Uri u = request.getUrl();
                return !(ORIGIN.equals(u.getScheme() + "://" + u.getHost()));
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new TvBridge(this, web), "Android");
        setContentView(web);
        web.loadUrl(ORIGIN + "/assets/" + startPath());
        web.requestFocus();
    }

    /** Back becomes Escape for the page. The page decides what Back means (and calls Android.exit()). */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                sendKey("Escape");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    protected void sendKey(String key) {
        String js = "(function(){var o={key:'" + key + "',bubbles:true};"
                + "window.dispatchEvent(new KeyboardEvent('keydown',o));"
                + "window.dispatchEvent(new KeyboardEvent('keyup',o));})()";
        web.evaluateJavascript(js, null);
    }

    protected void sendEvent(String name) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('" + name + "'))", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        sendEvent("vtv:resume");
    }

    @Override
    protected void onPause() {
        sendEvent("vtv:pause");
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** The page asked to leave (Back on its first screen). Home overrides this to stay put. */
    void exitFromPage() {
        finish();
    }
}
