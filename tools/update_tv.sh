#!/usr/bin/env bash
# One command to put the latest Home + Queue on the TV.
#
#   tools/update_tv.sh                      # build the release APK, install it, pre-compile it, keep it as Home
#   tools/update_tv.sh --catalog            # ...and rebuild Queue's catalog and push it (tools/refresh_queue.sh)
#   tools/update_tv.sh --normal-animations  # put the TV's system animations back to full length
#
# The TV's address comes from TV_HOST, or from tools/.tv_host (one line, gitignored) so you set it once.
# Every run also halves Android's window animations (apps opening and closing): the TV feels quicker.
# Animations inside apps (animator_duration_scale) stay as they are, so Home and Queue keep their own
# timing. --normal-animations undoes it.
set -euo pipefail
cd "$(dirname "$0")/.."
TV_HOST="${TV_HOST:-$(cat tools/.tv_host 2>/dev/null || true)}"
: "${TV_HOST:?set TV_HOST, or put the TV IP address in tools/.tv_host}"
export TV_HOST
PY=tools/venv/bin/python

CATALOG=0
SCALE=0.5
for arg in "$@"; do
  case "$arg" in
    --catalog) CATALOG=1 ;;
    --normal-animations) SCALE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Standby cuts the network on this Sony: wake it first, and say so plainly when it doesn't answer.
if ! "$PY" -I tools/tv.py 'input keyevent KEYCODE_WAKEUP' >/dev/null 2>&1; then
  echo "The TV at $TV_HOST isn't answering. Turn it on, check it's on the same network as this Mac, and try again." >&2
  exit 1
fi

# Release build (R8-optimised), installed over the old one, compiled ahead of time on the TV, kept as Home.
launcher/build-and-install.sh

if [ "$CATALOG" = 1 ]; then tools/refresh_queue.sh; fi

"$PY" -I tools/tv.py "settings put global window_animation_scale $SCALE; settings put global transition_animation_scale $SCALE; echo window animations at ${SCALE}x"
echo "Done."
