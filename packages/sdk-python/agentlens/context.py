"""Ambient tracing context via :mod:`contextvars`.

Each :func:`contextvars.ContextVar` is automatically inherited by child
tasks (``asyncio.create_task``) and threads spawned via
``concurrent.futures.ThreadPoolExecutor`` when the context is copied.
Nesting is handled by saving and restoring tokens so that the parent span
is reinstated when a child span exits.
"""

from __future__ import annotations

from contextvars import ContextVar

_current_trace_id: ContextVar[str | None] = ContextVar(
    "agentlens_trace_id", default=None
)
_current_span_id: ContextVar[str | None] = ContextVar(
    "agentlens_span_id", default=None
)


def get_current_trace_id() -> str | None:
    """Return the trace ID for the current execution context, or ``None``."""
    return _current_trace_id.get()


def get_current_span_id() -> str | None:
    """Return the span ID of the innermost active span, or ``None``."""
    return _current_span_id.get()
