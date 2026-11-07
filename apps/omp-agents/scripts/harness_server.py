"""Local stand-in for the Kiro Crew gateway, for checking the UI without enabling the app.

Serves the harness page built by ``npm run harness`` (``ui/harness/dist``) and
forwards ``/apps/omp-agents/api/*`` to the backend as ``/api/*``, signing each
request the way the gateway does so the backend's signature check is exercised.

    export KIROCREW_PROXY_SECRET=dev-secret
    PORT=9101 python backend/server.py &
    python scripts/harness_server.py --backend 9101 --port 9102
    open http://127.0.0.1:9102/?theme=dark
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "ui" / "harness" / "dist"
PREFIX = "/apps/omp-agents/api/"


class Handler(SimpleHTTPRequestHandler):
    backend_port = 0
    secret = ""

    def do_GET(self) -> None:
        if not self.path.startswith(PREFIX):
            super().do_GET()
            return
        target = "/api/" + self.path[len(PREFIX):]
        ts = str(int(time.time()))
        message = f"{ts}:GET:{target}:{hashlib.sha256(b'').hexdigest()}"
        sig = hmac.new(self.secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.backend_port}{target}", headers={"X-KiroCrew-Proxy": f"{ts}:{sig}"}
        )
        try:
            with urllib.request.urlopen(req) as resp:
                status, body = resp.status, resp.read()
        except urllib.error.HTTPError as err:
            status, body = err.code, err.read()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", type=int, required=True)
    parser.add_argument("--port", type=int, default=9102)
    args = parser.parse_args()
    Handler.backend_port = args.backend
    Handler.secret = os.environ["KIROCREW_PROXY_SECRET"]
    handler = partial(Handler, directory=str(DIST))
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
