#!/usr/bin/env python3
"""Serve the web sample (home screen, Mirror Boost, Queue) at http://localhost:8765.

YouTube's embedded player refuses to run from file:// pages, so the sample needs a real origin.
Caching is off, so a reload always picks up edits.

    python3 tools/serve_sample.py [port]
"""
import functools
import http.server
import os
import sys

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCache, directory=os.path.normpath(WEB))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"VibecodedTV sample: http://localhost:{port}")
        httpd.serve_forever()
