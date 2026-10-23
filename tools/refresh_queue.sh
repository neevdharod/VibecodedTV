#!/usr/bin/env bash
# Rebuild Queue's catalog (fresh trending titles, ratings, and data/prime_history.json if you have one)
# and put it on the TV. No app rebuild: the launcher reads a pushed catalog.json over its built-in one.
#
#   TV_HOST=192.168.0.182 tools/refresh_queue.sh
#   tools/refresh_queue.sh --no-build      # push the catalog already built
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TV_HOST:?set TV_HOST to the TV IP address, e.g. TV_HOST=192.168.0.182 $0}"
export TV_HOST
PY=tools/venv/bin/python
CATALOG=launcher/app/src/main/assets/catalog.json
REMOTE_DIR=/sdcard/Android/data/com.gathin.tvhome/files

if [ "${1:-}" != --no-build ]; then
  python3 -I tools/build_catalog.py
fi
"$PY" -I tools/tv.py "mkdir -p $REMOTE_DIR"
"$PY" -I tools/b64push.py "$CATALOG" "$REMOTE_DIR/catalog.json"
# The catalog and the taste model load once per process: restart Home so both pick up the new file.
"$PY" -I tools/tv.py "am force-stop com.gathin.tvhome; am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null; echo Home restarted with the new catalog"
