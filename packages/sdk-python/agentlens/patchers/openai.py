"""OpenAI auto-patcher for AgentLens.

Importing this module monkey-patches the OpenAI SDK so that every
``chat.completions.create`` (sync and async, streaming and non-streaming)
and ``embeddings.create`` call is automatically traced.

Usage::

    import agentlens.patchers.openai   # patches globally on import

Requires the ``openai`` extra::

    pip install agentlens[openai]
"""

from __future__ import annotations

import uuid
from typing import Any

from ..agentlens import AgentLens
from ..context import get_current_span_id, get_current_trace_id
from ..span import Span

# ---------------------------------------------------------------------------
# Pricing table (mirrors sdk-openai/src/pricing.ts)
# ---------------------------------------------------------------------------

_PRICING: dict[str, tuple[float, float]] = {
    # (input_cost_per_1k, output_cost_per_1k)
    "gpt-4o": (0.005, 0.015),
    "gpt-4o-2024-05-13": (0.005, 0.015),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4o-mini-2024-07-18": (0.00015, 0.0006),
    "gpt-4-turbo": (0.01, 0.03),
    "gpt-4-turbo-2024-04-09": (0.01, 0.03),
    "gpt-4-turbo-preview": (0.01, 0.03),
    "gpt-4": (0.03, 0.06),
    "gpt-4-0613": (0.03, 0.06),
    "gpt-4-32k": (0.06, 0.12),
    "gpt-3.5-turbo": (0.0005, 0.0015),
    "gpt-3.5-turbo-0125": (0.0005, 0.0015),
    "gpt-3.5-turbo-instruct": (0.0015, 0.002),
    "text-embedding-3-small": (0.00002, 0.0),
    "text-embedding-3-large": (0.00013, 0.0),
    "text-embedding-ada-002": (0.0001, 0.0),
}


def _calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    import re

    pricing = _PRICING.get(model) or _PRICING.get(
        re.sub(r"-\d{4}-\d{2}-\d{2}$", "", model)
    )
    if pricing is None:
        return None
    return (input_tokens / 1000) * pricing[0] + (output_tokens / 1000) * pricing[1]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_span(name: str) -> Span | None:
    """Create a raw Span using the current trace context."""
    project_id = AgentLens._get_project_id()
    if not project_id:
        return None
    trace_id = get_current_trace_id() or str(uuid.uuid4())
    parent_span_id = get_current_span_id()
    return Span(str(uuid.uuid4()), trace_id, name, project_id, parent_span_id)


def _finish_span(span: Span) -> None:
    span.end()
    AgentLens._push_span(span.to_dict())


# ---------------------------------------------------------------------------
# Streaming wrappers
# ---------------------------------------------------------------------------

def _wrap_stream_sync(span: Span, stream: Any, model: str) -> Any:
    """Wrap a sync streaming response, accumulating content for the span."""
    content = ""
    prompt_tokens = 0
    completion_tokens = 0
    try:
        for chunk in stream:
            delta = ""
            if chunk.choices:
                delta = chunk.choices[0].delta.content or ""
            content += delta
            if hasattr(chunk, "usage") and chunk.usage:
                prompt_tokens = chunk.usage.prompt_tokens or 0
                completion_tokens = chunk.usage.completion_tokens or 0
            yield chunk
        if content:
            span.set_output(content)
        if prompt_tokens or completion_tokens:
            cost = _calculate_cost(model, prompt_tokens, completion_tokens)
            span.set_tokens(prompt_tokens, completion_tokens, cost)
    except Exception as exc:
        span.set_error(exc)
        raise
    finally:
        _finish_span(span)


async def _wrap_stream_async(span: Span, stream: Any, model: str) -> Any:
    """Wrap an async streaming response, accumulating content for the span."""
    content = ""
    prompt_tokens = 0
    completion_tokens = 0
    try:
        async for chunk in stream:
            delta = ""
            if chunk.choices:
                delta = chunk.choices[0].delta.content or ""
            content += delta
            if hasattr(chunk, "usage") and chunk.usage:
                prompt_tokens = chunk.usage.prompt_tokens or 0
                completion_tokens = chunk.usage.completion_tokens or 0
            yield chunk
        if content:
            span.set_output(content)
        if prompt_tokens or completion_tokens:
            cost = _calculate_cost(model, prompt_tokens, completion_tokens)
            span.set_tokens(prompt_tokens, completion_tokens, cost)
    except Exception as exc:
        span.set_error(exc)
        raise
    finally:
        _finish_span(span)


# ---------------------------------------------------------------------------
# Patch bookkeeping
# ---------------------------------------------------------------------------

_patches: list[tuple[Any, str, Any]] = []  # (obj, attr_name, original)
_patched = False


def _save_patch(obj: Any, attr: str, replacement: Any) -> None:
    original = getattr(obj, attr)
    _patches.append((obj, attr, original))
    setattr(obj, attr, replacement)


# ---------------------------------------------------------------------------
# chat.completions.create
# ---------------------------------------------------------------------------

def _patch_chat_completions(completions_cls: Any) -> None:
    original_create = completions_cls.create

    def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        if not AgentLens._is_initialized():
            return original_create(self, *args, **kwargs)
        span = _make_span("openai.chat.completions")
        if span is None:
            return original_create(self, *args, **kwargs)

        model: str = kwargs.get("model", args[0] if args else "")
        messages = kwargs.get("messages")
        if messages:
            import json as _json
            span.set_model(model, "openai")
            span.set_input(_json.dumps(messages))

        stream = kwargs.get("stream", False)

        if stream:
            try:
                raw = original_create(self, *args, **kwargs)
            except Exception as exc:
                span.set_error(exc)
                _finish_span(span)
                raise
            return _wrap_stream_sync(span, raw, model)

        try:
            result = original_create(self, *args, **kwargs)
            if result.choices:
                content = result.choices[0].message.content or ""
                if content:
                    span.set_output(content)
            if result.usage:
                cost = _calculate_cost(
                    model, result.usage.prompt_tokens, result.usage.completion_tokens
                )
                span.set_tokens(result.usage.prompt_tokens, result.usage.completion_tokens, cost)
            return result
        except Exception as exc:
            span.set_error(exc)
            raise
        finally:
            _finish_span(span)

    _save_patch(completions_cls, "create", patched_create)


def _patch_async_chat_completions(completions_cls: Any) -> None:
    original_create = completions_cls.create

    async def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        if not AgentLens._is_initialized():
            return await original_create(self, *args, **kwargs)
        span = _make_span("openai.chat.completions")
        if span is None:
            return await original_create(self, *args, **kwargs)

        model: str = kwargs.get("model", args[0] if args else "")
        messages = kwargs.get("messages")
        if messages:
            import json as _json
            span.set_model(model, "openai")
            span.set_input(_json.dumps(messages))

        stream = kwargs.get("stream", False)

        if stream:
            try:
                raw = await original_create(self, *args, **kwargs)
            except Exception as exc:
                span.set_error(exc)
                _finish_span(span)
                raise
            return _wrap_stream_async(span, raw, model)

        try:
            result = await original_create(self, *args, **kwargs)
            if result.choices:
                content = result.choices[0].message.content or ""
                if content:
                    span.set_output(content)
            if result.usage:
                cost = _calculate_cost(
                    model, result.usage.prompt_tokens, result.usage.completion_tokens
                )
                span.set_tokens(result.usage.prompt_tokens, result.usage.completion_tokens, cost)
            return result
        except Exception as exc:
            span.set_error(exc)
            raise
        finally:
            _finish_span(span)

    _save_patch(completions_cls, "create", patched_create)


# ---------------------------------------------------------------------------
# embeddings.create
# ---------------------------------------------------------------------------

def _patch_embeddings(embeddings_cls: Any) -> None:
    original_create = embeddings_cls.create

    def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        if not AgentLens._is_initialized():
            return original_create(self, *args, **kwargs)
        span = _make_span("openai.embeddings")
        if span is None:
            return original_create(self, *args, **kwargs)

        model: str = kwargs.get("model", args[0] if args else "")
        span.set_model(model, "openai")
        inp = kwargs.get("input")
        if isinstance(inp, str):
            span.set_input(inp)
        elif isinstance(inp, list):
            import json as _json
            span.set_input(_json.dumps(inp))

        try:
            result = original_create(self, *args, **kwargs)
            if result.usage:
                cost = _calculate_cost(model, result.usage.prompt_tokens, 0)
                span.set_tokens(result.usage.prompt_tokens, 0, cost)
            return result
        except Exception as exc:
            span.set_error(exc)
            raise
        finally:
            _finish_span(span)

    _save_patch(embeddings_cls, "create", patched_create)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def patch() -> None:
    """Monkey-patch the OpenAI SDK to auto-trace all LLM calls.

    Safe to call multiple times — subsequent calls are no-ops.
    Called automatically when this module is imported.
    """
    global _patched
    if _patched:
        return

    try:
        import openai as _openai
    except ImportError:
        import warnings
        warnings.warn(
            "[AgentLens] openai package not found — skipping auto-patch.",
            stacklevel=2,
        )
        return

    # Sync client
    probe = _openai.OpenAI(api_key="__agentlens_probe__")
    _patch_chat_completions(type(probe.chat.completions))
    _patch_embeddings(type(probe.embeddings))

    # Async client
    async_probe = _openai.AsyncOpenAI(api_key="__agentlens_probe__")
    _patch_async_chat_completions(type(async_probe.chat.completions))

    _patched = True


def unpatch() -> None:
    """Restore all patched OpenAI methods to their original implementations.

    Primarily used in tests to ensure a clean state between test cases.
    """
    global _patched
    for obj, attr, original in _patches:
        setattr(obj, attr, original)
    _patches.clear()
    _patched = False


# Auto-patch on import
patch()
