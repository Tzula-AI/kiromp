"""OMP usage backend: serves the cached usage snapshot and runs the 5-minute poller.

Routes, as the gateway's reverse proxy forwards them (``/apps/omp-usage/api/<path>`` -> ``/api/<path>``):

  GET /health                  liveness probe (unsigned, the gateway polls it directly)
  GET /api/usage[?refresh=1]   cached ``omp usage --json`` reports plus alerts; refresh forces a refetch
  GET /api/status              ``{state, tooltip}`` for the composer chip

Every route except ``/health`` must carry the gateway's ``X-KiroCrew-Proxy`` HMAC.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gateway_notify import GatewayNotifier  # noqa: E402
from omp_usage import OmpUsageService, chip_status, start_poller  # noqa: E402

logger = logging.getLogger("omp-usage")

MAX_SKEW_SECONDS = 60


def verify_proxy(header: str, *, method: str, target: str, body: bytes, secret: str, now: float | None = None) -> bool:
    """Check the gateway's ``<ts>:<hmac_sha256(secret, "<ts>:<method>:<target>:<sha256(body)>")>`` signature."""
    if not secret or not header or ":" not in header:
        return False
    ts, _, sig = header.partition(":")
    if not ts.isdigit() or not sig:
        return False
    if abs((time.time() if now is None else now) - int(ts)) > MAX_SKEW_SECONDS:
        return False
    message = f"{ts}:{method}:{target}:{hashlib.sha256(body or b'').hexdigest()}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode("utf-8", "surrogatepass"), sig.encode("utf-8", "surrogatepass"))


def make_handler(service: OmpUsageService, secret: str, allow_unsigned: bool = False) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: object) -> None:
            logger.debug("%s - %s", self.address_string(), fmt % args)

        def _json(self, code: int, data: object) -> None:
            payload = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802
            url = urllib.parse.urlparse(self.path)
            route = url.path.rstrip("/") or "/"
            if route in ("/health", "/api/health"):
                return self._json(200, {"status": "ok"})
            header = self.headers.get("X-KiroCrew-Proxy", "")
            if not allow_unsigned and not verify_proxy(header, method="GET", target=self.path, body=b"", secret=secret):
                return self._json(401, {"error": "unauthorized"})
            if route.startswith("/api/"):
                route = route[4:]
            query = urllib.parse.parse_qs(url.query)
            try:
                if route == "/usage":
                    refresh = query.get("refresh", [""])[0] in ("1", "true")
                    return self._json(200, service.get(refresh=refresh))
                if route == "/status":
                    return self._json(200, chip_status(service.snapshot()))
            except Exception:  # noqa: BLE001
                logger.exception("GET %s failed", self.path)
                return self._json(500, {"error": "internal error"})
            return self._json(404, {"error": "not found"})

    return Handler


class Server(ThreadingHTTPServer):
    allow_reuse_address = not sys.platform.startswith("win")
    daemon_threads = True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    port = int(os.environ.get("PORT", 9100))
    notifier = GatewayNotifier.from_env()
    if notifier.dormant_reason:
        logger.warning("alerts will not be sent: %s", notifier.dormant_reason)
    service = OmpUsageService(notifier)
    start_poller(service)
    handler = make_handler(service, os.environ.get("KIROCREW_PROXY_SECRET", ""), os.environ.get("OMP_USAGE_ALLOW_UNSIGNED") == "1")
    logger.info("omp-usage backend on 127.0.0.1:%s", port)
    Server(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
