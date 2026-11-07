from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import server
import spend
import usage
from conftest import PARENT_NAME, PROJECT, SECRET
from test_spend import fixture_db


def sign(method: str, target: str, body: bytes = b"", *, ts: int | None = None, key: str = SECRET) -> str:
    ts_s = str(int(time.time()) if ts is None else ts)
    msg = f"{ts_s}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
    return f"{ts_s}:{hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()}"


class Backend:
    def __init__(self, tmp_path: Path, secret: str = SECRET, allow_unsigned: bool = False) -> None:
        self.fetches = 0
        self.stats_db = fixture_db(tmp_path / "spend.db")

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

        services = server.Services(
            usage.OmpUsageService(None, fetcher=fetcher, ledger_path=tmp_path / "ledger.json"),
            spend.SpendService(path_fn=lambda: self.stats_db),
        )
        self.httpd = server.Server(("127.0.0.1", 0), server.make_handler(services, secret, allow_unsigned))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def get(self, path: str, params: dict[str, Any] | None = None, *, signed: bool = True, header: str | None = None) -> tuple[int, Any]:
        target = path + ("?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote) if params else "")
        headers = {}
        if header is not None:
            headers[server.PROXY_HEADER] = header
        elif signed:
            headers[server.PROXY_HEADER] = sign("GET", target)
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + target, headers=headers), timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def backend(tmp_path: Path) -> Iterator[Backend]:
    b = Backend(tmp_path)
    yield b
    b.close()


@pytest.fixture
def http(sessions, backend: Backend):
    return backend.get


def test_health_is_unsigned_everything_else_needs_the_gateway_signature(backend: Backend) -> None:
    assert backend.get("/health", signed=False) == (200, {"status": "ok", "app": server.APP_NAME})
    for route in ("/api/usage", "/api/status", "/api/spend", "/api/runs", "/api/session"):
        assert backend.get(route, signed=False)[0] == 401, route
    assert backend.get("/api/usage", header=sign("GET", "/api/usage", key="other"))[0] == 401
    assert backend.get("/api/usage", header=sign("GET", "/api/usage", ts=int(time.time()) - 600))[0] == 401
    assert backend.get("/api/usage", header=sign("GET", "/api/status"))[0] == 401
    assert backend.fetches == 0


def test_unknown_route_is_404(backend: Backend) -> None:
    assert backend.get("/api/nope")[0] == 404


@pytest.mark.parametrize(("allow_unsigned", "expected"), [(False, 401), (True, 200)])
def test_no_secret_refuses_unless_opted_in(tmp_path: Path, allow_unsigned: bool, expected: int) -> None:
    b = Backend(tmp_path, secret="", allow_unsigned=allow_unsigned)
    try:
        assert b.get("/api/status", signed=False)[0] == expected
    finally:
        b.close()


def test_verify_proxy_fails_closed() -> None:
    ok = sign("GET", "/api/usage")
    args = dict(method="GET", target="/api/usage", body=b"", secret=SECRET)
    assert server.verify_proxy(ok, **args)
    assert not server.verify_proxy(ok, **{**args, "method": "POST"})
    assert not server.verify_proxy(ok, **{**args, "body": b"x"})
    assert not server.verify_proxy(ok, **{**args, "secret": ""})
    assert not server.verify_proxy(sign("GET", "/api/usage", ts=1_000_000 - 61), **args, now=1_000_000)
    assert server.verify_proxy(sign("GET", "/api/usage", ts=1_000_000), **args, now=1_000_000)
    for bad in ("", "nocolon", "abc:def", "123:", "1:\udcff"):
        assert not server.verify_proxy(bad, **args)


def test_usage_is_cached_and_refresh_forces_a_refetch(backend: Backend) -> None:
    status, first = backend.get("/api/usage")
    assert status == 200 and first["ok"] is True and backend.fetches == 1
    assert first["reports"][0]["metadata"] == {"email": "a@b"}
    assert first["alerts"] == []
    backend.get("/api/usage")
    assert backend.fetches == 1
    backend.get("/api/usage", {"refresh": "1"})
    assert backend.fetches == 2
    backend.get("/api/usage", {"refresh": "true"})
    assert backend.fetches == 3


def test_status_reports_the_chip_state_from_the_cache_without_fetching(backend: Backend) -> None:
    assert backend.get("/api/status", {"session_key": "dashboard:chat-1"}) == (200, {"state": "none", "tooltip": "OMP usage"})
    assert backend.fetches == 0
    backend.get("/api/usage")
    assert backend.get("/api/status") == (200, {"state": "warn", "tooltip": "OMP usage: 80% used on the busiest limit"})


def test_spend_route_defaults_to_24h_selects_a_window_and_rejects_unknown_ones(backend: Backend) -> None:
    status, body = backend.get("/api/spend")
    assert status == 200 and body["available"] is True and body["window"] == "24h"
    assert set(body["windows"]) == {"24h", "3d", "7d", "30d"}
    assert backend.get("/api/spend", {"window": "7d"})[1]["window"] == "7d"
    status, err = backend.get("/api/spend", {"window": "90d"})
    assert status == 400 and "90d" in err["error"]


def test_spend_route_hides_the_section_when_the_stats_db_is_missing(backend: Backend) -> None:
    backend.stats_db.unlink()
    status, body = backend.get("/api/spend", {"window": "3d"})
    assert status == 200 and body["available"] is False and body["error"] is None


def test_runs_endpoint_is_cached_for_ttl(sessions, http):
    status, first = http("/api/runs")
    assert status == 200
    assert {r["name"] for r in first["runs"]} == {"0-Finished", "1-Live"}
    sessions[3].unlink()
    _status, second = http("/api/runs")
    assert second == first


def test_session_endpoint_transcript(sessions, http):
    key = f"{PROJECT}/{PARENT_NAME}/0-Finished.jsonl"
    status, body = http("/api/session", {"key": key})
    assert status == 200
    assert (body["key"], body["name"], body["agent"], body["outcome"]) == (key, "0-Finished", "scout", "ok")
    msgs = body["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "tool", "assistant"]
    assert msgs[0]["text"] == "do it"
    assert msgs[1]["text"] == 'looking\n→ read({"path":"a.py"})'
    assert msgs[2]["tool_name"] == "read"
    assert len(msgs[2]["text"]) <= server.agents.TOOL_TEXT_MAX + 1
    assert msgs[3]["text"].endswith('→ yield({"result":"ok"})')

    _status, tail = http("/api/session", {"key": key, "tail": 2})
    assert [m["role"] for m in tail["messages"]] == ["tool", "assistant"]


def test_session_key_validation(sessions, http, tmp_path):
    outside = tmp_path / "outside.jsonl"
    outside.write_text("{}\n")
    for key in ("../outside.jsonl", f"{PROJECT}/../../outside.jsonl", str(outside), "", f"{PROJECT}/nope.txt"):
        status, _body = http("/api/session", {"key": key})
        assert status == 400, key
    assert http("/api/session", {"key": f"{PROJECT}/missing.jsonl"})[0] == 404
    assert http("/api/session", {"key": f"{PROJECT}/{PARENT_NAME}.jsonl", "tail": "abc"})[0] == 400


def test_symlink_escaping_the_sessions_root_is_refused(sessions, http, tmp_path):
    root = sessions[0]
    outside = tmp_path / "secret.jsonl"
    outside.write_text('{"type":"message","message":{"role":"user","content":"leak"}}\n')
    (root / PROJECT / "link.jsonl").symlink_to(outside)
    assert http("/api/session", {"key": f"{PROJECT}/link.jsonl"})[0] == 400
