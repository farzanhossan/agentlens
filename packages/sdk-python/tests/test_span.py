"""Tests for span capture — lifecycle, serialisation, and context nesting."""

from __future__ import annotations

import time
import uuid
from unittest.mock import MagicMock

import pytest

from agentlens.agentlens import AgentLens
from agentlens.span import Span


# ---------------------------------------------------------------------------
# Span unit tests
# ---------------------------------------------------------------------------


def make_span(**kwargs: object) -> Span:
    return Span(
        span_id=str(uuid.uuid4()),
        trace_id=str(uuid.uuid4()),
        name=kwargs.get("name", "test-span"),  # type: ignore[arg-type]
        project_id="00000000-0000-0000-0000-000000000001",
    )


class TestSpanLifecycle:
    def test_end_records_ended_at(self) -> None:
        span = make_span()
        assert span._ended_at is None
        span.end()
        assert span._ended_at is not None

    def test_end_is_idempotent(self) -> None:
        span = make_span()
        span.end()
        first = span._ended_at
        span.end()
        assert span._ended_at == first

    def test_end_computes_latency_ms(self) -> None:
        span = make_span()
        time.sleep(0.01)  # 10 ms
        span.end()
        assert span._latency_ms is not None
        assert span._latency_ms >= 10

    def test_fluent_setters_return_self(self) -> None:
        span = make_span()
        result = (
            span.set_input("hello")
            .set_output("world")
            .set_model("gpt-4o", "openai")
            .set_tokens(10, 5, 0.001)
            .set_metadata("key", "value")
        )
        assert result is span


class TestSpanSerialisation:
    def test_to_dict_contains_required_fields(self) -> None:
        span = make_span(name="my-span")
        span.end()
        d = span.to_dict()
        assert d["spanId"] == span._span_id
        assert d["traceId"] == span._trace_id
        assert d["projectId"] == "00000000-0000-0000-0000-000000000001"
        assert d["name"] == "my-span"
        assert d["status"] == "success"

    def test_optional_fields_absent_when_not_set(self) -> None:
        span = make_span()
        span.end()
        d = span.to_dict()
        assert "model" not in d
        assert "input" not in d
        assert "output" not in d
        assert "parentSpanId" not in d

    def test_model_and_provider_serialised(self) -> None:
        span = make_span()
        span.set_model("gpt-4o", "openai")
        span.end()
        d = span.to_dict()
        assert d["model"] == "gpt-4o"
        assert d["provider"] == "openai"

    def test_tokens_and_cost_serialised(self) -> None:
        span = make_span()
        span.set_tokens(100, 50, 0.00125)
        span.end()
        d = span.to_dict()
        assert d["inputTokens"] == 100
        assert d["outputTokens"] == 50
        assert abs(d["costUsd"] - 0.00125) < 1e-9

    def test_error_status_serialised(self) -> None:
        span = make_span()
        span.set_error("something went wrong")
        span.end()
        d = span.to_dict()
        assert d["status"] == "error"
        assert d["errorMessage"] == "something went wrong"

    def test_set_error_with_exception(self) -> None:
        span = make_span()
        span.set_error(ValueError("boom"))
        d = span.to_dict()
        assert d["errorMessage"] == "boom"

    def test_metadata_serialised(self) -> None:
        span = make_span()
        span.set_metadata("userId", "u123")
        span.set_metadata("retry", 2)
        span.end()
        d = span.to_dict()
        assert d["metadata"]["userId"] == "u123"
        assert d["metadata"]["retry"] == 2


# ---------------------------------------------------------------------------
# AgentLens.trace context manager tests
# ---------------------------------------------------------------------------


class TestAgentLensTrace:
    def setup_method(self) -> None:
        # Reset singleton before each test
        AgentLens._instance = None

    def teardown_method(self) -> None:
        AgentLens._instance = None

    def _init(self) -> list[dict]:
        """Initialise with a mock transport and return the captured spans list."""
        captured: list[dict] = []

        from agentlens.buffer import Buffer
        from agentlens.transport import Transport

        mock_transport = MagicMock(spec=Transport)
        mock_transport.send.side_effect = lambda spans: captured.extend(spans)

        buffer = Buffer(mock_transport, flush_interval_ms=50_000, max_batch_size=1000)

        AgentLens.init(api_key="proj_test.key", project_id="00000000-0000-0000-0000-000000000001")
        # Replace the real buffer with our instrumented one
        assert AgentLens._instance is not None
        AgentLens._instance._buffer = buffer
        AgentLens._instance._tracer._sink = lambda d: captured.append(d)  # type: ignore[method-assign]
        return captured

    def test_trace_yields_span(self) -> None:
        self._init()
        with AgentLens.trace("step-1") as span:
            assert isinstance(span, Span)

    def test_trace_calls_sink_on_exit(self) -> None:
        captured = self._init()
        with AgentLens.trace("step-1"):
            pass
        assert len(captured) == 1
        assert captured[0]["name"] == "step-1"

    def test_trace_marks_error_on_exception(self) -> None:
        captured = self._init()
        with pytest.raises(RuntimeError):
            with AgentLens.trace("failing-step"):
                raise RuntimeError("oops")
        assert captured[0]["status"] == "error"
        assert captured[0]["errorMessage"] == "oops"

    def test_nested_traces_are_child_spans(self) -> None:
        captured = self._init()
        with AgentLens.trace("parent"):
            with AgentLens.trace("child"):
                pass

        assert len(captured) == 2
        child = next(d for d in captured if d["name"] == "child")
        parent = next(d for d in captured if d["name"] == "parent")
        assert child["parentSpanId"] == parent["spanId"]
        assert child["traceId"] == parent["traceId"]

    def test_traced_decorator_sync(self) -> None:
        captured = self._init()

        @AgentLens.traced("classify")
        def classify(x: int) -> int:
            return x * 2

        result = classify(5)
        assert result == 10
        assert len(captured) == 1
        assert captured[0]["name"] == "classify"

    @pytest.mark.asyncio
    async def test_traced_decorator_async(self) -> None:
        captured = self._init()

        @AgentLens.traced("async-step")
        async def async_fn() -> str:
            return "done"

        result = await async_fn()
        assert result == "done"
        assert len(captured) == 1
        assert captured[0]["name"] == "async-step"
