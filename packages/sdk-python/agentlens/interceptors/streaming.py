"""Per-provider SSE / NDJSON stream parsers.

Each ``parse_*_stream`` consumes the raw response text and returns a
synthesized non-streaming response dict matching that provider's response
shape, so the normal :func:`agentlens.interceptors.parsers.parse_span` can
process it without a separate streaming code path.

Mirrors ``packages/sdk-universal/src/streaming/sse.ts`` behavior.
"""

from __future__ import annotations

import json
from typing import Any

from .registry import ParserName


def synthesize_streaming_response(
    raw: str, parser: ParserName, request: dict[str, Any] | None
) -> dict[str, Any]:
    """Parse *raw* SSE/NDJSON body and produce a non-streaming response shape."""
    if parser == "openai" or parser == "mistral":
        return _openai_shape(_parse_openai_sse(raw), (request or {}).get("model"))
    if parser == "anthropic":
        return _anthropic_shape(_parse_anthropic_sse(raw), (request or {}).get("model"))
    if parser == "gemini":
        return _gemini_shape(_parse_gemini_sse(raw), (request or {}).get("model"))
    if parser == "cohere":
        return _cohere_shape(_parse_cohere_sse(raw), (request or {}).get("model"))
    return {}


def _parse_openai_sse(raw: str) -> tuple[str, int, int]:
    out, in_tok, out_tok = "", 0, 0
    for line in raw.split("\n"):
        if not line.startswith("data: "):
            continue
        body = line[6:].strip()
        if not body or body == "[DONE]":
            continue
        try:
            evt = json.loads(body)
        except json.JSONDecodeError:
            continue
        choices = evt.get("choices") if isinstance(evt, dict) else None
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if isinstance(choice, dict):
                delta = choice.get("delta") or {}
                if isinstance(delta.get("content"), str):
                    out += delta["content"]
                elif isinstance(choice.get("text"), str):
                    out += choice["text"]
        usage = evt.get("usage") if isinstance(evt, dict) else None
        if isinstance(usage, dict):
            if isinstance(usage.get("prompt_tokens"), int):
                in_tok = usage["prompt_tokens"]
            if isinstance(usage.get("completion_tokens"), int):
                out_tok = usage["completion_tokens"]
    return out, in_tok, out_tok


def _parse_anthropic_sse(raw: str) -> tuple[str, int, int]:
    out, in_tok, out_tok = "", 0, 0
    for line in raw.split("\n"):
        if not line.startswith("data: "):
            continue
        body = line[6:].strip()
        if not body or body == "[DONE]":
            continue
        try:
            evt = json.loads(body)
        except json.JSONDecodeError:
            continue
        if not isinstance(evt, dict):
            continue
        if evt.get("type") == "content_block_delta":
            delta = evt.get("delta") or {}
            if delta.get("type") == "text_delta" and isinstance(delta.get("text"), str):
                out += delta["text"]
        msg_usage = (
            (evt.get("message") or {}).get("usage")
            if isinstance(evt.get("message"), dict)
            else None
        )
        usage = msg_usage or evt.get("usage")
        if isinstance(usage, dict):
            if isinstance(usage.get("input_tokens"), int):
                in_tok = usage["input_tokens"]
            if isinstance(usage.get("output_tokens"), int):
                out_tok = usage["output_tokens"]
    return out, in_tok, out_tok


def _parse_gemini_sse(raw: str) -> tuple[str, int, int]:
    out, in_tok, out_tok = "", 0, 0
    chunks: list[Any] = []
    # Format 1: `data: {...}` SSE lines
    for line in raw.split("\n"):
        if not line.startswith("data: "):
            continue
        body = line[6:].strip()
        if not body or body == "[DONE]":
            continue
        try:
            chunks.append(json.loads(body))
        except json.JSONDecodeError:
            continue
    # Format 2: single JSON array (`alt=json` streaming response)
    if not chunks:
        try:
            parsed = json.loads(raw.strip())
            chunks = parsed if isinstance(parsed, list) else [parsed]
        except (json.JSONDecodeError, AttributeError):
            chunks = []

    for evt in chunks:
        if not isinstance(evt, dict):
            continue
        candidates = evt.get("candidates")
        if isinstance(candidates, list):
            for c in candidates:
                if not isinstance(c, dict):
                    continue
                parts = (c.get("content") or {}).get("parts")
                if isinstance(parts, list):
                    for p in parts:
                        if isinstance(p, dict) and isinstance(p.get("text"), str):
                            out += p["text"]
        usage = evt.get("usageMetadata")
        if isinstance(usage, dict):
            if isinstance(usage.get("promptTokenCount"), int):
                in_tok = usage["promptTokenCount"]
            if isinstance(usage.get("candidatesTokenCount"), int):
                out_tok = usage["candidatesTokenCount"]
    return out, in_tok, out_tok


def _parse_cohere_sse(raw: str) -> tuple[str, int, int]:
    """Cohere v1 streams NDJSON; v2 streams SSE — both handled here."""
    out, in_tok, out_tok = "", 0, 0
    for line in raw.split("\n"):
        trimmed = line.strip()
        if not trimmed:
            continue
        if trimmed.startswith("event:"):
            continue
        body = trimmed[6:].strip() if trimmed.startswith("data: ") else trimmed
        if not body or body == "[DONE]":
            continue
        try:
            evt = json.loads(body)
        except json.JSONDecodeError:
            continue
        if not isinstance(evt, dict):
            continue

        # v1
        if evt.get("event_type") == "text-generation" and isinstance(evt.get("text"), str):
            out += evt["text"]
        if evt.get("event_type") == "stream-end":
            resp = evt.get("response") or {}
            billed = ((resp.get("meta") or {}).get("billed_units")) or {}
            if isinstance(billed.get("input_tokens"), int):
                in_tok = billed["input_tokens"]
            if isinstance(billed.get("output_tokens"), int):
                out_tok = billed["output_tokens"]

        # v2
        delta = evt.get("delta")
        if isinstance(delta, dict):
            text = ((delta.get("message") or {}).get("content") or {}).get("text")
            if isinstance(text, str):
                out += text
            tokens = (delta.get("usage") or {}).get("tokens")
            if isinstance(tokens, dict):
                if isinstance(tokens.get("input_tokens"), int):
                    in_tok = tokens["input_tokens"]
                if isinstance(tokens.get("output_tokens"), int):
                    out_tok = tokens["output_tokens"]
    return out, in_tok, out_tok


def _openai_shape(parsed: tuple[str, int, int], model: str | None) -> dict[str, Any]:
    text, in_tok, out_tok = parsed
    return {
        "model": model or "unknown",
        "choices": [{"message": {"content": text, "role": "assistant"}}],
        "usage": {
            "prompt_tokens": in_tok,
            "completion_tokens": out_tok,
            "total_tokens": in_tok + out_tok,
        },
    }


def _anthropic_shape(parsed: tuple[str, int, int], model: str | None) -> dict[str, Any]:
    text, in_tok, out_tok = parsed
    return {
        "model": model or "unknown",
        "content": [{"type": "text", "text": text}],
        "usage": {"input_tokens": in_tok, "output_tokens": out_tok},
    }


def _gemini_shape(parsed: tuple[str, int, int], model: str | None) -> dict[str, Any]:
    text, in_tok, out_tok = parsed
    return {
        "modelVersion": model or "unknown",
        "candidates": [{"content": {"parts": [{"text": text}]}}],
        "usageMetadata": {
            "promptTokenCount": in_tok,
            "candidatesTokenCount": out_tok,
            "totalTokenCount": in_tok + out_tok,
        },
    }


def _cohere_shape(parsed: tuple[str, int, int], model: str | None) -> dict[str, Any]:
    text, in_tok, out_tok = parsed
    _ = model  # cohere parser doesn't read model from response
    return {
        "text": text,
        "meta": {"billed_units": {"input_tokens": in_tok, "output_tokens": out_tok}},
    }
