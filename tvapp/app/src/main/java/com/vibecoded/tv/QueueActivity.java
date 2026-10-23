package com.vibecoded.tv;

import android.content.Intent;
import android.net.Uri;

/** Queue, the movie finder. Started from Home's banner with an optional film id to open on. */
public class QueueActivity extends WebActivity {
    static final String EXTRA_FILM = "film";

    @Override
    protected String startPath() {
        String film = getIntent().getStringExtra(EXTRA_FILM);
        return "queue/index.html" + (film == null || film.isEmpty() ? "" : "?film=" + Uri.encode(film));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        web.loadUrl(ORIGIN + "/assets/" + startPath());
    }
}
