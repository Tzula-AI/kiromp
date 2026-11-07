from __future__ import annotations

import json
import os
import random
import sqlite3
import sys
import time
from pathlib import Path

HOUR_MS = 3_600_000
DAY_MS = 24 * HOUR_MS

SCHEMA = """
create table messages (
  id integer primary key autoincrement, session_file text not null, entry_id text not null, folder text not null,
  model text not null, provider text not null, timestamp integer not null, duration integer, ttft integer,
  stop_reason text not null, error_message text, input_tokens integer not null, output_tokens integer not null,
  cache_read_tokens integer not null, cache_write_tokens integer not null, total_tokens integer not null,
  cost_total real not null, agent_type text not null default 'main'
);
create index idx_messages_timestamp on messages (timestamp);
create table tool_calls (
  id integer primary key autoincrement, session_file text not null, tool_name text not null,
  agent_type text not null default 'main', timestamp integer
);
"""

MODELS = [
    ("anthropic", "claude-opus-5-5", 0.052),
    ("anthropic", "claude-sonnet-5-5", 0.011),
    ("openai-codex", "gpt-6-sol", 0.014),
    ("zai", "glm-5.3", 0.002),
]

AGENT_RUNS = [
    ("scout", "claude-sonnet-5-5", 14, 6, "ok"),
    ("scout", "claude-sonnet-5-5", 9, 4, "ok"),
    ("scout", "claude-sonnet-5-5", 3, 3, "running"),
    ("task", "claude-sonnet-5-5", 11, 31, "ok"),
    ("task", "claude-sonnet-5-5", 8, 28, "ok"),
    ("task", "claude-sonnet-5-5", 5, 22, "error"),
    ("task", "claude-sonnet-5-5", 2, 40, "ok"),
    ("reviewer", "claude-opus-5-5", 7, 12, "ok"),
    ("reviewer", "claude-opus-5-5", 4, 15, "ok"),
    ("heavy", "claude-opus-5-5", 10, 55, "ok"),
    ("heavy", "claude-opus-5-5", 1, 20, "running"),
    ("sonic", "glm-5.3", 6, 3, "ok"),
]

PROVIDER_OF = {m: p for p, m, _ in MODELS}
COST_OF = {m: c for _, m, c in MODELS}


def _line(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":")) + "\n"


def _assistant(text: str, tool: str | None, args: dict | None, ts: int, stop: str) -> dict:
    content: list[dict] = [{"type": "text", "text": text}]
    if tool:
        content.append({"type": "toolCall", "id": "c1", "name": tool, "arguments": args or {}})
    return {"type": "message", "message": {"role": "assistant", "content": content, "stopReason": stop, "timestamp": ts}}


def write_sessions(root: Path, db: sqlite3.Connection, now_ms: int, rng: random.Random) -> None:
    project = root / "-demo-shop"
    parent = project / "2026-11-06T09-00-00-000Z_demo.jsonl"
    project.mkdir(parents=True, exist_ok=True)
    names = [f"{i}-{agent.title()}Job" for i, (agent, *_rest) in enumerate(AGENT_RUNS)]
    progress = [{"id": n, "agent": r[0]} for n, r in zip(names, AGENT_RUNS)]
    header = {"type": "session", "timestamp": "2026-11-06T09:00:00.000Z", "cwd": str(Path.home() / "demo-shop")}
    parent.write_text(
        _line({"type": "title", "title": "demo"})
        + _line(header)
        + _line(
            {
                "type": "message",
                "message": {
                    "role": "toolResult",
                    "toolName": "task",
                    "content": [{"type": "text", "text": "done"}],
                    "details": {"agentSource": "bundled", "progress": progress},
                },
            }
        )
    )
    old = time.time() - 6 * 3600
    os.utime(parent, (old, old))
    subdir = project / parent.stem
    for name, (agent, model, hours_ago, minutes, outcome) in zip(names, AGENT_RUNS):
        path = subdir / f"{name}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        start = now_ms - int(hours_ago * HOUR_MS)
        stop = "toolUse" if outcome == "running" else ("error" if outcome == "error" else "stop")
        final_tool = "yield" if outcome == "ok" else "bash"
        body = [
            _line({"type": "title", "title": ""}),
            _line({**header, "parentSession": str(parent)}),
            _line({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": f"{agent}: look into the checkout flow"}], "timestamp": start}}),
            _line(_assistant("Reading the cart module first.", "read", {"path": "src/cart.ts"}, start + 1000, "toolUse")),
            _line({"type": "message", "message": {"role": "toolResult", "toolName": "read", "content": [{"type": "text", "text": "export function total(cart) { /* ... */ }"}], "timestamp": start + 2000}}),
            _line(_assistant("Found it. Summarising." if outcome == "ok" else "Running the test suite.", final_tool, {"result": "ok"} if final_tool == "yield" else {"command": "npm test"}, start + 3000, stop)),
        ]
        path.write_text("".join(body))
        if outcome != "running":
            stale = time.time() - hours_ago * 3600 + minutes * 60
            os.utime(path, (stale, stale))
        messages = max(3, minutes // 2)
        per = COST_OF[model]
        for k in range(messages):
            ts = start + int(k * minutes * 60_000 / messages)
            last = k == messages - 1
            tokens = rng.randint(60_000, 180_000)
            db.execute(
                "insert into messages (session_file, entry_id, folder, model, provider, timestamp, duration, ttft, stop_reason,"
                " input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_total, agent_type)"
                " values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'subagent')",
                (str(path), f"e{k}", "demo-shop", model, PROVIDER_OF[model], ts, rng.randint(2000, 9000), rng.randint(400, 1800),
                 stop if last else "toolUse", 20, 300, tokens - 500, 200, tokens, per * rng.uniform(0.6, 1.4)),
            )
            db.execute("insert into tool_calls (session_file, tool_name, agent_type, timestamp) values (?,?,'subagent',?)",
                       (str(path), "yield" if last and final_tool == "yield" else "read", ts))


def write_spend_history(db: sqlite3.Connection, now_ms: int, rng: random.Random) -> None:
    for day in range(30):
        weight = 0.35 + 0.65 * (1 - day / 30) + rng.uniform(-0.1, 0.1)
        for _ in range(int(220 * max(weight, 0.1))):
            provider, model, cost = rng.choices(MODELS, weights=[6, 3, 2, 1])[0]
            ts = now_ms - day * DAY_MS - rng.randint(0, DAY_MS - 1) if day else now_ms - rng.randint(0, 12 * HOUR_MS)
            tokens = rng.randint(40_000, 200_000)
            error = rng.random() < 0.004
            db.execute(
                "insert into messages (session_file, entry_id, folder, model, provider, timestamp, duration, ttft, stop_reason,"
                " input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_total, agent_type)"
                " values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"/demo/old-{day}.jsonl", f"e{rng.random()}", "demo-shop", model, provider, ts, rng.randint(2500, 9000),
                 rng.randint(500, 2500), "error" if error else "toolUse", 15, rng.randint(150, 900),
                 int(tokens * 0.93), int(tokens * 0.06), tokens, cost * rng.uniform(0.5, 1.5), "main" if rng.random() < 0.7 else "subagent"),
            )


FAKE_OMP = """#!/bin/sh
NOW=$(date +%s)
limit() { printf '{"id":"%s","label":"%s","window":{"id":"%s","resetsAt":%s000},"amount":{"used":%s,"limit":100,"usedFraction":%s,"unit":"percent"},"status":"%s"}' "$1" "$2" "$3" "$4" "$5" "$6" "$7"; }
echo '{"generatedAt":'"$NOW"'000,"reports":['
echo '{"provider":"anthropic","fetchedAt":'"$NOW"'000,"metadata":{"email":"alex@example.com","planType":"max"},"limits":['
limit a5 "Claude 5 Hour" 5h $((NOW + 8520)) 92 0.92 warning; echo ,
limit a7 "Claude 7 Day" 7d $((NOW + 259200)) 78 0.78 ok; echo ']},'
echo '{"provider":"anthropic","fetchedAt":'"$NOW"'000,"metadata":{"email":"alex@acme.dev","planType":"pro"},"limits":['
limit b5 "Claude 5 Hour" 5h $((NOW + 12000)) 31 0.31 ok; echo ,
limit b7 "Claude 7 Day" 7d $((NOW + 400000)) 9 0.09 ok; echo ']},'
echo '{"provider":"openai-codex","fetchedAt":'"$NOW"'000,"metadata":{"email":"alex@example.com","planType":"plus"},"limits":['
limit c5 "Codex 5 Hour" 5h $((NOW + 3000)) 12 0.12 ok; echo ,
limit cc "Spend cap" 1mo $((NOW + 1000000)) 100 1 exhausted; echo ']},'
echo '{"provider":"zai","fetchedAt":'"$NOW"'000,"metadata":{"planType":"pro"},"limits":['
limit z5 "ZAI 5 Hours Token Quota" 5h $((NOW + 10000)) 19 0.19 ok; echo ']}'
echo ']}'
"""


def main(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    db_path = target / "stats.db"
    db_path.unlink(missing_ok=True)
    rng = random.Random(7)
    now_ms = int(time.time() * 1000)
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    write_spend_history(db, now_ms, rng)
    write_sessions(target / "sessions", db, now_ms, rng)
    db.commit()
    db.close()
    omp = target / "omp"
    omp.write_text(FAKE_OMP)
    omp.chmod(0o755)
    print(f"demo data in {target}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "omp-demo"))
