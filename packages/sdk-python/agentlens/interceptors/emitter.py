"""Builds an outbound span dict from a parsed LLM call and pushes it through
``AgentLens._push_span``. Stamps trace-context (``traceId``, ``parentSpanId``)
from the ambient contextvars so spans nested inside ``AgentLens.trace(...)``
are linked to their parent automatically.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from ..context import get_current_span_id, get_current_trace_id
from .parsers import ParsedSpan, parse_span
from .registry import LLMEndpoint


def emit_span(
    llm: LLMEndpoint,
    request_body: dict[str, Any] | None,
    response_body: dict[str, Any] | None,
    latency_ms: int,
    status: int,
    is_stream: bool,
) -> None:
    """Parse and emit a span. Silently no-ops if AgentLens isn't initialised."""
    from ..agentlens import AgentLens

    if not AgentLens._is_initialized():
        return
    try:
        parsed = parse_span(llm.parser, request_body, response_body, is_stream)
    except Exception:  # noqa: BLE001 — never crash the user's request
        return

    AgentLens._push_span(_to_span_dict(parsed, latency_ms, status))


def emit_error(
    llm: LLMEndpoint,
    request_body: dict[str, Any] | None,
    error: str,
    latency_ms: int,
) -> None:
    from ..agentlens import AgentLens

    if not AgentLens._is_initialized():
        return
    text = _stringify(request_body)
    span_dict = _make_skeleton(latency_ms, status=0)
    span_dict.update(
        {
            "model": "unknown",
            "provider": llm.provider,
            "input": text,
            "errorMessage": error,
            "status": "error",
        }
    )
    AgentLens._push_span(span_dict)


def _to_span_dict(parsed: ParsedSpan, latency_ms: int, status: int) -> dict[str, Any]:
    span = _make_skeleton(latency_ms, status)
    span.update(
        {
            "model": parsed.model,
            "provider": parsed.provider,
            "input": parsed.input_text,
            "output": parsed.output_text,
            "inputTokens": parsed.input_tokens,
            "outputTokens": parsed.output_tokens,
            "costUsd": parsed.cost_usd,
        }
    )
    if parsed.is_stream:
        span["metadata"]["stream"] = True
    return span


def _make_skeleton(latency_ms: int, status: int) -> dict[str, Any]:
    span_id = str(uuid.uuid4())
    trace_id = get_current_trace_id() or str(uuid.uuid4())
    parent_span_id = get_current_span_id()
    now = datetime.now(timezone.utc).isoformat()
    skeleton: dict[str, Any] = {
        "spanId": span_id,
        "traceId": trace_id,
        "name": "llm.call",
        "latencyMs": latency_ms,
        "status": "success" if 200 <= status < 400 else "error",
        "metadata": {"httpStatus": status},
        "startedAt": now,
        "endedAt": now,
    }
    if parent_span_id is not None:
        skeleton["parentSpanId"] = parent_span_id
    return skeleton


def _stringify(obj: Any) -> str:
    if obj is None:
        return ""
    if isinstance(obj, (bytes, bytearray)):
        try:
            return obj.decode("utf-8")
        except UnicodeDecodeError:
            return ""
    if isinstance(obj, str):
        return obj
    try:
        return json.dumps(obj)
    except (TypeError, ValueError):
        return ""
