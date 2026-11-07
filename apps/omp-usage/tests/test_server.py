from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import omp_usage
import pytest
import server

PROXY_KEY = "proxy-secret"


def sign(method: str, target: str, body: bytes = b"", *, ts: int | None = None, key: str = PROXY_KEY) -> str:
    ts_s = str(int(time.time()) if ts is None else ts)
    msg = f"{ts_s}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
    return f"{ts_s}:{hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()}"


class Backend:
    def __init__(self, tmp_path: Path) -> None:
        self.fetches = 0

        def fetcher() -> dict[str, Any]:
            self.fetches += 1
            return {
                "reports": [
                    {
                        "provider": "anthropic",
                        "metadata": {"email": "a@b", "modelUsage": "huge"},
                        "limits": [{"id": "x", "label": "Claude 7 Day", "amount": {"usedFraction": 0.8}, "status": "warning"}],
                    }
                ]
            }

        self.service = omp_usage.OmpUsageService(None, fetcher=fetcher, ledger_path=tmp_path / "l.json")
        self.httpd = server.Server(("127.0.0.1", 0), server.make_handler(self.service, PROXY_KEY))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def get(self, target: str, *, signed: bool = True, header: str | None = None) -> tuple[int, Any]:
        headers = {}
        if header is not None:
            headers["X-KiroCrew-Proxy"] = header
        elif signed:
            headers["X-KiroCrew-Proxy"] = sign("GET", target)
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + target, headers=headers), timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())


@pytest.fixture
def backend(tmp_path: Path) -> Iterator[Backend]:
    b = Backend(tmp_path)
    yield b
    b.httpd.shutdown()
    b.httpd.server_close()


def test_health_is_unsigned_everything_else_needs_the_gateway_signature(backend: Backend) -> None:
    assert backend.get("/health", signed=False) == (200, {"status": "ok"})
    assert backend.get("/api/usage", signed=False)[0] == 401
    assert backend.get("/api/usage", header=sign("GET", "/api/usage", key="other"))[0] == 401
    assert backend.get("/api/usage", header=sign("GET", "/api/usage", ts=int(time.time()) - 600))[0] == 401
    assert backend.get("/api/usage", header=sign("GET", "/api/status"))[0] == 401
    assert backend.fetches == 0


def test_usage_is_cached_and_refresh_forces_a_refetch(backend: Backend) -> None:
    status, first = backend.get("/api/usage")
    assert status == 200 and first["ok"] is True and backend.fetches == 1
    assert first["reports"][0]["metadata"] == {"email": "a@b"}
    assert first["alerts"] == []
    backend.get("/api/usage")
    assert backend.fetches == 1
    backend.get("/api/usage?refresh=1")
    assert backend.fetches == 2
    backend.get("/api/usage?refresh=true")
    assert backend.fetches == 3


def test_status_reports_the_chip_state_from_the_cache_without_fetching(backend: Backend) -> None:
    assert backend.get("/api/status?session_key=dashboard%3Achat-1") == (200, {"state": "none", "tooltip": "OMP usage"})
    assert backend.fetches == 0
    backend.get("/api/usage")
    assert backend.get("/api/status") == (200, {"state": "warn", "tooltip": "OMP usage: 80% used on the busiest limit"})


def test_unknown_route_is_404(backend: Backend) -> None:
    assert backend.get("/api/nope")[0] == 404


def test_verify_proxy_fails_closed() -> None:
    ok = sign("GET", "/api/usage")
    assert server.verify_proxy(ok, method="GET", target="/api/usage", body=b"", secret=PROXY_KEY)
    assert not server.verify_proxy(ok, method="POST", target="/api/usage", body=b"", secret=PROXY_KEY)
    assert not server.verify_proxy(ok, method="GET", target="/api/usage", body=b"x", secret=PROXY_KEY)
    assert not server.verify_proxy(ok, method="GET", target="/api/usage", body=b"", secret="")
    assert not server.verify_proxy("", method="GET", target="/api/usage", body=b"", secret=PROXY_KEY)
    assert not server.verify_proxy("abc:def", method="GET", target="/api/usage", body=b"", secret=PROXY_KEY)
    assert not server.verify_proxy("1:\udcff", method="GET", target="/api/usage", body=b"", secret=PROXY_KEY)
