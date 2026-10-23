package com.vibecoded.tv;

/** Mirror Boost on its own: the home screen's Mirror Boost page, where Back leaves the app. */
public class MirrorActivity extends WebActivity {
    @Override
    protected String startPath() {
        return "index.html?screen=mirror&standalone=1";
    }
}
