package com.vibecoded.tv;

import android.content.Intent;

/** The TV's Home screen. Pressing Home while it's open brings the page back to its first screen. */
public class HomeActivity extends WebActivity {
    @Override
    protected String startPath() {
        return "index.html";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        sendEvent("vtv:home");
    }

    @Override
    void exitFromPage() {
        // Home is never "closed".
    }
}
