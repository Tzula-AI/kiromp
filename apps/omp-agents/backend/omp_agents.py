"""omp sub-agent runs: the data layer behind the Agents page.

Two read-only data sources feed the page:

* ``~/.omp/agent/sessions/**.jsonl`` -- every sub-agent run is its own file
  nested under its parent session's directory; line 2 (or 1) is a ``session``
  header naming ``parentSession``. The agent *type* is recorded only in the
  parent: the ``task`` tool result carries ``details.progress[]/results[]``
  ``{id, agent}``; older omp builds only have it in the ``task`` call
  arguments (``agent`` + ``tasks[].id``). Results win over call arguments.
* ``~/.omp/stats.db`` -- omp's own per-message / per-tool-call ledger, keyed by
  absolute session file (tokens, cost, model, stop reason, tool counts).

A run finished OK when its last tool call is ``yield`` or its last message
stopped with ``stop``. ``running`` means the file was written in the last
:data:`RUNNING_WINDOW_SECS` and the last tool call is not ``yield``; for those
fresh files the last tool call is read from the file itself because the stats
db trails the session log.

The full run list is cached in memory for :data:`CACHE_TTL_SECS`; concurrent
callers collapse into one scan (single-flight). The sessions root and stats db
can be redirected with ``OMP_AGENTS_SESSIONS_DIR`` / ``OMP_AGENTS_STATS_DB``.

Standard library only: this module is imported by the app's own backend
process and by the tests, never by the gateway.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import subprocess
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("omp-agents")

CACHE_TTL_SECS = 30
RUNNING_WINDOW_SECS = 120
DEFAULT_TAIL = 200
MAX_TAIL = 1000
USER_TEXT_MAX = 4000
TOOL_TEXT_MAX = 2000
ARGS_TEXT_MAX = 200
_TAIL_BYTES = 2 * 1024 * 1024

SESSIONS_ENV = "OMP_AGENTS_SESSIONS_DIR"
STATS_DB_ENV = "OMP_AGENTS_STATS_DB"

_OUTCOME_BY_STOP = {"stop": "ok", "error": "error", "aborted": "aborted"}


def sessions_root() -> Path:
    override = os.environ.get(SESSIONS_ENV)
    return Path(override) if override else Path.home() / ".omp" / "agent" / "sessions"


def stats_db_path() -> Path:
    override = os.environ.get(STATS_DB_ENV)
    return Path(override) if override else Path.home() / ".omp" / "stats.db"


def _read_header(path: str) -> dict[str, Any]:
    try:
        with open(path, errors="ignore") as fh:
            for _ in range(3):
                line = fh.readline()
                if not line:
                    break
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict) and rec.get("type") == "session":
                    return rec
    except OSError:
        pass
    return {}


def _iso_ms(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _project_of(cwd: Any, fallback: str) -> str:
    if isinstance(cwd, str) and cwd:
        try:
            return str(Path(cwd).relative_to(Path.home())) or "~"
        except ValueError:
            return cwd
    return fallback


def _tail_bytes(path: str) -> bytes | None:
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(max(0, size - _TAIL_BYTES))
            return fh.read()
    except OSError:
        return None


def _last_tool_name(path: str) -> str | None:
    data = _tail_bytes(path)
    if data is None:
        return None
    for raw in reversed(data.splitlines()):
        if b'"toolCall"' not in raw:
            continue
        try:
            rec = json.loads(raw)
        except json.JSONDecodeError:
            continue
        msg = rec.get("message") if isinstance(rec, dict) else None
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for block in reversed(content):
            if isinstance(block, dict) and block.get("type") == "toolCall":
                name = block.get("name")
                return name if isinstance(name, str) else None
    return None


def _last_stop_reason(path: str) -> str | None:
    data = _tail_bytes(path)
    if data is None:
        return None
    for raw in reversed(data.splitlines()):
        if b'"stopReason"' not in raw:
            continue
        try:
            rec = json.loads(raw)
        except json.JSONDecodeError:
            continue
        msg = rec.get("message") if isinstance(rec, dict) else None
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            reason = msg.get("stopReason")
            return reason if isinstance(reason, str) else None
    return None


def _file_outcome(path: str, now_s: float) -> str:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return "no data"
    last_tool = _last_tool_name(path)
    if last_tool == "yield":
        return "ok"
    if now_s - mtime <= RUNNING_WINDOW_SECS:
        return "running"
    return _OUTCOME_BY_STOP.get(_last_stop_reason(path) or "", "unfinished")


def _task_files(root: Path) -> list[str]:
    try:
        out = subprocess.run(
            ["grep", "-rlZ", "--include=*.jsonl", "-e", '"name":"task"', "-e", '"toolName":"task"', str(root)],
            capture_output=True,
            text=True,
            errors="ignore",
            check=False,
        ).stdout
        return [f for f in out.split("\0") if f]
    except OSError:
        return [os.path.join(r, n) for r, _d, names in os.walk(root) for n in names if n.endswith(".jsonl")]


def _agent_map(root: Path, wanted: set[str]) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for f in _task_files(root):
        if f not in wanted:
            continue
        from_args: dict[str, str] = {}
        try:
            fh = open(f, errors="ignore")  # noqa: SIM115 -- closed by the with below
        except OSError:
            continue
        with fh:
            for line in fh:
                is_result = '"toolName":"task"' in line and '"agentSource"' in line
                if not is_result and '"name":"task"' not in line:
                    continue
                try:
                    msg = (json.loads(line) or {}).get("message") or {}
                except json.JSONDecodeError:
                    continue
                if is_result:
                    det = msg.get("details") or {}
                    for p in (det.get("progress") or []) + (det.get("results") or []):
                        if isinstance(p, dict) and p.get("id") and p.get("agent"):
                            out[(f, p["id"])] = p["agent"]
                    continue
                for c in msg.get("content") or []:
                    if not isinstance(c, dict) or c.get("type") != "toolCall" or c.get("name") != "task":
                        continue
                    args = c.get("arguments") or {}
                    for t in args.get("tasks") or []:
                        tid = isinstance(t, dict) and (t.get("id") or t.get("name"))
                        if tid:
                            from_args[tid] = t.get("agent") or args.get("agent") or "task"
        for tid, ag in from_args.items():
            out.setdefault((f, tid), ag)
    return out


def _resolve_agent(agents: dict[tuple[str, str], str], path: str, parent: str) -> str:
    parents = [p for p in (parent, os.path.dirname(path) + ".jsonl") if p]
    stem = Path(path).stem
    for par in parents:
        for key in (stem, stem.rsplit(".", 1)[-1]):
            for k in (key, re.sub(r"^\d+-", "", key), re.sub(r"-\d+$", "", key)):
                if (par, k) in agents:
                    return agents[(par, k)]
    return "unknown"


class _Stats:

    def __init__(self) -> None:
        self.span: dict[str, tuple[int, int, int, int, float]] = {}
        self.last_stop: dict[str, str] = {}
        self.model: dict[str, str] = {}
        self.tools: dict[str, int] = {}
        self.yielded: set[str] = set()


def _load_stats(db_path: Path, files: list[str] | None) -> _Stats:
    st = _Stats()
    if not db_path.exists():
        return st
    if files is None:
        mwhere = "where agent_type='subagent'"
        params: list[Any] = []
    elif not files:
        return st
    else:
        mwhere = "where session_file in (" + ",".join("?" * len(files)) + ")"
        params = list(files)
    twhere = mwhere
    try:
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return st
    try:
        for sf, lo, hi, n, tok, cost in db.execute(
            f"select session_file, min(timestamp), max(timestamp), count(*), sum(total_tokens), sum(cost_total) "
            f"from messages {mwhere} group by session_file",
            params,
        ):
            st.span[sf] = (lo, hi, n, tok or 0, cost or 0.0)
        for sf, stop in db.execute(
            f"select m.session_file, m.stop_reason from messages m join "
            f"(select session_file, max(id) id from messages {mwhere} group by session_file) l on l.id=m.id",
            params,
        ):
            st.last_stop[sf] = stop
        for sf, mdl, _n in db.execute(
            f"select session_file, model, count(*) c from messages {mwhere} group by 1,2 order by c",
            params,
        ):
            st.model[sf] = mdl
        for sf, n in db.execute(
            f"select session_file, count(*) from tool_calls {twhere} group by 1",
            params,
        ):
            st.tools[sf] = n
        for (sf,) in db.execute(
            f"select t.session_file from tool_calls t join "
            f"(select session_file, max(id) id from tool_calls {twhere} group by 1) l on l.id=t.id "
            f"where t.tool_name='yield'",
            params,
        ):
            st.yielded.add(sf)
    except sqlite3.Error:
        logger.warning("omp stats db read failed", exc_info=True)
    finally:
        db.close()
    return st


def _walk(root: Path) -> tuple[list[str], list[str]]:
    subs: list[str] = []
    mains: list[str] = []
    root_depth = len(root.parts)
    for dirpath, _dirs, names in os.walk(root):
        depth = len(Path(dirpath).parts) - root_depth
        if depth == 0:
            continue
        for n in names:
            if not n.endswith(".jsonl"):
                continue
            (mains if depth == 1 else subs).append(os.path.join(dirpath, n))
    return subs, mains


def _rel(root: Path, path: str) -> str | None:
    try:
        return os.path.relpath(path, root) if os.path.commonpath([root, path]) == str(root) else None
    except ValueError:
        return None


def _header_model(path: str) -> str:
    try:
        with open(path, errors="ignore") as fh:
            for _ in range(30):
                line = fh.readline()
                if not line:
                    break
                if '"model_change"' not in line:
                    continue
                try:
                    model = json.loads(line).get("model")
                except json.JSONDecodeError:
                    continue
                if isinstance(model, str) and model:
                    return model.rsplit("/", 1)[-1]
    except OSError:
        pass
    return "?"


def collect_runs() -> dict[str, Any]:
    root = sessions_root()
    now_s = time.time()
    now_ms = int(now_s * 1000)
    subs, mains = _walk(root)

    headers = {p: _read_header(p) for p in subs}
    parents = {p: (headers[p].get("parentSession") or "") for p in subs}
    wanted = {pp for p in subs for pp in (parents[p], os.path.dirname(p) + ".jsonl") if pp}
    agents = _agent_map(root, wanted)

    def is_fresh(path: str) -> bool:
        try:
            return now_s - os.path.getmtime(path) <= RUNNING_WINDOW_SECS
        except OSError:
            return False

    fresh_mains = [p for p in mains if is_fresh(p)]
    fresh_all = fresh_mains + [p for p in subs if is_fresh(p)]
    stats = _load_stats(stats_db_path(), None)
    live = _load_stats(stats_db_path(), fresh_all)

    fresh_all_set = set(fresh_all)
    runs: list[dict[str, Any]] = []

    def build(path: str, kind: str, parent: str) -> dict[str, Any] | None:
        try:
            mtime_ms = int(os.path.getmtime(path) * 1000)
        except OSError:
            return None
        header = headers.get(path) or _read_header(path)
        st = live if path in fresh_all_set else stats
        span = st.span.get(path)
        start = span[0] if span else (_iso_ms(header.get("timestamp")) or mtime_ms)
        last_activity = max(mtime_ms, span[1]) if span else mtime_ms
        fresh = now_s - mtime_ms / 1000 <= RUNNING_WINDOW_SECS
        last_tool = _last_tool_name(path) if fresh else None
        yielded = last_tool == "yield" if fresh else path in st.yielded
        if yielded:
            outcome = "ok"
        elif fresh:
            outcome = "running"
        else:
            outcome = _OUTCOME_BY_STOP.get(st.last_stop.get(path, ""), "unfinished" if span else "no data")
        if kind == "main" and outcome != "running":
            return None
        parent_path = parent or (os.path.dirname(path) + ".jsonl" if kind == "subagent" else "")
        parent_key = _rel(root, parent_path) if parent_path and os.path.exists(parent_path) else None
        rel = _rel(root, path) or path
        fallback_project = Path(path).parts[len(root.parts)] if len(Path(path).parts) > len(root.parts) else ""
        return {
            "key": rel,
            "name": Path(path).stem,
            "kind": kind,
            "agent": _resolve_agent(agents, path, parent) if kind == "subagent" else "main",
            "parent_key": parent_key,
            "project": _project_of(header.get("cwd"), fallback_project),
            "model": st.model.get(path) or _header_model(path),
            "start": start,
            "last_activity": last_activity,
            "duration_ms": max(0, last_activity - start),
            "tokens": span[3] if span else 0,
            "cost": span[4] if span else 0.0,
            "tools": st.tools.get(path, 0),
            "outcome": outcome,
        }

    for p in subs:
        run = build(p, "subagent", parents[p])
        if run:
            runs.append(run)
    for p in fresh_mains:
        run = build(p, "main", "")
        if run:
            runs.append(run)
    return {"now": now_ms, "runs": runs}


_cache: dict[str, Any] = {"at": 0.0, "scope": None, "payload": None}
_lock = threading.Lock()


def reset_cache() -> None:
    with _lock:
        _cache.update(at=0.0, scope=None, payload=None)


def get_runs(allow_stale: bool = False) -> dict[str, Any]:
    scope = (str(sessions_root()), str(stats_db_path()))

    def fresh() -> bool:
        if _cache["payload"] is None or _cache["scope"] != scope:
            return False
        return allow_stale or time.monotonic() - _cache["at"] < CACHE_TTL_SECS

    if fresh():
        return _cache["payload"]
    with _lock:
        if fresh():
            return _cache["payload"]
        payload = collect_runs()
        _cache.update(at=time.monotonic(), scope=scope, payload=payload)
        return payload


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def _short_args(args: Any) -> str:
    if isinstance(args, dict):
        args = {k: v for k, v in args.items() if k != "_i"}
    try:
        text = json.dumps(args, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        text = str(args)
    return _clip(text, ARGS_TEXT_MAX)


def _blocks_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
    )


def _render_message(rec: dict[str, Any]) -> dict[str, Any] | None:
    msg = rec.get("message")
    if not isinstance(msg, dict):
        return None
    role = msg.get("role")
    ts = msg.get("timestamp")
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        ts = _iso_ms(rec.get("timestamp")) or 0
    if role == "user":
        text = _clip(_blocks_text(msg.get("content")).strip(), USER_TEXT_MAX)
        return {"ts": int(ts), "role": "user", "tool_name": None, "text": text}
    if role == "toolResult":
        name = msg.get("toolName")
        text = _clip(_blocks_text(msg.get("content")).strip(), TOOL_TEXT_MAX)
        return {"ts": int(ts), "role": "tool", "tool_name": name if isinstance(name, str) else None, "text": text}
    if role == "assistant":
        content = msg.get("content")
        lines: list[str] = []
        if isinstance(content, str):
            lines.append(content.strip())
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    if block["text"].strip():
                        lines.append(block["text"].strip())
                elif block.get("type") == "toolCall":
                    lines.append(f"→ {block.get('name')}({_short_args(block.get('arguments'))})")
        text = "\n".join(lines)
        if not text:
            return None
        return {"ts": int(ts), "role": "assistant", "tool_name": None, "text": text}
    return None


def read_transcript(path: str, tail: int) -> list[dict[str, Any]]:
    raw: deque[str] = deque(maxlen=tail)
    try:
        with open(path, errors="ignore") as fh:
            for line in fh:
                if line.startswith('{"type":"message"'):
                    raw.append(line)
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in raw:
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        rendered = _render_message(rec) if isinstance(rec, dict) else None
        if rendered:
            out.append(rendered)
    return out


def resolve_key(key: str) -> tuple[Path | None, str]:
    if not key or "\0" in key or not key.endswith(".jsonl"):
        return None, "invalid key"
    root = Path(os.path.realpath(sessions_root()))
    path = Path(os.path.realpath(root / key))
    if root not in path.parents:
        return None, "invalid key"
    return path, ""


def session_payload(key: str, path: Path, run: dict[str, Any] | None, tail: int) -> dict[str, Any]:
    if run is None:
        header = _read_header(str(path))
        depth = len(Path(key).parts) - 1
        run = {
            "name": path.stem,
            "kind": "main" if depth <= 1 else "subagent",
            "agent": "main" if depth <= 1 else "unknown",
            "model": _header_model(str(path)),
            "project": _project_of(header.get("cwd"), Path(key).parts[0]),
            "outcome": _file_outcome(str(path), time.time()),
            "start": _iso_ms(header.get("timestamp")) or int(path.stat().st_mtime * 1000),
            "last_activity": int(path.stat().st_mtime * 1000),
        }
    return {
        "key": key,
        **{k: run[k] for k in ("name", "kind", "agent", "model", "project", "outcome", "start", "last_activity")},
        "messages": read_transcript(str(path), tail),
    }


def get_session(key: str, tail: int) -> tuple[int, dict[str, Any]]:
    tail = max(1, min(tail, MAX_TAIL))
    path, reason = resolve_key(key)
    if path is None:
        return 400, {"error": reason}
    if not path.is_file():
        return 404, {"error": "session not found"}
    run = next((r for r in get_runs(allow_stale=True)["runs"] if r["key"] == key), None)
    return 200, session_payload(key, path, run, tail)
