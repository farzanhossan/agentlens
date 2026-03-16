"""AgentLens singleton — primary entry point for the Python SDK."""

from __future__ import annotations

import functools
from contextlib import contextmanager
from typing import Any, Callable, Generator, Optional, TypeVar

from .buffer import Buffer
from .config import AgentLensConfig
from .redactor import maybe_redact
from .span import Span
from .tracer import Tracer
from .transport import Transport

F = TypeVar("F", bound=Callable[..., Any])


class AgentLens:
    """Singleton SDK client.

    Initialise once at application startup::

        from agentlens import AgentLens

        AgentLens.init(api_key="proj_xxx", project_id="<uuid>")

    Then instrument anywhere::

        # Context-manager style
        with AgentLens.trace("classify") as span:
            result = call_llm(prompt)
            span.set_output(result)

        # Decorator style
        @AgentLens.traced("embed-docs")
        def embed(text: str) -> list[float]:
            ...
    """

    _instance: Optional["AgentLens"] = None

    def __init__(self, config: AgentLensConfig) -> None:
        self._project_id = config.project_id
        self._redact_pii = config.redact_pii

        transport = Transport(config.endpoint, config.api_key)
        self._buffer = Buffer(
            transport,
            flush_interval_ms=config.flush_interval_ms,
            max_batch_size=config.max_batch_size,
        )

        def _sink(span_data: dict[str, Any]) -> None:
            sanitised = dict(span_data)
            sanitised["input"] = maybe_redact(
                span_data.get("input"), self._redact_pii
            )
            sanitised["output"] = maybe_redact(
                span_data.get("output"), self._redact_pii
            )
            # Remove None values introduced by maybe_redact
            sanitised = {k: v for k, v in sanitised.items() if v is not None or k in ("input", "output")}
            self._buffer.push(sanitised)

        self._tracer = Tracer(config.project_id, _sink)
        self._buffer.start()

    # ── Static public API ───────────────────────────────────────────────────

    @classmethod
    def init(
        cls,
        api_key: str,
        project_id: str,
        *,
        endpoint: str = "https://ingest.agentlens.dev",
        flush_interval_ms: int = 500,
        max_batch_size: int = 100,
        redact_pii: bool = False,
    ) -> None:
        """Initialise the AgentLens SDK.

        Must be called once before any :meth:`trace` call.  Subsequent
        calls are no-ops.

        Args:
            api_key: Raw API key (``proj_xxx.hmac``).
            project_id: AgentLens project UUID.
            endpoint: Ingest endpoint base URL.
            flush_interval_ms: Periodic flush interval in milliseconds.
            max_batch_size: Max spans per flush batch.
            redact_pii: Redact PII from ``input``/``output`` before buffering.
        """
        if cls._instance is not None:
            return
        config = AgentLensConfig(
            api_key=api_key,
            project_id=project_id,
            endpoint=endpoint,
            flush_interval_ms=flush_interval_ms,
            max_batch_size=max_batch_size,
            redact_pii=redact_pii,
        )
        cls._instance = cls(config)

    @classmethod
    @contextmanager
    def trace(cls, name: str) -> Generator[Span, None, None]:
        """Open a span named *name* and yield it.

        Nested calls automatically become child spans.  The span is always
        closed and flushed, even if the body raises.

        Example::

            with AgentLens.trace("call-llm") as span:
                response = openai.chat.completions.create(...)
                span.set_output(response.choices[0].message.content)
        """
        with cls._require_instance()._tracer.trace(name) as span:
            yield span

    @classmethod
    def traced(cls, name: str) -> Callable[[F], F]:
        """Decorator factory that wraps a function in a span named *name*.

        Works with both sync and async functions::

            @AgentLens.traced("classify-intent")
            def classify(message: str) -> str:
                ...

            @AgentLens.traced("embed-async")
            async def embed(text: str) -> list[float]:
                ...
        """
        import asyncio

        def decorator(fn: F) -> F:
            if asyncio.iscoroutinefunction(fn):

                @functools.wraps(fn)
                async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                    with cls.trace(name) as span:
                        span.set_metadata("function", fn.__qualname__)
                        return await fn(*args, **kwargs)

                return async_wrapper  # type: ignore[return-value]

            @functools.wraps(fn)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                with cls.trace(name) as span:
                    span.set_metadata("function", fn.__qualname__)
                    return fn(*args, **kwargs)

            return sync_wrapper  # type: ignore[return-value]

        return decorator

    @classmethod
    def flush(cls) -> None:
        """Flush all buffered spans to the transport immediately.

        Call this during graceful shutdown before the process exits.
        """
        cls._require_instance()._buffer.flush()

    @classmethod
    def shutdown(cls) -> None:
        """Stop the periodic timer and perform a final flush.

        After :meth:`shutdown` the singleton is destroyed; a subsequent
        :meth:`init` call will re-initialise it.
        """
        sdk = cls._require_instance()
        sdk._buffer.shutdown()
        cls._instance = None

    # ── Internal helpers for auto-patchers ──────────────────────────────────

    @classmethod
    def _is_initialized(cls) -> bool:
        """Return ``True`` if :meth:`init` has been called."""
        return cls._instance is not None

    @classmethod
    def _get_project_id(cls) -> Optional[str]:
        """Return the configured project ID, or ``None`` if uninitialised."""
        return cls._instance._project_id if cls._instance else None

    @classmethod
    def _push_span(cls, span_data: dict[str, Any]) -> None:
        """Push a finished span dict into the buffer (with PII redaction).

        No-op if the SDK is not initialised — safe to call unconditionally
        from auto-patchers.
        """
        sdk = cls._instance
        if sdk is None:
            return
        sanitised = dict(span_data)
        sanitised["input"] = maybe_redact(span_data.get("input"), sdk._redact_pii)
        sanitised["output"] = maybe_redact(span_data.get("output"), sdk._redact_pii)
        sdk._buffer.push(sanitised)

    # ── Private ──────────────────────────────────────────────────────────────

    @classmethod
    def _require_instance(cls) -> "AgentLens":
        if cls._instance is None:
            raise RuntimeError(
                "AgentLens is not initialised. "
                "Call AgentLens.init(api_key=..., project_id=...) first."
            )
        return cls._instance
