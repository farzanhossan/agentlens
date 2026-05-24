"""Builds an outbound span dict from a parsed LLM call and pushes it through
``AgentLens._push_span``. Stamps trace-context (``traceId``, ``parentSpanId``)
from the ambient contextvars so spans nested inside ``AgentLens.trace(...)``
are linked to their parent automatically.

The emitted shape matches the ingest contract exactly (same as JS sdk-universal
0.2.2): ``spanId``, ``traceId``, ``parentSpanId?``, ``projectId``, ``name``,
``status`` enum, ``latencyMs``, ``input``/``output``, ``startedAt``/``endedAt``,
``metadata``.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
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

    AgentLens._push_span(_to_span_dict(parsed, request_body, latency_ms, status, llm))


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
    span_dict = _make_skeleton(latency_ms, status=0, name=f"{llm.provider}.error")
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


def _to_span_dict(
    parsed: ParsedSpan,
    request_body: dict[str, Any] | None,
    latency_ms: int,
    status: int,
    llm: LLMEndpoint,
) -> dict[str, Any]:
    span = _make_skeleton(latency_ms, status, name=_span_name_for(request_body, llm))
    span.update(
        {
            "model": parsed.model,
            "provider": parsed.provider,
            "input": parsed.input_text,
            "output": parsed.output_text,
            "inputTokens": parsed.input_tokens,
            "outputTokens": parsed.output_tokens,
            "totalTokens": parsed.total_tokens,
            "costUsd": parsed.cost_usd,
            "isStream": parsed.is_stream,
        }
    )
    if parsed.is_stream:
        span["metadata"]["stream"] = True
    return span


def _make_skeleton(latency_ms: int, status: int, name: str) -> dict[str, Any]:
    """Build the common span fields. `projectId` pulled from AgentLens singleton."""
    from ..agentlens import AgentLens

    span_id = str(uuid.uuid4())
    trace_id = get_current_trace_id() or str(uuid.uuid4())
    parent_span_id = get_current_span_id()
    project_id = AgentLens._get_project_id()
    ended_at = datetime.now(timezone.utc)
    started_at = ended_at - timedelta(milliseconds=latency_ms)
    skeleton: dict[str, Any] = {
        "spanId": span_id,
        "traceId": trace_id,
        "name": name,
        "latencyMs": latency_ms,
        "status": "success" if 200 <= status < 400 else "error",
        "metadata": {"httpStatus": status},
        "startedAt": started_at.isoformat(),
        "endedAt": ended_at.isoformat(),
    }
    if project_id is not None:
        skeleton["projectId"] = project_id
    if parent_span_id is not None:
        skeleton["parentSpanId"] = parent_span_id
    return skeleton


def _span_name_for(request_body: dict[str, Any] | None, llm: LLMEndpoint) -> str:
    """Derive a human-friendly span name from the request shape.

    Mirrors the JS sdk-universal naming so spans from both SDKs look the same
    in the dashboard.
    """
    if request_body is None:
        return f"{llm.provider}.call"
    if isinstance(request_body.get("messages"), list):
        return f"{llm.provider}.chat"
    if isinstance(request_body.get("prompt"), str):
        return f"{llm.provider}.completion"
    if request_body.get("input") is not None or request_body.get("contents") is not None:
        return f"{llm.provider}.embedding"
    return f"{llm.provider}.call"


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
