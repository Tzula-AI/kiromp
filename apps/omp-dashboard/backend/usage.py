"""Limits: cached ``omp usage --json`` plus once-per-window near-limit alerts."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Protocol

from paths import data_dir

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECS = 300
FETCH_TIMEOUT_SECS = 60
WARN_FRACTION = 0.9

LEDGER_FILENAME = "usage-alerts.json"
NOTE_GROUP_KEY = "omp-dashboard"
_LEDGER_RETAIN_MS = 24 * 3600 * 1000
_RESET_BUCKET_MS = 60_000

THRESHOLD_WARN = "90"
THRESHOLD_EXHAUSTED = "exhausted"

_KEPT_METADATA = ("email", "accountId", "orgName", "planType")


class Notifier(Protocol):
    def push(self, title: str, body: str) -> bool: ...


def _fraction(limit: dict[str, Any]) -> float:
    amount = limit.get("amount")
    value = amount.get("usedFraction") if isinstance(amount, dict) else None
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def _account_of(report: dict[str, Any]) -> str:
    meta = report.get("metadata")
    if isinstance(meta, dict):
        for key in ("email", "accountId"):
            value = meta.get(key)
            if isinstance(value, str) and value:
                return value
    for key in ("email", "accountId"):
        value = report.get(key)
        if isinstance(value, str) and value:
            return value
    provider = report.get("provider")
    return provider if isinstance(provider, str) else ""


def extract_alerts(reports: Any) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    if not isinstance(reports, list):
        return alerts
    for report in reports:
        if not isinstance(report, dict) or not isinstance(report.get("limits"), list):
            continue
        account = _account_of(report)
        for limit in report["limits"]:
            if not isinstance(limit, dict):
                continue
            used = _fraction(limit)
            status = limit.get("status")
            if used < WARN_FRACTION and status != "exhausted":
                continue
            window = limit.get("window")
            resets_at = window.get("resetsAt") if isinstance(window, dict) else None
            alerts.append(
                {
                    "provider": report.get("provider"),
                    "account": account,
                    "limitId": limit.get("id"),
                    "label": limit.get("label"),
                    "usedFraction": used,
                    "resetsAt": resets_at if isinstance(resets_at, (int, float)) else None,
                    "status": status,
                }
            )
    return alerts


def threshold_of(alert: dict[str, Any]) -> str:
    exhausted = alert.get("status") == "exhausted" or alert["usedFraction"] >= 1.0
    return THRESHOLD_EXHAUSTED if exhausted else THRESHOLD_WARN


def dedupe_key(alert: dict[str, Any], threshold: str) -> str:
    resets = alert.get("resetsAt")
    bucket = round(resets / _RESET_BUCKET_MS) if isinstance(resets, (int, float)) else "none"
    return f"{alert.get('limitId')}|{alert.get('account')}|{bucket}|{threshold}"


def _format_reset(resets_at: Any) -> str:
    if not isinstance(resets_at, (int, float)):
        return "unknown"
    return time.strftime("%Y-%m-%d %H:%M %Z", time.localtime(resets_at / 1000))


def note_text(alert: dict[str, Any], threshold: str) -> tuple[str, str]:
    label = alert.get("label") or alert.get("limitId") or "Limit"
    account = alert.get("account") or alert.get("provider") or "unknown account"
    if threshold == THRESHOLD_EXHAUSTED:
        title = f"{label} exhausted — {account}"
    else:
        title = f"{label} at {round(alert['usedFraction'] * 100)}% — {account}"
    body = f"Provider: {alert.get('provider')}. Resets {_format_reset(alert.get('resetsAt'))}."
    return title, body


def read_ledger(path: Path) -> dict[str, float]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        logger.warning("could not read the usage alert ledger", exc_info=True)
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, (int, float))}


def write_ledger(path: Path, ledger: dict[str, float]) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(ledger, indent=2, sort_keys=True) + "\n")
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except OSError:
        logger.warning("could not write the usage alert ledger", exc_info=True)
        return False
    return True


def resolve_omp() -> str | None:
    override = os.environ.get("OMP_BIN")
    if override and os.access(override, os.X_OK):
        return override
    found = shutil.which("omp")
    if found:
        return found
    home = Path.home()
    for candidate in (home / ".bun" / "bin" / "omp", home / ".local" / "bin" / "omp", Path("/usr/local/bin/omp")):
        if os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def _slim(reports: list[Any]) -> list[Any]:
    slim: list[Any] = []
    for report in reports:
        if not isinstance(report, dict):
            continue
        meta = report.get("metadata")
        kept = {k: meta[k] for k in _KEPT_METADATA if isinstance(meta, dict) and k in meta}
        slim.append({**{k: v for k, v in report.items() if k != "metadata"}, "metadata": kept})
    return slim


def run_omp_usage() -> dict[str, Any]:
    exe = resolve_omp()
    if exe is None:
        raise RuntimeError("omp binary not found (put `omp` on PATH or set OMP_BIN)")
    try:
        proc = subprocess.run(
            [exe, "usage", "--json"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=FETCH_TIMEOUT_SECS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"omp usage timed out after {FETCH_TIMEOUT_SECS}s") from None
    except OSError as exc:
        raise RuntimeError(f"could not run omp: {exc}") from exc
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", "replace").strip()[:300]
        raise RuntimeError(f"omp usage exited {proc.returncode}: {detail}")
    try:
        data = json.loads(proc.stdout)
    except ValueError as exc:
        raise RuntimeError(f"omp usage returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("reports"), list):
        raise RuntimeError("omp usage JSON has no 'reports' array")
    return data


class OmpUsageService:

    def __init__(
        self,
        notifier: Notifier | None,
        fetcher: Callable[[], dict[str, Any]] = run_omp_usage,
        ledger_path: Path | None = None,
    ) -> None:
        self._notifier = notifier
        self._fetcher = fetcher
        self._ledger_path = ledger_path or (data_dir() / LEDGER_FILENAME)
        self._lock = threading.Lock()
        self._inflight: threading.Event | None = None
        self._reports: list[Any] = []
        self._fetched_at: int = 0
        self._error: str | None = None
        self._ever_attempted = False

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            reports, fetched_at = self._reports, self._fetched_at
            error, attempted = self._error, self._ever_attempted
        return {
            "ok": attempted and error is None,
            "error": error,
            "fetchedAt": fetched_at,
            "reports": reports,
            "alerts": extract_alerts(reports),
        }

    def get(self, *, refresh: bool = False) -> dict[str, Any]:
        if refresh or not self._ever_attempted:
            self.refresh()
        return self.snapshot()

    def refresh(self) -> None:
        with self._lock:
            event = self._inflight
            leader = event is None
            if leader:
                event = self._inflight = threading.Event()
        assert event is not None
        if not leader:
            event.wait()
            return
        try:
            self._fetch_and_notify()
        finally:
            with self._lock:
                self._inflight = None
            event.set()

    def _fetch_and_notify(self) -> None:
        try:
            data = self._fetcher()
        except Exception as exc:  # noqa: BLE001 -- surfaced via the snapshot, never raised
            with self._lock:
                self._error = str(exc) or type(exc).__name__
                self._ever_attempted = True
            logger.warning("omp usage fetch failed: %s", self._error)
            return
        reports = _slim(data["reports"])
        with self._lock:
            self._reports = reports
            self._fetched_at = int(time.time() * 1000)
            self._error = None
            self._ever_attempted = True
        try:
            self._notify(extract_alerts(reports))
        except Exception:  # noqa: BLE001 -- notifications never fail a fetch
            logger.warning("omp usage alert notification failed", exc_info=True)

    def _notify(self, alerts: list[dict[str, Any]]) -> None:
        ledger = read_ledger(self._ledger_path)
        now_ms = time.time() * 1000
        changed = False
        for alert in alerts:
            threshold = threshold_of(alert)
            key = dedupe_key(alert, threshold)
            if key in ledger:
                continue
            covered = [key]
            if threshold == THRESHOLD_EXHAUSTED:
                covered.append(dedupe_key(alert, THRESHOLD_WARN))
            if self._notifier is None or not self._publish(alert, threshold):
                continue
            expiry = (alert.get("resetsAt") or now_ms) + _LEDGER_RETAIN_MS
            for k in covered:
                ledger[k] = expiry
            changed = True
        stale = [k for k, expiry in ledger.items() if expiry < now_ms]
        for k in stale:
            del ledger[k]
        if changed or stale:
            write_ledger(self._ledger_path, ledger)

    def _publish(self, alert: dict[str, Any], threshold: str) -> bool:
        title, body = note_text(alert, threshold)
        try:
            return bool(self._notifier.push(title, body))  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001 -- one bad note must not stop the rest
            logger.warning("omp usage notification rejected: %s", title, exc_info=True)
            return False


def start_poller(service: OmpUsageService, interval: float = POLL_INTERVAL_SECS) -> threading.Event:
    stop = threading.Event()

    def loop() -> None:
        while not stop.is_set():
            try:
                service.refresh()
            except Exception:  # noqa: BLE001 -- the poller outlives any one failure
                logger.warning("omp usage poll failed", exc_info=True)
            stop.wait(interval)

    threading.Thread(target=loop, name="omp-dashboard-poller", daemon=True).start()
    return stop


CHIP_WARN_FRACTION = 0.75


def worst_fraction(reports: list[Any]) -> float | None:
    worst: float | None = None
    for report in reports:
        if not isinstance(report, dict) or not isinstance(report.get("limits"), list):
            continue
        for limit in report["limits"]:
            if not isinstance(limit, dict):
                continue
            if limit.get("status") == "exhausted":
                used: float | None = 1.0
            else:
                amount = limit.get("amount")
                value = amount.get("usedFraction") if isinstance(amount, dict) else None
                used = max(0.0, float(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
            if used is not None and (worst is None or used > worst):
                worst = used
    return worst


def chip_status(snapshot: dict[str, Any]) -> dict[str, str]:
    worst = worst_fraction(snapshot["reports"])
    if worst is None:
        error = snapshot.get("error")
        return {"state": "none", "tooltip": f"OMP usage unavailable: {error}" if error else "OMP usage"}
    pct = round(worst * 100)
    tooltip = f"OMP usage: {pct}% used on the busiest limit"
    return {"state": "warn" if worst >= CHIP_WARN_FRACTION else "ok", "tooltip": tooltip}
