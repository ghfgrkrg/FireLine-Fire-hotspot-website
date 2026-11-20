# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Local server for the FireLine app.

Usage: python serve.py [port]          (default 8765, then open http://localhost:8765)
Serves this folder at / and the processed data at /data/.
The data folder is FIRE_DATA if set, else ../data/app_data, else ../../Fire_Hotspot_Data/app_data.
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP = os.path.dirname(os.path.abspath(__file__))
# data folder: FIRE_DATA if set, else <project>/data/app_data (a downloaded copy), else the sibling Fire_Hotspot_Data folder
_CANDIDATES = [os.environ.get("FIRE_DATA"), os.path.join(APP, "..", "data", "app_data"), os.path.join(APP, "..", "..", "Fire_Hotspot_Data", "app_data")]
DATA = next((os.path.abspath(p) for p in _CANDIDATES if p and os.path.isfile(os.path.join(p, "index.json"))), os.path.abspath(_CANDIDATES[1]))


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path.startswith("/data/"):
            root, rel = DATA, path[len("/data/"):]
        else:
            root, rel = APP, path.lstrip("/")
        full = os.path.abspath(os.path.join(root, *[p for p in rel.split("/") if p not in ("", ".", "..")]))
        return full if full.startswith(root) else root

    def end_headers(self):
        # data files never change during a session; app files should always be fresh while developing
        self.send_header("Cache-Control", "public, max-age=86400" if self.path.startswith("/data/") else "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1]) not in ("200", "304"): super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    if not os.path.isfile(os.path.join(DATA, "index.json")):
        sys.exit(f"The fire data is missing.\nExpected it here: {DATA}\nSee README.md, section 'Get the data'.")
    print(f"FireLine: http://localhost:{port}   (data: {DATA})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
