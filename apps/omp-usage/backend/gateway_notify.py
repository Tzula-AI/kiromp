"""Push notes to the Kiro Crew bell through ``POST /api/notifications/push``.

An ``entryPoint`` backend is a separate loopback process, so it reaches the gateway the
documented way: the injected ``KIROCREW_GATEWAY_ORIGIN`` (trusted only when its
``KIROCREW_GATEWAY_ORIGIN_PROOF`` verifies against the app secret), an app token exchanged
for the secret, and a channel the manifest declares. With no origin or secret the notifier is
dormant and ``push`` returns ``False``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable

logger = logging.getLogger(__name__)

CHANNEL_ID = "usage-alerts"
GROUP_KEY = "omp-usage"
PAGE_URL = "/apps/omp-usage"
_TIMEOUT_SECS = 10

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]


def urllib_transport(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECS) as resp:  # noqa: S310 -- loopback origin
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


class GatewayNotifier:
    def __init__(
        self,
        *,
        app_name: str,
        origin: str,
        secret: str,
        origin_proof: str,
        channel: str = CHANNEL_ID,
        group_key: str = GROUP_KEY,
        url: str = PAGE_URL,
        transport: Transport = urllib_transport,
    ) -> None:
        self._app_name = app_name
        self._origin = origin.rstrip("/")
        self._secret = secret
        self._origin_proof = origin_proof
        self._channel = channel
        self._group_key = group_key
        self._url = url
        self._transport = transport
        self._token = ""
        self._lock = threading.Lock()
        self._dormant_reason = self._check_dormant()
        self._warned = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> GatewayNotifier:
        env = os.environ if env is None else env
        return cls(
            app_name=env.get("KIROCREW_APP_NAME", "omp-usage"),
            origin=env.get("KIROCREW_GATEWAY_ORIGIN", ""),
            secret=env.get("KIROCREW_PROXY_SECRET", ""),
            origin_proof=env.get("KIROCREW_GATEWAY_ORIGIN_PROOF", ""),
        )

    def _check_dormant(self) -> str:
        if not self._origin:
            return "no KIROCREW_GATEWAY_ORIGIN (gateway published no bound-port origin)"
        if not self._secret:
            return "no KIROCREW_PROXY_SECRET (no app secret to authenticate with)"
        expected = hmac.new(self._secret.encode(), self._origin.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, self._origin_proof):
            return "KIROCREW_GATEWAY_ORIGIN_PROOF does not verify, so the origin is not trusted"
        return ""

    @property
    def dormant_reason(self) -> str:
        return self._dormant_reason

    def _cookie(self) -> str:
        port = urllib.parse.urlparse(self._origin).port or 80
        return f"mc_token_{port}={self._token}"

    def _exchange_token(self) -> bool:
        url = f"{self._origin}/api/apps/{urllib.parse.quote(self._app_name, safe='')}/token"
        status, raw = self._transport("POST", url, {"X-App-Secret": self._secret, "Content-Type": "application/json"}, None)
        if status != 200:
            logger.warning("app token exchange refused: HTTP %s", status)
            return False
        try:
            token = json.loads(raw).get("token", "")
        except (ValueError, AttributeError):
            token = ""
        self._token = token if isinstance(token, str) else ""
        return bool(self._token)

    def _post_note(self, payload: bytes) -> int:
        headers = {"Content-Type": "application/json", "Cookie": self._cookie()}
        status, raw = self._transport("POST", f"{self._origin}/api/notifications/push", headers, payload)
        if status != 200:
            logger.warning("notification push refused: HTTP %s %s", status, raw[:200].decode("utf-8", "replace"))
        return status

    def push(self, title: str, body: str) -> bool:
        if self._dormant_reason:
            if not self._warned:
                self._warned = True
                logger.warning("notifications disabled: %s", self._dormant_reason)
            return False
        payload = json.dumps(
            {"channel": self._channel, "title": title, "body": body, "group_key": self._group_key, "url": self._url}
        ).encode()
        with self._lock:
            try:
                if not self._token and not self._exchange_token():
                    return False
                status = self._post_note(payload)
                if status in (401, 403):
                    self._token = ""
                    if not self._exchange_token():
                        return False
                    status = self._post_note(payload)
            except (OSError, urllib.error.URLError):
                logger.warning("notification push failed", exc_info=True)
                return False
        return status == 200
