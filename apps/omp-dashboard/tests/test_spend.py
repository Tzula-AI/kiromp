from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import paths
import pytest
import spend

HOUR = 3_600_000
NOW = int(datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)

SCHEMA = """
create table messages (
  id integer primary key autoincrement, timestamp integer not null, provider text not null, model text not null,
  agent_type text not null default 'main', cost_total real not null, total_tokens integer not null,
  input_tokens integer not null, output_tokens integer not null, cache_read_tokens integer not null,
  cache_write_tokens integer not null, duration integer, ttft integer, stop_reason text not null, error_message text
);
create index idx_messages_timestamp_model_provider on messages (timestamp, model, provider);
"""

COLUMNS = (
    "timestamp, provider, model, agent_type, cost_total, total_tokens, input_tokens, output_tokens, "
    "cache_read_tokens, cache_write_tokens, duration, ttft, stop_reason"
)


def row(hours_ago, provider, model, agent, cost, tokens, inp, out, cr, cw, duration, ttft, stop):
    return (NOW - int(hours_ago * HOUR), provider, model, agent, cost, tokens, inp, out, cr, cw, duration, ttft, stop)


ROWS = [
    row(1, "anthropic", "opus", "main", 1.0, 1000, 10, 100, 800, 90, 2000, 500, "toolUse"),
    row(2, "anthropic", "opus", "subagent", 2.0, 2000, 20, 200, 1600, 180, 4000, 1500, "stop"),
    row(5, "zai", "glm", "main", 0.5, 500, 5, 50, 400, 45, 1000, None, "error"),
    row(30, "anthropic", "sonnet", "main", 4.0, 4000, 0, 0, 0, 0, None, None, "stop"),
    row(5 * 24, "anthropic", "opus", "main", 8.0, 8000, 0, 0, 0, 0, None, None, "stop"),
    row(20 * 24, "openai-codex", "gpt", "main", 16.0, 16000, 0, 0, 0, 0, None, None, "stop"),
    row(40 * 24, "anthropic", "opus", "main", 100.0, 1, 0, 0, 0, 0, None, None, "stop"),
    row(-1, "anthropic", "opus", "main", 1000.0, 1, 0, 0, 0, 0, None, None, "stop"),
]


def fixture_db(path: Path, rows=None, now_ms: int | None = None) -> Path:
    """Build a stats db whose rows sit at the same offsets from ``now_ms`` (default: the real now)."""
    shift = (int(time.time() * 1000) if now_ms is None else now_ms) - NOW
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.executemany(
        f"insert into messages ({COLUMNS}) values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(r[0] + shift, *r[1:]) for r in (ROWS if rows is None else rows)],
    )
    conn.commit()
    conn.close()
    return path


@pytest.fixture(autouse=True)
def utc(monkeypatch):
    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.fixture
def db(tmp_path: Path) -> Path:
    return fixture_db(tmp_path / "stats.db", now_ms=NOW)


def test_window_totals_count_each_window_from_now_and_ignore_the_future(db: Path) -> None:
    windows = spend.compute(db, now_ms=NOW)["windows"]
    assert windows["24h"] == {"cost": 3.5, "requests": 3, "tokens": 3500, "errors": 1}
    assert windows["3d"] == {"cost": 7.5, "requests": 4, "tokens": 7500, "errors": 1}
    assert windows["7d"] == {"cost": 15.5, "requests": 5, "tokens": 15500, "errors": 1}
    assert windows["30d"] == {"cost": 31.5, "requests": 6, "tokens": 31500, "errors": 1}


def test_window_boundary_is_inclusive_at_exactly_the_cutoff(tmp_path: Path) -> None:
    path = fixture_db(
        tmp_path / "b.db",
        rows=[row(24, "p", "m", "main", 1.0, 1, 0, 0, 0, 0, None, None, "stop"), row(24.001, "p", "m", "main", 5.0, 1, 0, 0, 0, 0, None, None, "stop")],
        now_ms=NOW,
    )
    assert spend.compute(path, now_ms=NOW)["windows"]["24h"]["cost"] == 1.0


def test_selected_window_summary_rates(db: Path) -> None:
    summary = spend.compute(db, "24h", now_ms=NOW)["summary"]
    assert (summary["cost"], summary["requests"], summary["tokens"], summary["errors"]) == (3.5, 3, 3500, 1)
    assert (summary["inputTokens"], summary["outputTokens"]) == (35, 350)
    assert (summary["cacheReadTokens"], summary["cacheWriteTokens"]) == (2800, 315)
    assert summary["cacheHitRate"] == pytest.approx(2800 / (35 + 2800 + 315))
    assert summary["avgTtftMs"] == pytest.approx(1000.0)
    assert summary["tokensPerSecond"] == pytest.approx(350 * 1000 / 7000)


def test_window_parameter_changes_the_breakdown_but_not_the_window_tiles(db: Path) -> None:
    day = spend.compute(db, "24h", now_ms=NOW)
    week = spend.compute(db, "7d", now_ms=NOW)
    assert week["window"] == "7d" and week["summary"]["cost"] == 15.5
    assert week["windows"] == day["windows"]


def test_breakdowns_group_in_sql_order_by_cost_with_shares(db: Path) -> None:
    payload = spend.compute(db, "24h", now_ms=NOW)
    by_provider = payload["byProvider"]
    assert [(r["name"], r["cost"], r["requests"], r["tokens"]) for r in by_provider] == [
        ("anthropic", 3.0, 2, 3000),
        ("zai", 0.5, 1, 500),
    ]
    assert [r["share"] for r in by_provider] == pytest.approx([3.0 / 3.5, 0.5 / 3.5])
    assert [(r["name"], r["provider"], r["cost"]) for r in payload["byModel"]] == [("opus", "anthropic", 3.0), ("glm", "zai", 0.5)]
    assert [(r["name"], r["cost"], r["requests"]) for r in payload["byAgentType"]] == [("subagent", 2.0, 1), ("main", 1.5, 2)]
    assert sum(r["share"] for r in payload["byAgentType"]) == pytest.approx(1.0)


def test_same_model_name_under_two_providers_stays_two_rows(tmp_path: Path) -> None:
    rows = [
        row(1, "a", "shared", "main", 1.0, 1, 0, 0, 0, 0, None, None, "stop"),
        row(1, "b", "shared", "main", 2.0, 1, 0, 0, 0, 0, None, None, "stop"),
    ]
    payload = spend.compute(fixture_db(tmp_path / "s.db", rows, NOW), now_ms=NOW)
    assert [(r["provider"], r["cost"]) for r in payload["byModel"]] == [("b", 2.0), ("a", 1.0)]


def test_share_falls_back_to_requests_when_nothing_costs_anything(tmp_path: Path) -> None:
    rows = [row(1, "a", "m1", "main", 0.0, 1, 0, 0, 0, 0, None, None, "stop")] * 3 + [
        row(1, "b", "m2", "main", 0.0, 1, 0, 0, 0, 0, None, None, "stop")
    ]
    payload = spend.compute(fixture_db(tmp_path / "z.db", rows, NOW), now_ms=NOW)
    assert [(r["name"], r["share"]) for r in payload["byProvider"]] == [("a", 0.75), ("b", 0.25)]


def test_model_breakdown_is_capped(tmp_path: Path) -> None:
    rows = [row(1, "p", f"m{i:03}", "main", float(i), 1, 0, 0, 0, 0, None, None, "stop") for i in range(spend.MODEL_ROWS + 10)]
    payload = spend.compute(fixture_db(tmp_path / "c.db", rows, NOW), now_ms=NOW)
    assert len(payload["byModel"]) == spend.MODEL_ROWS
    assert payload["byModel"][0]["name"] == f"m{spend.MODEL_ROWS + 9:03}"


def test_daily_series_is_fourteen_local_days_ending_today_with_gaps_filled(db: Path) -> None:
    daily = spend.compute(db, now_ms=NOW)["daily"]
    assert len(daily) == 14
    assert (daily[0]["date"], daily[-1]["date"]) == ("2026-10-25", "2026-11-07")
    by_date = {d["date"]: d for d in daily}
    assert by_date["2026-11-07"] == {"date": "2026-11-07", "cost": 3.5, "requests": 3}
    assert by_date["2026-11-06"]["cost"] == 4.0
    assert by_date["2026-11-02"]["cost"] == 8.0
    assert by_date["2026-11-05"] == {"date": "2026-11-05", "cost": 0.0, "requests": 0}
    assert sum(d["cost"] for d in daily) == 15.5


def test_daily_buckets_follow_the_local_timezone(tmp_path: Path, monkeypatch) -> None:
    late = datetime(2026, 11, 7, 3, 0, tzinfo=timezone.utc)
    rows = [(int(late.timestamp() * 1000), "p", "m", "main", 5.0, 1, 0, 0, 0, 0, None, None, "stop")]
    path = fixture_db(tmp_path / "tz.db", rows, NOW)
    assert {d["date"]: d["cost"] for d in spend.compute(path, now_ms=NOW)["daily"]}["2026-11-07"] == 5.0
    monkeypatch.setenv("TZ", "EST5")
    time.tzset()
    est = {d["date"]: d["cost"] for d in spend.compute(path, now_ms=NOW)["daily"]}
    assert est["2026-11-06"] == 5.0 and est["2026-11-07"] == 0.0


def test_empty_window_has_zero_totals_and_no_rates(tmp_path: Path) -> None:
    path = fixture_db(tmp_path / "e.db", [row(24 * 20, "p", "m", "main", 9.0, 1, 0, 0, 0, 0, None, None, "stop")], NOW)
    payload = spend.compute(path, "24h", now_ms=NOW)
    assert payload["available"] is True
    assert payload["summary"]["cost"] == 0 and payload["summary"]["requests"] == 0
    assert payload["summary"]["cacheHitRate"] is None
    assert payload["summary"]["avgTtftMs"] is None and payload["summary"]["tokensPerSecond"] is None
    assert payload["byProvider"] == [] and payload["byModel"] == [] and payload["byAgentType"] == []


def test_missing_database_is_unavailable_not_an_error(tmp_path: Path) -> None:
    payload = spend.compute(tmp_path / "nope.db", now_ms=NOW)
    assert payload["available"] is False and payload["error"] is None
    assert "summary" not in payload


def test_unreadable_database_reports_an_error_and_stays_unavailable(tmp_path: Path) -> None:
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"this is not sqlite" * 100)
    payload = spend.compute(bad, now_ms=NOW)
    assert payload["available"] is False and "stats db" in payload["error"]
    empty = tmp_path / "empty.db"
    sqlite3.connect(empty).close()
    assert spend.compute(empty, now_ms=NOW)["error"] is not None


def test_the_database_is_opened_read_only(db: Path) -> None:
    before = db.read_bytes()
    conn = paths.connect_readonly(db)
    with pytest.raises(sqlite3.OperationalError, match="readonly"):
        conn.execute("delete from messages")
    conn.close()
    spend.compute(db, now_ms=NOW)
    assert db.read_bytes() == before


def test_unknown_window_is_rejected(db: Path) -> None:
    with pytest.raises(ValueError, match="90d"):
        spend.compute(db, "90d", now_ms=NOW)


class TestSpendService:
    def test_serves_the_cache_inside_the_ttl_per_window_and_refetches_after(self, db: Path) -> None:
        now = [NOW / 1000]
        svc = spend.SpendService(path_fn=lambda: db, clock=lambda: now[0], ttl=60)
        first = svc.get("24h")
        conn = sqlite3.connect(db)
        conn.execute(f"insert into messages ({COLUMNS}) values (?,'p','m','main',50.0,1,0,0,0,0,NULL,NULL,'stop')", (NOW - 1000,))
        conn.commit()
        conn.close()
        now[0] += 30
        assert svc.get("24h") is first
        assert svc.get("7d")["window"] == "7d"
        now[0] += 31
        assert svc.get("24h")["summary"]["cost"] == 53.5

    def test_refresh_bypasses_the_cache(self, db: Path) -> None:
        svc = spend.SpendService(path_fn=lambda: db, clock=lambda: NOW / 1000, ttl=60)
        a = svc.get("24h")
        assert svc.get("24h") is a
        assert svc.get("24h", refresh=True) is not a

    def test_follows_the_stats_db_env_override(self, db: Path, monkeypatch) -> None:
        monkeypatch.setenv("OMP_DASHBOARD_STATS_DB", str(db))
        svc = spend.SpendService(clock=lambda: NOW / 1000)
        assert svc.get()["available"] is True
        monkeypatch.setenv("OMP_DASHBOARD_STATS_DB", str(db) + ".missing")
        assert svc.get()["available"] is False

    def test_unknown_window_raises(self, db: Path) -> None:
        with pytest.raises(ValueError):
            spend.SpendService(path_fn=lambda: db).get("1y")
