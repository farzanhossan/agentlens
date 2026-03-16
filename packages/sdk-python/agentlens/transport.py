"""HTTP transport — sends span batches to the AgentLens ingest endpoint.

Features:
- gzip-compresses the JSON payload using :mod:`gzip`.
- Retries up to 3 times with exponential backoff + full jitter on 429 / 5xx.
- Exposes both a synchronous :meth:`Transport.send` (used by the background
  buffer thread) and an async :meth:`Transport.send_async` (used by
  ``AgentLens.flush()`` when called from async code).
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import random
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_BASE_DELAY_S = 0.25


class Transport:
    """Sends compressed span batches to ``{endpoint}/v1/spans``.

    Args:
        endpoint: Base URL of the AgentLens ingest endpoint.
        api_key: Raw API key sent as ``X-API-Key`` header.
    """

    def __init__(self, endpoint: str, api_key: str) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key

    # ── Sync (used by background buffer thread) ─────────────────────────────

    def send(self, spans: list[dict[str, Any]]) -> None:
        """Send *spans* synchronously.  Raises on final failure."""
        body = self._compress(spans)
        headers = self._headers()
        url = f"{self._endpoint}/v1/spans"

        last_exc: Exception = RuntimeError("No attempt made")
        for attempt in range(_MAX_RETRIES + 1):
            try:
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(url, content=body, headers=headers)
                if resp.is_success:
                    return
                if resp.status_code in _RETRYABLE_STATUS and attempt < _MAX_RETRIES:
                    delay = self._backoff(attempt, resp.headers.get("Retry-After"))
                    time.sleep(delay)
                    continue
                resp.raise_for_status()
            except httpx.TransportError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    time.sleep(self._backoff(attempt))
                    continue
        raise last_exc

    # ── Async (used by AgentLens.flush() in async contexts) ─────────────────

    async def send_async(self, spans: list[dict[str, Any]]) -> None:
        """Send *spans* asynchronously.  Raises on final failure."""
        body = self._compress(spans)
        headers = self._headers()
        url = f"{self._endpoint}/v1/spans"

        last_exc: Exception = RuntimeError("No attempt made")
        for attempt in range(_MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(url, content=body, headers=headers)
                if resp.is_success:
                    return
                if resp.status_code in _RETRYABLE_STATUS and attempt < _MAX_RETRIES:
                    delay = self._backoff(attempt, resp.headers.get("Retry-After"))
                    await asyncio.sleep(delay)
                    continue
                resp.raise_for_status()
            except httpx.TransportError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(self._backoff(attempt))
                    continue
        raise last_exc

    # ── Private helpers ──────────────────────────────────────────────────────

    def _compress(self, spans: list[dict[str, Any]]) -> bytes:
        payload = json.dumps({"spans": spans}).encode()
        return gzip.compress(payload)

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            "X-API-Key": self._api_key,
        }

    def _backoff(self, attempt: int, retry_after: str | None = None) -> float:
        if retry_after is not None:
            try:
                return float(retry_after)
            except ValueError:
                pass
        cap = _BASE_DELAY_S * (2**attempt)
        return random.random() * cap  # full jitter
