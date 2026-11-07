from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from typing import Any

import gateway_notify
import omp_usage
import pytest

ORIGIN = "http://127.0.0.1:5476"
APP_KEY = "s3cret"
PROOF = hmac.new(APP_KEY.encode(), ORIGIN.encode(), hashlib.sha256).hexdigest()


class FakeGateway:
    def __init__(self, *responses: tuple[int, dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict[str, str], Any]] = []

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, bytes]:
        self.calls.append((method, url, headers, json.loads(body) if body else None))
        status, payload = self.responses.pop(0) if self.responses else (200, {})
        return status, json.dumps(payload).encode()


def notifier(gateway: FakeGateway, **over: Any) -> gateway_notify.GatewayNotifier:
    args: dict[str, Any] = dict(app_name="omp-usage", origin=ORIGIN, secret=APP_KEY, origin_proof=PROOF, transport=gateway)
    args.update(over)
    return gateway_notify.GatewayNotifier(**args)


class TestPush:
    def test_exchanges_the_secret_for_a_token_then_pushes_on_the_declared_channel(self) -> None:
        gw = FakeGateway((200, {"token": "tok"}), (200, {"ts": "x"}))
        assert notifier(gw).push("Claude 5 Hour at 92% — a@b", "Provider: anthropic. Resets soon.") is True
        exchange, push = gw.calls
        assert exchange[:2] == ("POST", f"{ORIGIN}/api/apps/omp-usage/token")
        assert exchange[2]["X-App-Secret"] == APP_KEY
        assert push[:2] == ("POST", f"{ORIGIN}/api/notifications/push")
        assert push[2]["Cookie"] == "mc_token_5476=tok"
        assert push[3] == {
            "channel": "usage-alerts",
            "title": "Claude 5 Hour at 92% — a@b",
            "body": "Provider: anthropic. Resets soon.",
            "group_key": "omp-usage",
            "url": "/apps/omp-usage",
        }

    def test_token_is_reused_and_refreshed_after_a_401(self) -> None:
        gw = FakeGateway((200, {"token": "t1"}), (200, {}), (401, {}), (200, {"token": "t2"}), (200, {}))
        n = notifier(gw)
        assert n.push("a", "b") and n.push("c", "d")
        assert [c[1].rsplit("/", 1)[-1] for c in gw.calls] == ["token", "push", "push", "token", "push"]
        assert gw.calls[-1][2]["Cookie"] == "mc_token_5476=t2"

    @pytest.mark.parametrize("refusal", [400, 429, 500])
    def test_a_refused_push_reports_false_so_the_alert_is_retried(self, refusal: int) -> None:
        gw = FakeGateway((200, {"token": "tok"}), (refusal, {"error": "nope"}))
        assert notifier(gw).push("a", "b") is False

    def test_failed_token_exchange_reports_false(self) -> None:
        gw = FakeGateway((403, {}))
        assert notifier(gw).push("a", "b") is False
        assert len(gw.calls) == 1

    def test_transport_error_reports_false(self) -> None:
        def broken(*_: Any) -> tuple[int, bytes]:
            raise ConnectionRefusedError("gateway down")

        assert notifier(FakeGateway(), transport=broken).push("a", "b") is False


class TestDormant:
    @pytest.mark.parametrize(
        ("over", "reason"),
        [
            ({"origin": ""}, "KIROCREW_GATEWAY_ORIGIN"),
            ({"secret": ""}, "KIROCREW_PROXY_SECRET"),
            ({"origin_proof": "0" * 64}, "does not verify"),
        ],
    )
    def test_without_a_trusted_origin_nothing_is_sent(self, over: dict[str, str], reason: str) -> None:
        gw = FakeGateway()
        n = notifier(gw, **over)
        assert reason in n.dormant_reason
        assert n.push("a", "b") is False
        assert gw.calls == []

    def test_from_env_reads_the_injected_variables(self) -> None:
        n = gateway_notify.GatewayNotifier.from_env(
            {
                "KIROCREW_APP_NAME": "omp-usage",
                "KIROCREW_GATEWAY_ORIGIN": ORIGIN,
                "KIROCREW_PROXY_SECRET": APP_KEY,
                "KIROCREW_GATEWAY_ORIGIN_PROOF": PROOF,
            }
        )
        assert n.dormant_reason == ""


class TestEndToEnd:
    def test_a_90_percent_limit_reaches_the_gateway_once_per_window(self, tmp_path: Path) -> None:
        gw = FakeGateway((200, {"token": "tok"}))
        payload = {
            "reports": [
                {
                    "provider": "anthropic",
                    "metadata": {"email": "a@b"},
                    "limits": [
                        {"id": "x", "label": "Claude 5 Hour", "window": {"resetsAt": 1_794_000_000_000}, "amount": {"usedFraction": 0.95}}
                    ],
                }
            ]
        }
        svc = omp_usage.OmpUsageService(notifier(gw), fetcher=lambda: payload, ledger_path=tmp_path / "l.json")
        svc.refresh()
        svc.refresh()
        pushes = [c for c in gw.calls if c[1].endswith("/api/notifications/push")]
        assert len(pushes) == 1
        assert pushes[0][3]["title"] == "Claude 5 Hour at 95% — a@b"


def test_channel_and_page_url_match_the_manifest() -> None:
    manifest = json.loads((Path(__file__).resolve().parent.parent / "app.json").read_text())
    assert gateway_notify.CHANNEL_ID in [c["id"] for c in manifest["notifications"]["channels"]]
    assert gateway_notify.PAGE_URL == manifest["ui"]["pages"][0]["route"]
