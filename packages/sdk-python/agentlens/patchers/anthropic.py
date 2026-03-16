"""Anthropic auto-patcher for AgentLens.

Importing this module monkey-patches the Anthropic SDK so that every
``messages.create`` call (sync and async) is automatically traced.

Usage::

    import agentlens.patchers.anthropic   # patches globally on import

Requires the ``anthropic`` extra::

    pip install agentlens[anthropic]
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from ..agentlens import AgentLens
from ..context import get_current_span_id, get_current_trace_id
from ..span import Span

# Anthropic pricing (USD per 1k tokens, as of 2024-Q2)
_PRICING: dict[str, tuple[float, float]] = {
    "claude-3-5-sonnet-20240620": (0.003, 0.015),
    "claude-3-5-sonnet": (0.003, 0.015),
    "claude-3-opus-20240229": (0.015, 0.075),
    "claude-3-opus": (0.015, 0.075),
    "claude-3-sonnet-20240229": (0.003, 0.015),
    "claude-3-sonnet": (0.003, 0.015),
    "claude-3-haiku-20240307": (0.00025, 0.00125),
    "claude-3-haiku": (0.00025, 0.00125),
}


def _calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    import re

    pricing = _PRICING.get(model) or _PRICING.get(
        re.sub(r"-\d{8}$", "", model)
    )
    if pricing is None:
        return None
    return (input_tokens / 1000) * pricing[0] + (output_tokens / 1000) * pricing[1]


def _make_span(name: str) -> Span | None:
    project_id = AgentLens._get_project_id()
    if not project_id:
        return None
    trace_id = get_current_trace_id() or str(uuid.uuid4())
    parent_span_id = get_current_span_id()
    return Span(str(uuid.uuid4()), trace_id, name, project_id, parent_span_id)


def _finish_span(span: Span) -> None:
    span.end()
    AgentLens._push_span(span.to_dict())


def _annotate_from_response(span: Span, result: Any, model: str) -> None:
    """Extract output text and token usage from an Anthropic response."""
    if hasattr(result, "content") and result.content:
        texts = [
            block.text
            for block in result.content
            if hasattr(block, "text")
        ]
        if texts:
            span.set_output("\n".join(texts))
    if hasattr(result, "usage") and result.usage:
        in_tok = getattr(result.usage, "input_tokens", 0) or 0
        out_tok = getattr(result.usage, "output_tokens", 0) or 0
        cost = _calculate_cost(model, in_tok, out_tok)
        span.set_tokens(in_tok, out_tok, cost)


# ---------------------------------------------------------------------------
# Patch bookkeeping
# ---------------------------------------------------------------------------

_patches: list[tuple[Any, str, Any]] = []
_patched = False


def _save_patch(obj: Any, attr: str, replacement: Any) -> None:
    original = getattr(obj, attr)
    _patches.append((obj, attr, original))
    setattr(obj, attr, replacement)


# ---------------------------------------------------------------------------
# messages.create — sync
# ---------------------------------------------------------------------------

def _patch_messages(messages_cls: Any) -> None:
    original_create = messages_cls.create

    def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        if not AgentLens._is_initialized():
            return original_create(self, *args, **kwargs)
        span = _make_span("anthropic.messages")
        if span is None:
            return original_create(self, *args, **kwargs)

        model: str = kwargs.get("model", "")
        span.set_model(model, "anthropic")
        messages = kwargs.get("messages")
        if messages:
            span.set_input(json.dumps(messages))
        system = kwargs.get("system")
        if system and not messages:
            span.set_input(str(system))

        try:
            result = original_create(self, *args, **kwargs)
            _annotate_from_response(span, result, model)
            return result
        except Exception as exc:
            span.set_error(exc)
            raise
        finally:
            _finish_span(span)

    _save_patch(messages_cls, "create", patched_create)


# ---------------------------------------------------------------------------
# messages.create — async
# ---------------------------------------------------------------------------

def _patch_async_messages(messages_cls: Any) -> None:
    original_create = messages_cls.create

    async def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        if not AgentLens._is_initialized():
            return await original_create(self, *args, **kwargs)
        span = _make_span("anthropic.messages")
        if span is None:
            return await original_create(self, *args, **kwargs)

        model: str = kwargs.get("model", "")
        span.set_model(model, "anthropic")
        messages = kwargs.get("messages")
        if messages:
            span.set_input(json.dumps(messages))
        system = kwargs.get("system")
        if system and not messages:
            span.set_input(str(system))

        try:
            result = await original_create(self, *args, **kwargs)
            _annotate_from_response(span, result, model)
            return result
        except Exception as exc:
            span.set_error(exc)
            raise
        finally:
            _finish_span(span)

    _save_patch(messages_cls, "create", patched_create)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def patch() -> None:
    """Monkey-patch the Anthropic SDK to auto-trace all ``messages.create`` calls.

    Safe to call multiple times — subsequent calls are no-ops.
    Called automatically when this module is imported.
    """
    global _patched
    if _patched:
        return

    try:
        import anthropic as _anthropic
    except ImportError:
        import warnings
        warnings.warn(
            "[AgentLens] anthropic package not found — skipping auto-patch.",
            stacklevel=2,
        )
        return

    probe = _anthropic.Anthropic(api_key="__agentlens_probe__")
    _patch_messages(type(probe.messages))

    async_probe = _anthropic.AsyncAnthropic(api_key="__agentlens_probe__")
    _patch_async_messages(type(async_probe.messages))

    _patched = True


def unpatch() -> None:
    """Restore all patched Anthropic methods.

    Primarily used in tests.
    """
    global _patched
    for obj, attr, original in _patches:
        setattr(obj, attr, original)
    _patches.clear()
    _patched = False


# Auto-patch on import
patch()
