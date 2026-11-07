from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agents  # noqa: E402
import spend  # noqa: E402
import usage  # noqa: E402
from gateway_notify import GatewayNotifier  # noqa: E402

logger = logging.getLogger("omp-dashboard")

APP_NAME = os.environ.get("KIROCREW_APP_NAME", "omp-dashboard")
PROXY_HEADER = "X-KiroCrew-Proxy"
MAX_SKEW_SECONDS = 60
UNSIGNED_ENV = "OMP_DASHBOARD_ALLOW_UNSIGNED"


def verify_proxy(
    header_value: str, *, method: str, target: str, body: bytes, secret: str, now: float | None = None
) -> bool:
    if not secret or not header_value or ":" not in header_value:
        return False
    ts_str, _, sig = header_value.partition(":")
    if not ts_str.isdigit() or not sig:
        return False
    if abs((time.time() if now is None else now) - int(ts_str)) > MAX_SKEW_SECONDS:
        return False
    message = f"{ts_str}:{method}:{target}:{hashlib.sha256(body or b'').hexdigest()}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode("utf-8", "surrogatepass"), sig.encode("utf-8", "surrogatepass"))


class Services:
    def __init__(self, usage_service: usage.OmpUsageService, spend_service: spend.SpendService) -> None:
        self.usage = usage_service
        self.spend = spend_service


def make_handler(
    services: Services, secret: str = "", allow_unsigned: bool = False
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "omp-dashboard"

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.debug("%s - %s", self.address_string(), fmt % args)

        def _json(self, code: int, data: Any) -> None:
            payload = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def _authorized(self) -> bool:
            if not secret:
                return allow_unsigned
            return verify_proxy(
                self.headers.get(PROXY_HEADER, ""), method=self.command, target=self.path, body=b"", secret=secret
            )

        def do_GET(self) -> None:  # noqa: N802
            parts = urlsplit(self.path)
            if parts.path in ("/health", "/api/health"):
                return self._json(200, {"status": "ok", "app": APP_NAME})
            if not self._authorized():
                return self._json(401, {"error": "unauthorized"})
            query = parse_qs(parts.query)
            route = parts.path.rstrip("/")
            try:
                if route == "/api/usage":
                    refresh = (query.get("refresh") or [""])[0] in ("1", "true")
                    return self._json(200, services.usage.get(refresh=refresh))
                if route == "/api/status":
                    return self._json(200, usage.chip_status(services.usage.snapshot()))
                if route == "/api/spend":
                    return self._spend(query)
                if route == "/api/runs":
                    return self._json(200, agents.get_runs())
                if route == "/api/session":
                    return self._session(query)
            except Exception:  # noqa: BLE001
                logger.exception("GET %s failed", parts.path)
                return self._json(500, {"error": "internal error"})
            return self._json(404, {"error": "not found"})

        def _spend(self, query: dict[str, list[str]]) -> None:
            window = (query.get("window") or [spend.DEFAULT_WINDOW])[0]
            refresh = (query.get("refresh") or [""])[0] in ("1", "true")
            try:
                payload = services.spend.get(window, refresh=refresh)
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            self._json(200, payload)

        def _session(self, query: dict[str, list[str]]) -> None:
            key = (query.get("key") or [""])[0]
            try:
                tail = int((query.get("tail") or [agents.DEFAULT_TAIL])[0])
            except ValueError:
                return self._json(400, {"error": "invalid tail"})
            status, body = agents.get_session(key, tail)
            self._json(status, body)

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
    usage_service = usage.OmpUsageService(notifier)
    usage.start_poller(usage_service)
    services = Services(usage_service, spend.SpendService())
    handler = make_handler(services, os.environ.get("KIROCREW_PROXY_SECRET", ""), os.environ.get(UNSIGNED_ENV) == "1")
    logger.info("%s backend on 127.0.0.1:%s", APP_NAME, port)
    Server(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
