from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import pytest

import omp_agents
import server

PROJECT = "-Documents-demo proj"
PARENT_NAME = "2026-11-01T00-00-00-000Z_aaaa"
SECRET = "test-secret"


def _line(obj: dict[str, Any]) -> str:
    return json.dumps(obj, separators=(",", ":")) + "\n"


def _assistant(text: str, tool: str | None = None, args: dict[str, Any] | None = None, stop: str = "stop") -> dict:
    content: list[dict[str, Any]] = [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": text}]
    if tool:
        content.append({"type": "toolCall", "id": "c1", "name": tool, "arguments": args or {}})
    return {
        "type": "message",
        "timestamp": "2026-11-01T00:00:05.000Z",
        "message": {"role": "assistant", "content": content, "stopReason": stop, "timestamp": 1_000_005},
    }


def _write_session(path: Path, parent: Path | None, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = {"type": "session", "timestamp": "2026-11-01T00:00:00.000Z", "cwd": "/home/tommy/Documents/demo proj"}
    if parent:
        header["parentSession"] = str(parent)
    with path.open("w") as fh:
        fh.write(_line({"type": "title", "title": ""}))
        fh.write(_line(header))
        for rec in records:
            fh.write(_line(rec))


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    root = tmp_path / "sessions"
    db_path = tmp_path / "stats.db"
    monkeypatch.setenv(omp_agents.SESSIONS_ENV, str(root))
    monkeypatch.setenv(omp_agents.STATS_DB_ENV, str(db_path))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path("/home/tommy")))
    omp_agents.reset_cache()

    proj = root / PROJECT
    parent = proj / f"{PARENT_NAME}.jsonl"
    task_result = {
        "type": "message",
        "message": {
            "role": "toolResult",
            "toolName": "task",
            "content": [{"type": "text", "text": "done"}],
            "details": {
                "agentSource": "bundled",
                "progress": [
                    {"id": "0-Finished", "agent": "scout"},
                    {"id": "1-Live", "agent": "reviewer"},
                ],
            },
        },
    }
    _write_session(parent, None, [task_result])
    subdir = proj / PARENT_NAME
    finished = subdir / "0-Finished.jsonl"
    live = subdir / "1-Live.jsonl"
    _write_session(
        finished,
        parent,
        [
            {"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": "do it"}], "timestamp": 1_000_001}},
            _assistant("looking", "read", {"path": "a.py", "_i": "why"}),
            {
                "type": "message",
                "message": {"role": "toolResult", "toolName": "read", "content": [{"type": "text", "text": "x" * 3000}], "timestamp": 1_000_006},
            },
            _assistant("all done", "yield", {"result": "ok"}),
        ],
    )
    _write_session(live, parent, [_assistant("working", "bash", {"command": "ls"}, stop="toolUse")])
    stale = time.time() - 3600
    for p in (parent, finished):
        os.utime(p, (stale, stale))

    db = sqlite3.connect(db_path)
    db.executescript(
        """
        create table messages (id integer primary key autoincrement, session_file text, entry_id text,
          folder text, model text, timestamp integer, stop_reason text, total_tokens integer,
          cost_total real, agent_type text);
        create table tool_calls (id integer primary key autoincrement, session_file text, tool_name text,
          agent_type text);
        """
    )
    fin = str(finished)
    db.executemany(
        "insert into messages (session_file, entry_id, folder, model, timestamp, stop_reason, total_tokens, cost_total, agent_type)"
        " values (?,?,?,?,?,?,?,?, 'subagent')",
        [(fin, "e1", "f", "claude-x", 1000, "toolUse", 100, 0.5), (fin, "e2", "f", "claude-x", 5000, "stop", 50, 0.25)],
    )
    db.executemany(
        "insert into tool_calls (session_file, tool_name, agent_type) values (?,?, 'subagent')",
        [(fin, "read"), (fin, "yield")],
    )
    db.commit()
    db.close()
    return root, parent, finished, live


def _by_name(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["name"]: r for r in payload["runs"]}


def test_collect_maps_agents_and_outcomes(sessions):
    runs = _by_name(omp_agents.collect_runs())

    assert set(runs) == {"0-Finished", "1-Live"}

    fin = runs["0-Finished"]
    assert fin["agent"] == "scout"
    assert fin["kind"] == "subagent"
    assert fin["outcome"] == "ok"
    assert (fin["tokens"], fin["cost"], fin["tools"], fin["model"]) == (150, 0.75, 2, "claude-x")
    assert (fin["start"], fin["duration_ms"]) == (1000, fin["last_activity"] - 1000)
    assert fin["project"] == "Documents/demo proj"
    assert fin["parent_key"] == f"{PROJECT}/{PARENT_NAME}.jsonl"
    assert fin["key"] == f"{PROJECT}/{PARENT_NAME}/0-Finished.jsonl"

    live = runs["1-Live"]
    assert live["agent"] == "reviewer"
    assert live["outcome"] == "running"
    assert live["model"] == "?"


def test_fresh_main_session_listed_stale_main_hidden(sessions):
    _root, parent, _finished, _live = sessions
    os.utime(parent, None)
    main = _by_name(omp_agents.collect_runs())[PARENT_NAME]
    assert (main["kind"], main["agent"], main["outcome"], main["parent_key"]) == ("main", "main", "running", None)


def test_old_format_task_call_args_and_missing_parent_header(sessions):
    _root, parent, finished, _live = sessions
    parent.write_text(
        _line({"type": "session", "cwd": "/x"})
        + _line(
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "toolCall",
                            "name": "task",
                            "arguments": {"agent": "librarian", "tasks": [{"id": "Finished"}]},
                        }
                    ],
                },
            }
        )
    )
    os.utime(parent, (time.time() - 3600,) * 2)
    lines = finished.read_text().splitlines(keepends=True)
    header = json.loads(lines[1])
    header.pop("parentSession")
    lines[1] = _line(header)
    finished.write_text("".join(lines))
    os.utime(finished, (time.time() - 3600,) * 2)

    runs = _by_name(omp_agents.collect_runs())
    assert runs["0-Finished"]["agent"] == "librarian"
    assert runs["1-Live"]["agent"] == "unknown"


def test_missing_stats_db_still_lists_runs(sessions):
    omp_agents.stats_db_path().unlink()
    runs = _by_name(omp_agents.collect_runs())
    assert runs["0-Finished"]["outcome"] == "no data"
    assert runs["0-Finished"]["tokens"] == 0
    assert runs["1-Live"]["outcome"] == "running"


@pytest.fixture
def http(sessions, monkeypatch):
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)
    httpd = server.Server(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"

    def get(path: str, params: dict[str, Any] | None = None, *, signed: bool = True) -> tuple[int, Any]:
        target = path + ("?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote) if params else "")
        headers = {}
        if signed:
            import hashlib
            import hmac

            ts = str(int(time.time()))
            body_hash = hashlib.sha256(b"").hexdigest()
            sig = hmac.new(SECRET.encode(), f"{ts}:GET:{target}:{body_hash}".encode(), hashlib.sha256).hexdigest()
            headers[server.PROXY_HEADER] = f"{ts}:{sig}"
        req = urllib.request.Request(base + target, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    yield get
    httpd.shutdown()
    httpd.server_close()


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
    assert len(msgs[2]["text"]) <= omp_agents.TOOL_TEXT_MAX + 1
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


def test_api_requires_a_valid_proxy_signature(sessions, http):
    assert http("/api/runs", signed=False)[0] == 401
    assert http("/api/session", {"key": "x.jsonl"}, signed=False)[0] == 401


def test_health_is_unsigned(http):
    assert http("/health", signed=False) == (200, {"status": "ok", "app": server.APP_NAME})


def test_unknown_route_is_404(http):
    assert http("/api/nope")[0] == 404


def test_no_secret_refuses_unless_opted_in(sessions, monkeypatch):
    monkeypatch.delenv("KIROCREW_PROXY_SECRET", raising=False)
    monkeypatch.delenv(server.UNSIGNED_ENV, raising=False)
    httpd = server.Server(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{httpd.server_address[1]}/api/runs"
    try:
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(url)
        assert err.value.code == 401
        monkeypatch.setenv(server.UNSIGNED_ENV, "1")
        with urllib.request.urlopen(url) as resp:
            assert resp.status == 200
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_signature_rejects_stale_tampered_and_malformed():
    import hashlib
    import hmac

    def sign(ts: int, target: str, body: bytes = b"") -> str:
        msg = f"{ts}:GET:{target}:{hashlib.sha256(body).hexdigest()}"
        return f"{ts}:{hmac.new(b'k', msg.encode(), hashlib.sha256).hexdigest()}"

    now = 1_000_000.0
    ok = dict(method="GET", target="/api/runs", body=b"", secret="k", now=now)
    assert server.verify_proxy_signature(sign(1_000_000, "/api/runs"), **ok)
    assert not server.verify_proxy_signature(sign(1_000_000 - 61, "/api/runs"), **ok)
    assert not server.verify_proxy_signature(sign(1_000_000, "/api/other"), **ok)
    assert not server.verify_proxy_signature(sign(1_000_000, "/api/runs"), **{**ok, "secret": ""})
    for bad in ("", "nocolon", "abc:def", "123:"):
        assert not server.verify_proxy_signature(bad, **ok)
