"""Monkey-patches ``httpx.Client`` and ``httpx.AsyncClient`` to auto-trace
outbound LLM calls.

Strategy: wrap ``Client.send`` / ``AsyncClient.send`` so we observe every
request *after* httpx has prepared it (including any user-provided event
hooks). For streamed responses we read the full body via ``response.read()``
inside our wrapper — httpx caches the bytes, so subsequent ``.text`` /
``.json()`` / iteration by the user still works.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from .emitter import emit_error, emit_span
from .registry import LLMEndpoint, match_llm
from .streaming import synthesize_streaming_response

_PATCHED_FLAG = "_agentlens_patched"


def patch_httpx() -> None:
    """Idempotently patch httpx's sync + async Client.send."""
    if getattr(httpx.Client.send, _PATCHED_FLAG, False):
        return

    original_sync = httpx.Client.send
    original_async = httpx.AsyncClient.send

    def patched_send(self: httpx.Client, request: httpx.Request, **kwargs: Any) -> httpx.Response:
        llm = match_llm(str(request.url))
        if llm is None:
            return original_sync(self, request, **kwargs)

        started = time.monotonic()
        try:
            response = original_sync(self, request, **kwargs)
        except Exception as exc:  # noqa: BLE001
            emit_error(llm, _read_request_body(request), str(exc), _ms_since(started))
            raise
        _capture(llm, request, response, _ms_since(started))
        return response

    async def patched_send_async(
        self: httpx.AsyncClient, request: httpx.Request, **kwargs: Any
    ) -> httpx.Response:
        llm = match_llm(str(request.url))
        if llm is None:
            return await original_async(self, request, **kwargs)

        started = time.monotonic()
        try:
            response = await original_async(self, request, **kwargs)
        except Exception as exc:  # noqa: BLE001
            emit_error(llm, _read_request_body(request), str(exc), _ms_since(started))
            raise
        # AsyncClient.send returns the response with body already read for non-stream.
        # For stream=True, the body is unread; we'll read it below.
        _capture_async(llm, request, response, _ms_since(started))
        return response

    setattr(patched_send, _PATCHED_FLAG, True)
    setattr(patched_send_async, _PATCHED_FLAG, True)
    # setattr (not `Class.send = ...`) so mypy doesn't flag method reassignment.
    setattr(httpx.Client, "send", patched_send)
    setattr(httpx.AsyncClient, "send", patched_send_async)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ms_since(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _read_request_body(request: httpx.Request) -> dict[str, Any] | None:
    raw = request.content
    if not raw:
        return None
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _is_stream(request_body: dict[str, Any] | None, response: httpx.Response) -> bool:
    if request_body and request_body.get("stream") is True:
        return True
    ctype = response.headers.get("content-type", "")
    return "text/event-stream" in ctype or "stream" in ctype


def _capture(
    llm: LLMEndpoint, request: httpx.Request, response: httpx.Response, latency_ms: int
) -> None:
    request_body = _read_request_body(request)
    is_stream = _is_stream(request_body, response)
    if is_stream:
        try:
            raw = response.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return
        synthesized = synthesize_streaming_response(raw, llm.parser, request_body)
        emit_span(llm, request_body, synthesized, latency_ms, response.status_code, True)
        return
    response_body = _safe_json(response)
    if response_body is None:
        return
    emit_span(llm, request_body, response_body, latency_ms, response.status_code, False)


def _capture_async(
    llm: LLMEndpoint, request: httpx.Request, response: httpx.Response, latency_ms: int
) -> None:
    """Sync wrapper around async-context capture — httpx caches the body."""
    request_body = _read_request_body(request)
    is_stream = _is_stream(request_body, response)
    if is_stream:
        try:
            raw = response.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return
        synthesized = synthesize_streaming_response(raw, llm.parser, request_body)
        emit_span(llm, request_body, synthesized, latency_ms, response.status_code, True)
        return
    response_body = _safe_json(response)
    if response_body is None:
        return
    emit_span(llm, request_body, response_body, latency_ms, response.status_code, False)


def _safe_json(response: httpx.Response) -> dict[str, Any] | None:
    try:
        parsed = response.json()
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None
