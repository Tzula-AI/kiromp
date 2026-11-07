from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import omp_agents  # noqa: E402

APP_NAME = os.environ.get("KIROCREW_APP_NAME", "omp-agents")
PROXY_HEADER = "X-KiroCrew-Proxy"
MAX_SKEW_SECONDS = 60
UNSIGNED_ENV = "OMP_AGENTS_ALLOW_UNSIGNED"


def verify_proxy_signature(
    header_value: str,
    *,
    method: str,
    target: str,
    body: bytes,
    secret: str,
    now: float | None = None,
) -> bool:
    if not secret or not header_value or ":" not in header_value:
        return False
    ts_str, _, sig = header_value.partition(":")
    if not ts_str.isdigit() or not sig:
        return False
    clock = time.time() if now is None else now
    if abs(clock - int(ts_str)) > MAX_SKEW_SECONDS:
        return False
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"{ts_str}:{method}:{target}:{body_hash}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode("utf-8", "surrogatepass"), sig.encode("utf-8", "surrogatepass"))


class Handler(BaseHTTPRequestHandler):
    server_version = "omp-agents"

    def do_GET(self) -> None:
        parts = urlsplit(self.path)
        if parts.path == "/health":
            self._json(200, {"status": "ok", "app": APP_NAME})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return
        query = parse_qs(parts.query)
        if parts.path == "/api/runs":
            self._json(200, omp_agents.get_runs())
        elif parts.path == "/api/session":
            self._session(query)
        else:
            self._json(404, {"error": "not found"})

    def _session(self, query: dict[str, list[str]]) -> None:
        key = (query.get("key") or [""])[0]
        try:
            tail = int((query.get("tail") or [omp_agents.DEFAULT_TAIL])[0])
        except ValueError:
            self._json(400, {"error": "invalid tail"})
            return
        status, body = omp_agents.get_session(key, tail)
        self._json(status, body)

    def _authorized(self) -> bool:
        secret = os.environ.get("KIROCREW_PROXY_SECRET", "")
        if not secret:
            return os.environ.get(UNSIGNED_ENV) == "1"
        return verify_proxy_signature(
            self.headers.get(PROXY_HEADER, ""),
            method=self.command,
            target=self.path,
            body=b"",
            secret=secret,
        )

    def _json(self, code: int, data: Any) -> None:
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args: Any) -> None:
        pass


class Server(ThreadingHTTPServer):
    allow_reuse_address = not sys.platform.startswith("win")
    daemon_threads = True


def main() -> None:
    port = int(os.environ.get("PORT", 9100))
    print(f"{APP_NAME} backend on port {port}", flush=True)
    Server(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
