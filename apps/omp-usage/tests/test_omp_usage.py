from __future__ import annotations

import json
import stat
import threading
import time
from pathlib import Path
from typing import Any

import omp_usage
import pytest

RESET = 1_794_000_000_000


def limit(lid: str, used: float, status: str = "ok", resets: int | None = RESET) -> dict[str, Any]:
    return {
        "id": lid,
        "label": "Claude 5 Hour",
        "window": {"resetsAt": resets},
        "amount": {"usedFraction": used},
        "status": status,
    }


def report(*limits: dict[str, Any], email: str = "tommy@basedaf.dev") -> dict[str, Any]:
    return {"provider": "anthropic", "limits": list(limits), "metadata": {"email": email}}


class FakeNotifier:
    def __init__(self, accept: bool = True) -> None:
        self.accept = accept
        self.pushed: list[tuple[str, str]] = []

    def push(self, title: str, body: str) -> bool:
        self.pushed.append((title, body))
        return self.accept

    @property
    def titles(self) -> list[str]:
        return [t for t, _ in self.pushed]


@pytest.fixture
def ledger(tmp_path: Path) -> Path:
    return tmp_path / "alerts.json"


def service_for(notifier: Any, payloads: list[Any], ledger_path: Path) -> omp_usage.OmpUsageService:
    queue = list(payloads)

    def fetcher() -> dict[str, Any]:
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return {"reports": item}

    return omp_usage.OmpUsageService(notifier, fetcher=fetcher, ledger_path=ledger_path)


class TestExtractAlerts:
    def test_threshold_is_inclusive_and_exhausted_status_counts(self) -> None:
        reports = [
            report(
                limit("a", 0.89),
                limit("b", 0.9),
                limit("c", 0.5, status="exhausted"),
                limit("d", 1.0, status="exhausted"),
            )
        ]
        assert [a["limitId"] for a in omp_usage.extract_alerts(reports)] == ["b", "c", "d"]

    def test_account_falls_back_from_email_to_account_id_to_provider(self) -> None:
        by_id = {"provider": "p", "metadata": {"accountId": "acc-1"}, "limits": [limit("x", 1.0)]}
        bare = {"provider": "zai", "limits": [limit("y", 1.0)]}
        accounts = [a["account"] for a in omp_usage.extract_alerts([by_id, bare])]
        assert accounts == ["acc-1", "zai"]

    def test_malformed_input_yields_nothing(self) -> None:
        assert omp_usage.extract_alerts(None) == []
        assert omp_usage.extract_alerts(["x", {"limits": "nope"}, {"limits": [None]}]) == []

    def test_missing_used_fraction_is_not_an_alert(self) -> None:
        assert omp_usage.extract_alerts([report({"id": "q", "status": "ok"})]) == []


class TestDedupe:
    def test_reset_time_jitter_within_a_minute_is_one_window(self) -> None:
        a = omp_usage.extract_alerts([report(limit("a", 0.95, resets=RESET + 444))])[0]
        b = omp_usage.extract_alerts([report(limit("a", 0.96, resets=RESET + 445))])[0]
        assert omp_usage.dedupe_key(a, "90") == omp_usage.dedupe_key(b, "90")

    def test_each_axis_distinguishes_keys(self) -> None:
        base = omp_usage.extract_alerts([report(limit("a", 0.95))])[0]
        keys = {
            omp_usage.dedupe_key(base, "90"),
            omp_usage.dedupe_key(base, "exhausted"),
            omp_usage.dedupe_key({**base, "account": "other"}, "90"),
            omp_usage.dedupe_key({**base, "limitId": "z"}, "90"),
            omp_usage.dedupe_key({**base, "resetsAt": RESET + 3_600_000}, "90"),
        }
        assert len(keys) == 5


class TestNotify:
    def test_one_note_per_window_across_polls_and_restart(self, ledger: Path) -> None:
        notifier = FakeNotifier()
        payload = [report(limit("a", 0.92))]
        svc = service_for(notifier, [payload, payload], ledger)
        svc.refresh()
        svc.refresh()
        assert len(notifier.pushed) == 1
        title, body = notifier.pushed[0]
        assert title == "Claude 5 Hour at 92% — tommy@basedaf.dev"
        assert "Provider: anthropic" in body and "Resets" in body

        restarted = FakeNotifier()
        service_for(restarted, [payload], ledger).refresh()
        assert restarted.pushed == []

    def test_warn_then_exhausted_are_two_notes_and_exhausted_is_once(self, ledger: Path) -> None:
        notifier = FakeNotifier()
        svc = service_for(
            notifier,
            [
                [report(limit("a", 0.93))],
                [report(limit("a", 1.0, status="exhausted"))],
                [report(limit("a", 1.0, status="exhausted"))],
            ],
            ledger,
        )
        for _ in range(3):
            svc.refresh()
        assert notifier.titles == [
            "Claude 5 Hour at 93% — tommy@basedaf.dev",
            "Claude 5 Hour exhausted — tommy@basedaf.dev",
        ]

    def test_straight_to_exhausted_skips_the_90_note(self, ledger: Path) -> None:
        notifier = FakeNotifier()
        svc = service_for(
            notifier,
            [[report(limit("a", 1.0, status="exhausted"))], [report(limit("a", 0.95))]],
            ledger,
        )
        svc.refresh()
        svc.refresh()
        assert len(notifier.pushed) == 1

    def test_new_reset_window_notifies_again(self, ledger: Path) -> None:
        notifier = FakeNotifier()
        svc = service_for(
            notifier,
            [
                [report(limit("a", 0.95, resets=RESET))],
                [report(limit("a", 0.95, resets=RESET + 18_000_000))],
            ],
            ledger,
        )
        svc.refresh()
        svc.refresh()
        assert len(notifier.pushed) == 2

    def test_refused_note_is_retried_next_poll(self, ledger: Path) -> None:
        notifier = FakeNotifier(accept=False)
        payload = [report(limit("a", 0.95))]
        svc = service_for(notifier, [payload, payload, payload], ledger)
        svc.refresh()
        assert not ledger.exists()
        notifier.accept = True
        svc.refresh()
        svc.refresh()
        assert len(notifier.pushed) == 2

    def test_notifier_exception_does_not_fail_the_fetch_or_record_the_note(self, ledger: Path) -> None:
        class Boom:
            def push(self, title: str, body: str) -> bool:
                raise RuntimeError("bus down")

        svc = service_for(Boom(), [[report(limit("a", 0.95))]], ledger)
        snap = svc.get(refresh=True)
        assert snap["ok"] is True and len(snap["alerts"]) == 1
        assert not ledger.exists()

    def test_missing_notifier_still_serves_data(self, ledger: Path) -> None:
        svc = service_for(None, [[report(limit("a", 0.95))]], ledger)
        assert svc.get(refresh=True)["ok"] is True
        assert not ledger.exists()

    def test_stale_ledger_entries_are_pruned_and_corrupt_ledger_is_ignored(self, ledger: Path) -> None:
        ledger.write_text(json.dumps({"old|x|1|90": 1.0}))
        notifier = FakeNotifier()
        service_for(notifier, [[report(limit("a", 0.95))]], ledger).refresh()
        stored = json.loads(ledger.read_text())
        assert "old|x|1|90" not in stored and len(stored) == 1

        ledger.write_text("{not json")
        service_for(notifier, [[report(limit("b", 0.95))]], ledger).refresh()
        assert len(notifier.pushed) == 2


class TestService:
    def test_failed_fetch_keeps_last_good_data_and_reports_error(self, ledger: Path) -> None:
        good = [report(limit("a", 0.1))]
        svc = service_for(FakeNotifier(), [good, RuntimeError("boom")], ledger)
        first = svc.get(refresh=True)
        assert first["ok"] is True and first["error"] is None and first["reports"] == good
        second = svc.get(refresh=True)
        assert second["ok"] is False and second["error"] == "boom"
        assert second["reports"] == good and second["fetchedAt"] == first["fetchedAt"]

    def test_concurrent_refreshes_share_one_fetch_and_cache_is_served(self, ledger: Path) -> None:
        calls = 0
        gate = threading.Event()
        entered = threading.Event()

        def fetcher() -> dict[str, Any]:
            nonlocal calls
            calls += 1
            entered.set()
            gate.wait(5)
            return {"reports": []}

        svc = omp_usage.OmpUsageService(FakeNotifier(), fetcher=fetcher, ledger_path=ledger)
        threads = [threading.Thread(target=svc.get, kwargs={"refresh": True}) for _ in range(3)]
        threads[0].start()
        assert entered.wait(5)
        for t in threads[1:]:
            t.start()
        time.sleep(0.05)
        gate.set()
        for t in threads:
            t.join(5)
        assert calls == 1
        svc.get()
        assert calls == 1

    def test_first_get_fetches_and_later_gets_use_the_cache(self, ledger: Path) -> None:
        svc = service_for(FakeNotifier(), [[report(limit("a", 0.1))]], ledger)
        assert svc.get()["ok"] is True
        assert svc.get()["ok"] is True

    def test_metadata_is_slimmed_to_the_fields_the_ui_reads(self, ledger: Path) -> None:
        raw = {"provider": "zai", "limits": [], "metadata": {"planType": "pro", "email": "e", "modelUsage": {"big": "x" * 1000}}}
        snap = service_for(FakeNotifier(), [[raw]], ledger).get(refresh=True)
        assert snap["reports"][0]["metadata"] == {"planType": "pro", "email": "e"}

    def test_poller_refreshes_repeatedly_until_stopped(self, ledger: Path) -> None:
        calls = threading.Semaphore(0)

        def fetcher() -> dict[str, Any]:
            calls.release()
            return {"reports": []}

        svc = omp_usage.OmpUsageService(FakeNotifier(), fetcher=fetcher, ledger_path=ledger)
        stop = omp_usage.start_poller(svc, interval=0.01)
        assert calls.acquire(timeout=5) and calls.acquire(timeout=5) and calls.acquire(timeout=5)
        stop.set()


class TestChipStatus:
    def test_ok_below_75_warn_from_75_and_exhausted_counts(self) -> None:
        def status(*limits: dict[str, Any]) -> dict[str, str]:
            return omp_usage.chip_status({"reports": [report(*limits)], "error": None})

        assert status(limit("a", 0.74))["state"] == "ok"
        assert status(limit("a", 0.75))["state"] == "warn"
        assert status(limit("a", 0.2), limit("b", 0.1, status="exhausted"))["state"] == "warn"
        assert status(limit("a", 0.46))["tooltip"] == "OMP usage: 46% used on the busiest limit"

    def test_no_data_is_none_and_carries_the_error(self) -> None:
        assert omp_usage.chip_status({"reports": [], "error": None}) == {"state": "none", "tooltip": "OMP usage"}
        assert "omp timed out" in omp_usage.chip_status({"reports": [], "error": "omp timed out"})["tooltip"]


class TestRunOmpUsage:
    @staticmethod
    def fake_omp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, script: str) -> None:
        exe = tmp_path / "omp"
        exe.write_text("#!/bin/sh\n" + script)
        exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
        monkeypatch.setenv("OMP_BIN", str(exe))

    def test_parses_reports_from_the_cli(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.fake_omp(tmp_path, monkeypatch, '[ "$1 $2" = "usage --json" ] && echo \'{"reports": [{"provider": "p"}]}\'\n')
        assert omp_usage.run_omp_usage() == {"reports": [{"provider": "p"}]}

    @pytest.mark.parametrize(
        ("script", "message"),
        [
            ("echo oops >&2; exit 3", "exited 3: oops"),
            ("echo not-json", "invalid JSON"),
            ("echo '{\"nope\": 1}'", "no 'reports' array"),
        ],
    )
    def test_failures_raise_with_a_readable_reason(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, script: str, message: str
    ) -> None:
        self.fake_omp(tmp_path, monkeypatch, script)
        with pytest.raises(RuntimeError, match=message):
            omp_usage.run_omp_usage()

    def test_timeout_is_bounded(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.fake_omp(tmp_path, monkeypatch, "sleep 5")
        monkeypatch.setattr(omp_usage, "FETCH_TIMEOUT_SECS", 0.2)
        with pytest.raises(RuntimeError, match="timed out"):
            omp_usage.run_omp_usage()

    def test_missing_binary_is_reported(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.delenv("OMP_BIN", raising=False)
        monkeypatch.setenv("PATH", str(tmp_path))
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        with pytest.raises(RuntimeError, match="omp binary not found"):
            omp_usage.run_omp_usage()
