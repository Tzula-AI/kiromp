from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import agents
import paths
from conftest import PARENT_NAME, PROJECT, _assistant, _line, _write_session  # noqa: F401


def _by_name(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["name"]: r for r in payload["runs"]}


def test_collect_maps_agents_and_outcomes(sessions):
    runs = _by_name(agents.collect_runs())

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
    main = _by_name(agents.collect_runs())[PARENT_NAME]
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

    runs = _by_name(agents.collect_runs())
    assert runs["0-Finished"]["agent"] == "librarian"
    assert runs["1-Live"]["agent"] == "unknown"


def test_missing_stats_db_still_lists_runs(sessions):
    paths.stats_db_path().unlink()
    runs = _by_name(agents.collect_runs())
    assert runs["0-Finished"]["outcome"] == "no data"
    assert runs["0-Finished"]["tokens"] == 0
    assert runs["1-Live"]["outcome"] == "running"
