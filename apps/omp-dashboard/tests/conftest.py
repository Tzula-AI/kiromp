from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import agents  # noqa: E402
import paths  # noqa: E402

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
    monkeypatch.setenv(paths.SESSIONS_ENV, str(root))
    monkeypatch.setenv(paths.STATS_DB_ENV, str(db_path))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path("/home/tommy")))
    agents.reset_cache()

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
