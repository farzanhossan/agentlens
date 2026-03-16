"""Span — mutable object passed to trace callbacks and context managers."""

from __future__ import annotations

import datetime
from typing import Any, Optional, Union

from .models import SpanData


class Span:
    """A mutable span annotated by the caller during an LLM or agent step.

    Mirrors the TypeScript ``Span`` class API surface.  Fluent setters
    return ``self`` so calls can be chained::

        span.set_model("gpt-4o", "openai").set_tokens(100, 50)

    The span is closed automatically by :class:`~agentlens.tracer.Tracer`
    (or the context manager returned by :meth:`AgentLens.trace`) once the
    body finishes or raises.
    """

    def __init__(
        self,
        span_id: str,
        trace_id: str,
        name: str,
        project_id: str,
        parent_span_id: Optional[str] = None,
    ) -> None:
        self._span_id = span_id
        self._trace_id = trace_id
        self._name = name
        self._project_id = project_id
        self._parent_span_id = parent_span_id
        self._started_at: datetime.datetime = datetime.datetime.now(datetime.timezone.utc)

        self._model: Optional[str] = None
        self._provider: Optional[str] = None
        self._input: Optional[str] = None
        self._output: Optional[str] = None
        self._input_tokens: Optional[int] = None
        self._output_tokens: Optional[int] = None
        self._cost_usd: Optional[float] = None
        self._latency_ms: Optional[int] = None
        self._status: str = "success"
        self._error_message: Optional[str] = None
        self._metadata: dict[str, Any] = {}
        self._ended_at: Optional[datetime.datetime] = None

    # ── Fluent setters ──────────────────────────────────────────────────────────

    def set_input(self, data: str) -> "Span":
        """Set the raw LLM prompt or tool input (stored in Elasticsearch only)."""
        self._input = data
        return self

    def set_output(self, data: str) -> "Span":
        """Set the raw LLM completion or tool output (stored in Elasticsearch only)."""
        self._output = data
        return self

    def set_metadata(self, key: str, value: Any) -> "Span":
        """Attach a free-form metadata key-value pair to this span."""
        self._metadata[key] = value
        return self

    def set_model(self, model: str, provider: Optional[str] = None) -> "Span":
        """Set the model name and optional provider (e.g. ``'gpt-4o'``, ``'openai'``)."""
        self._model = model
        if provider is not None:
            self._provider = provider
        return self

    def set_tokens(
        self,
        input_tokens: int,
        output_tokens: int,
        cost_usd: Optional[float] = None,
    ) -> "Span":
        """Set token counts and optionally the USD cost."""
        self._input_tokens = input_tokens
        self._output_tokens = output_tokens
        if cost_usd is not None:
            self._cost_usd = cost_usd
        return self

    def set_error(self, error: Union[Exception, str]) -> "Span":
        """Record an error on this span; automatically sets status to ``'error'``."""
        self._status = "error"
        self._error_message = str(error) if isinstance(error, Exception) else error
        return self

    # ── Lifecycle ───────────────────────────────────────────────────────────────

    def end(self) -> None:
        """Close the span: record ``ended_at`` and compute ``latency_ms``.

        Idempotent — subsequent calls are no-ops.
        """
        if self._ended_at is not None:
            return
        self._ended_at = datetime.datetime.now(datetime.timezone.utc)
        delta = self._ended_at - self._started_at
        self._latency_ms = int(delta.total_seconds() * 1000)

    # ── Serialisation ───────────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """Serialise to the camelCase wire format expected by the ingest endpoint.

        :meth:`end` should be called before :meth:`to_dict`.
        """
        return SpanData(
            span_id=self._span_id,
            trace_id=self._trace_id,
            project_id=self._project_id,
            name=self._name,
            status=self._status,  # type: ignore[arg-type]
            metadata=dict(self._metadata),
            started_at=self._started_at.isoformat(),
            parent_span_id=self._parent_span_id,
            model=self._model,
            provider=self._provider,
            input=self._input,
            output=self._output,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
            cost_usd=self._cost_usd,
            latency_ms=self._latency_ms,
            error_message=self._error_message,
            ended_at=self._ended_at.isoformat() if self._ended_at else None,
        ).to_wire()
