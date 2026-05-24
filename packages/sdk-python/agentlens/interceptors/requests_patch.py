"""Monkey-patches ``requests.Session.send`` to auto-trace LLM calls.

We hook ``send`` rather than ``request``/``get``/``post`` so we observe
fully-prepared requests including any user-installed Session adapters.
"""

from __future__ import annotations

import json
import time
from typing import Any

import requests

from .emitter import emit_error, emit_span
from .registry import LLMEndpoint, match_llm
from .streaming import synthesize_streaming_response

_PATCHED_FLAG = "_agentlens_patched"


def patch_requests() -> None:
    """Idempotently patch ``requests.Session.send``."""
    if getattr(requests.Session.send, _PATCHED_FLAG, False):
        return

    original_send = requests.Session.send

    def patched_send(
        self: requests.Session, request: requests.PreparedRequest, **kwargs: Any
    ) -> requests.Response:
        llm = match_llm(request.url or "")
        if llm is None:
            return original_send(self, request, **kwargs)

        started = time.monotonic()
        try:
            response = original_send(self, request, **kwargs)
        except Exception as exc:  # noqa: BLE001
            emit_error(llm, _read_request_body(request), str(exc), _ms_since(started))
            raise
        _capture(llm, request, response, _ms_since(started))
        return response

    setattr(patched_send, _PATCHED_FLAG, True)
    requests.Session.send = patched_send


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ms_since(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _read_request_body(request: requests.PreparedRequest) -> dict[str, Any] | None:
    body = request.body
    if body is None:
        return None
    if isinstance(body, bytes):
        try:
            body = body.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if not isinstance(body, str):
        return None
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _is_stream(request_body: dict[str, Any] | None, response: requests.Response) -> bool:
    if request_body and request_body.get("stream") is True:
        return True
    ctype = response.headers.get("content-type", "")
    return "text/event-stream" in ctype or "stream" in ctype


def _capture(
    llm: LLMEndpoint,
    request: requests.PreparedRequest,
    response: requests.Response,
    latency_ms: int,
) -> None:
    request_body = _read_request_body(request)
    is_stream = _is_stream(request_body, response)
    if is_stream:
        try:
            raw = response.text
        except Exception:  # noqa: BLE001
            return
        synthesized = synthesize_streaming_response(raw, llm.parser, request_body)
        emit_span(llm, request_body, synthesized, latency_ms, response.status_code, True)
        return
    try:
        response_body = response.json()
    except (json.JSONDecodeError, ValueError):
        return
    emit_span(llm, request_body, response_body, latency_ms, response.status_code, False)
