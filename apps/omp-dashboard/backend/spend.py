"""Spend: cost, tokens and request aggregates from omp's own ``stats.db``.

The database is opened read-only (``mode=ro``) and every number is aggregated in
SQL. ``cost_total`` is the list-price (API-equivalent) cost omp computes per
message; subscription accounts are not billed it. A missing database means
"omp stats are not available here" and yields ``available: false``, not an error.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from paths import connect_readonly, stats_db_path

HOUR_MS = 3_600_000
DAY_MS = 24 * HOUR_MS
WINDOWS: dict[str, int] = {"24h": DAY_MS, "3d": 3 * DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS}
DEFAULT_WINDOW = "24h"
CACHE_TTL_SECS = 60
DAILY_DAYS = 14
MODEL_ROWS = 25

_BREAKDOWNS = {
    "byProvider": ("provider",),
    "byModel": ("provider", "model"),
    "byAgentType": ("agent_type",),
}


def _window_totals(conn: sqlite3.Connection, now_ms: int) -> dict[str, dict[str, float | int]]:
    columns: list[str] = []
    params: dict[str, int] = {"until": now_ms}
    for name, span in WINDOWS.items():
        params[f"since_{name}"] = now_ms - span
        hit = f"timestamp >= :since_{name}"
        columns += [
            f"COALESCE(SUM(CASE WHEN {hit} THEN cost_total END), 0)",
            f"COALESCE(SUM({hit}), 0)",
            f"COALESCE(SUM(CASE WHEN {hit} THEN total_tokens END), 0)",
            f"COALESCE(SUM({hit} AND stop_reason = 'error'), 0)",
        ]
    oldest = now_ms - max(WINDOWS.values())
    row = conn.execute(
        f"SELECT {', '.join(columns)} FROM messages WHERE timestamp >= {oldest} AND timestamp <= :until",
        params,
    ).fetchone()
    out: dict[str, dict[str, float | int]] = {}
    for i, name in enumerate(WINDOWS):
        cost, requests, tokens, errors = row[i * 4 : i * 4 + 4]
        out[name] = {"cost": float(cost), "requests": int(requests), "tokens": int(tokens), "errors": int(errors)}
    return out


def _summary(conn: sqlite3.Connection, since: int, until: int) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(cost_total), 0), COUNT(*), COALESCE(SUM(total_tokens), 0),
               COALESCE(SUM(stop_reason = 'error'), 0),
               COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
               COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0),
               AVG(CASE WHEN ttft > 0 THEN ttft END),
               SUM(CASE WHEN duration > 0 AND output_tokens > 0 THEN output_tokens END),
               SUM(CASE WHEN duration > 0 AND output_tokens > 0 THEN duration END)
        FROM messages WHERE timestamp >= ? AND timestamp <= ?
        """,
        (since, until),
    ).fetchone()
    cost, requests, tokens, errors, inp, out, cache_read, cache_write, ttft, timed_out, timed_ms = row
    prompt = inp + cache_read + cache_write
    return {
        "cost": float(cost),
        "requests": int(requests),
        "tokens": int(tokens),
        "errors": int(errors),
        "inputTokens": int(inp),
        "outputTokens": int(out),
        "cacheReadTokens": int(cache_read),
        "cacheWriteTokens": int(cache_write),
        "cacheHitRate": cache_read / prompt if prompt > 0 else None,
        "avgTtftMs": float(ttft) if ttft is not None else None,
        "tokensPerSecond": timed_out * 1000.0 / timed_ms if timed_ms else None,
    }


def _breakdown(
    conn: sqlite3.Connection, keys: tuple[str, ...], since: int, until: int, total_cost: float, total_requests: int
) -> list[dict[str, Any]]:
    cols = ", ".join(keys)
    rows = conn.execute(
        f"""
        SELECT {cols}, COALESCE(SUM(cost_total), 0) AS cost, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0)
        FROM messages WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY {cols} ORDER BY cost DESC, requests DESC, {cols} LIMIT {MODEL_ROWS}
        """,
        (since, until),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        *labels, cost, requests, tokens = row
        share = cost / total_cost if total_cost > 0 else (requests / total_requests if total_requests else 0.0)
        entry: dict[str, Any] = {
            "name": labels[-1],
            "cost": float(cost),
            "requests": int(requests),
            "tokens": int(tokens),
            "share": share,
        }
        if len(labels) > 1:
            entry["provider"] = labels[0]
        out.append(entry)
    return out


def _daily(conn: sqlite3.Connection, now_ms: int) -> list[dict[str, Any]]:
    today = datetime.fromtimestamp(now_ms / 1000).replace(hour=0, minute=0, second=0, microsecond=0)
    first = today - timedelta(days=DAILY_DAYS - 1)
    rows = conn.execute(
        """
        SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') AS day,
               COALESCE(SUM(cost_total), 0), COUNT(*)
        FROM messages WHERE timestamp >= ? AND timestamp <= ? GROUP BY day
        """,
        (int(first.timestamp() * 1000), now_ms),
    ).fetchall()
    by_day = {day: (float(cost), int(n)) for day, cost, n in rows}
    series = []
    for i in range(DAILY_DAYS):
        key = (first + timedelta(days=i)).strftime("%Y-%m-%d")
        cost, n = by_day.get(key, (0.0, 0))
        series.append({"date": key, "cost": cost, "requests": n})
    return series


def compute(path: Path, window: str = DEFAULT_WINDOW, now_ms: int | None = None) -> dict[str, Any]:
    if window not in WINDOWS:
        raise ValueError(f"unknown window {window!r}; expected one of {', '.join(WINDOWS)}")
    now = int(time.time() * 1000) if now_ms is None else now_ms
    base: dict[str, Any] = {"available": False, "error": None, "generatedAt": now, "window": window}
    if not path.is_file():
        return base
    try:
        conn = connect_readonly(path)
    except sqlite3.Error as exc:
        return {**base, "error": f"could not open stats db: {exc}"}
    try:
        since = now - WINDOWS[window]
        summary = _summary(conn, since, now)
        payload = {
            **base,
            "available": True,
            "windows": _window_totals(conn, now),
            "summary": summary,
            "daily": _daily(conn, now),
        }
        for name, keys in _BREAKDOWNS.items():
            payload[name] = _breakdown(conn, keys, since, now, summary["cost"], summary["requests"])
        return payload
    except sqlite3.Error as exc:
        return {**base, "error": f"could not read stats db: {exc}"}
    finally:
        conn.close()


class SpendService:
    def __init__(
        self,
        path_fn: Callable[[], Path] = stats_db_path,
        clock: Callable[[], float] = time.time,
        ttl: float = CACHE_TTL_SECS,
    ) -> None:
        self._path_fn = path_fn
        self._clock = clock
        self._ttl = ttl
        self._lock = threading.Lock()
        self._cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}

    def get(self, window: str = DEFAULT_WINDOW, *, refresh: bool = False) -> dict[str, Any]:
        if window not in WINDOWS:
            raise ValueError(f"unknown window {window!r}; expected one of {', '.join(WINDOWS)}")
        path = self._path_fn()
        key = (str(path), window)
        with self._lock:
            hit = self._cache.get(key)
            now = self._clock()
            if hit and not refresh and now - hit[0] < self._ttl:
                return hit[1]
            payload = compute(path, window, int(now * 1000))
            self._cache[key] = (now, payload)
            return payload
