"""Tracer — creates spans and manages context propagation via :mod:`contextvars`."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any, Callable, Generator, Optional

from .context import _current_span_id, _current_trace_id, get_current_span_id, get_current_trace_id
from .span import Span

SpanSink = Callable[[dict[str, Any]], None]


class Tracer:
    """Creates and manages spans for a single AgentLens project.

    The tracer uses :mod:`contextvars` to propagate the active trace/span
    implicitly through both sync and async call chains.  Nested
    :meth:`trace` calls automatically become child spans.

    Args:
        project_id: AgentLens project UUID attached to every span.
        sink: Callable invoked with the serialised span dict when a span
            closes.  Typically the buffer's :meth:`push` method (after
            PII redaction).
    """

    def __init__(self, project_id: str, sink: SpanSink) -> None:
        self._project_id = project_id
        self._sink = sink

    @contextmanager
    def trace(self, name: str) -> Generator[Span, None, None]:
        """Open a new span named *name* and yield it to the caller.

        * If called inside an existing :meth:`trace` context the new span
          is automatically a child of the current span.
        * If the body raises, the span is marked ``'error'`` and the
          exception is re-raised unchanged.
        * The span is **always** closed and forwarded to the sink regardless
          of whether the body succeeds or raises.

        Example::

            with tracer.trace("llm.call") as span:
                span.set_model("gpt-4o", "openai")
                result = call_openai(...)
                span.set_output(result.content)
        """
        span_id = str(uuid.uuid4())
        trace_id = get_current_trace_id() or str(uuid.uuid4())
        parent_span_id: Optional[str] = get_current_span_id()

        span = Span(span_id, trace_id, name, self._project_id, parent_span_id)

        # Push new context — tokens allow restoring the parent context on exit
        trace_token = _current_trace_id.set(trace_id)
        span_token = _current_span_id.set(span_id)
        try:
            yield span
        except Exception as exc:
            span.set_error(exc)
            raise
        finally:
            span.end()
            self._sink(span.to_dict())
            _current_span_id.reset(span_token)
            _current_trace_id.reset(trace_token)
