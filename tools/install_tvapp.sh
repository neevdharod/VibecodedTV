#!/usr/bin/env bash
# Build the VibecodedTV app (home screen, Queue, Mirror Boost) and install it on the TV.
#
#   TV_HOST=192.168.0.182 tools/install_tvapp.sh            build, install, open Home
#   TV_HOST=192.168.0.182 tools/install_tvapp.sh --make-home  ...and make it the TV's Home (first time)
#
# Needs JDK 17 (~/.vibecodedtv/jdk17) and the Android SDK (~/Library/Android/sdk), and the TV on with
# USB debugging on. The APK goes over in chunks (tools/b64push.py): a plain ADB push stalls on this TV.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TV_HOST:?set TV_HOST to the TV IP address}"
export JAVA_HOME="${JAVA_HOME:-$HOME/.vibecodedtv/jdk17/Contents/Home}"
PY=tools/venv/bin/python
APK=tvapp/app/build/outputs/apk/release/app-release.apk

[ -f tvapp/local.properties ] || echo "sdk.dir=$HOME/Library/Android/sdk" > tvapp/local.properties
(cd tvapp && ./gradlew --no-daemon -q assembleRelease)
"$PY" -I tools/tv.py "input keyevent KEYCODE_WAKEUP"
"$PY" -I tools/b64push.py "$APK" /data/local/tmp/vibecoded.apk
"$PY" -I tools/tv.py "pm install -r /data/local/tmp/vibecoded.apk; rm -f /data/local/tmp/vibecoded.apk"
# Mirror Boost turns background scanning off; that setting needs this one-time grant.
"$PY" -I tools/tv.py "pm grant com.vibecoded.tv android.permission.WRITE_SECURE_SETTINGS"
if [ "${1:-}" = "--make-home" ]; then
  # Sony's stock launcher keeps Home until it's disabled (it's in the debloat list, so restore.sh undoes this).
  "$PY" -I tools/tv.py "cmd package set-home-activity com.vibecoded.tv/.HomeActivity; pm disable-user --user 0 com.google.android.tvlauncher"
fi
"$PY" -I tools/tv.py "am start -n com.vibecoded.tv/.HomeActivity"
echo "installed; Home is: $("$PY" -I tools/tv.py "cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN | tail -1")"
