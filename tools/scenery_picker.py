#!/usr/bin/env python3
"""Pick Scenery's clips by hand: a page with every candidate, playing as you hover.

    python3 -I tools/build_scenery.py --candidates   # once a day at most: the pool to pick from
    python3 -I tools/scenery_picker.py               # then open http://127.0.0.1:8771

Click clips to pick them (your current list starts picked), then Save: that writes
launcher/app/src/main/assets/scenery.json, and tools/update_tv.sh puts it on the TV. Runs only on this
Mac (127.0.0.1); the Pixabay key is never sent to the page.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import build_scenery  # noqa: E402  (the same filters, mixing and writer as the automatic list)

POOL = os.path.join(TOOLS, "cache", "scenery_candidates.json")
PAGE = os.path.join(TOOLS, "scenery_picker.html")
PORT = int(os.environ.get("PORT", "8771"))


def pool():
    try:
        return json.load(open(POOL))
    except OSError:
        sys.exit("No candidates yet: run  python3 -I tools/build_scenery.py --candidates  first.")


def current_ids():
    try:
        return [s["id"] for s in json.load(open(build_scenery.OUT))["scenes"]]
    except (OSError, ValueError, KeyError):
        return []


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, kind="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send(200, open(PAGE, "rb").read(), "text/html")
        elif self.path == "/api/candidates":
            self.send(200, json.dumps({"clips": pool(), "picked": current_ids()}))
        else:
            self.send(404, '{"error": "not found"}')

    def do_POST(self):
        if self.path != "/api/save":
            return self.send(404, '{"error": "not found"}')
        try:
            ids = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))["ids"]
        except (ValueError, KeyError, TypeError):
            return self.send(400, '{"error": "expected {\\"ids\\": [...]}"}')
        by_id = {c["id"]: c for c in pool()}
        picked = [by_id[i] for i in ids if i in by_id]
        if not picked:
            return self.send(400, '{"error": "pick at least one clip"}')
        build_scenery.write(build_scenery.mix(picked))
        mb = sum(c["mb"] for c in picked)
        self.send(200, json.dumps({"saved": len(picked), "gb": round(mb / 1024, 1)}))

    def log_message(self, fmt, *args):
        pass   # quiet: thumbnails come from Pixabay, not from here


if __name__ == "__main__":
    pool()
    print(f"Scenery picker: http://127.0.0.1:{PORT}  (Ctrl-C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
