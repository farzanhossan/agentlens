"""Per-provider request/response parsers.

Each parser takes the raw JSON request and response and normalizes them into
a :class:`ParsedSpan` carrying input/output text, token counts, and cost.

Mirrors ``packages/sdk-universal/src/parsers/*.ts`` field-for-field. Parsers
work at the raw JSON level (not the provider SDK object level) so minor
provider-SDK version bumps don't break the SDK.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .registry import ParserName

# ---------------------------------------------------------------------------
# Pricing tables — mirror sdk-universal counterparts. USD per token.
# ---------------------------------------------------------------------------

_OPENAI_COSTS: dict[str, tuple[float, float]] = {
    "gpt-4o": (0.0000025, 0.000010),
    "gpt-4o-mini": (0.00000015, 0.0000006),
    "gpt-4-turbo": (0.000010, 0.000030),
    "gpt-4": (0.000030, 0.000060),
    "gpt-3.5-turbo": (0.0000005, 0.0000015),
    "text-embedding-3-small": (0.00000002, 0.0),
    "text-embedding-3-large": (0.00000013, 0.0),
}
_ANTHROPIC_COSTS: dict[str, tuple[float, float]] = {
    "claude-3-5-sonnet": (0.000003, 0.000015),
    "claude-3-opus": (0.000015, 0.000075),
    "claude-3-sonnet": (0.000003, 0.000015),
    "claude-3-haiku": (0.00000025, 0.00000125),
}
_GEMINI_COSTS: dict[str, tuple[float, float]] = {
    "gemini-1.5-pro": (0.00000125, 0.000005),
    "gemini-1.5-flash": (0.000000075, 0.0000003),
    "gemini-1.0-pro": (0.0000005, 0.0000015),
    "gemini-pro": (0.0000005, 0.0000015),
}
_COHERE_COSTS: dict[str, tuple[float, float]] = {
    "command-r-plus": (0.000003, 0.000015),
    "command-r": (0.0000005, 0.0000015),
    "command": (0.000001, 0.000002),
    "command-light": (0.0000003, 0.0000006),
}
_MISTRAL_COSTS: dict[str, tuple[float, float]] = {
    "mistral-large": (0.000002, 0.000006),
    "mistral-medium": (0.0000027, 0.0000081),
    "mistral-small": (0.0000002, 0.0000006),
    "open-mistral-7b": (0.00000025, 0.00000025),
    "open-mixtral-8x7b": (0.0000007, 0.0000007),
    "open-mixtral-8x22b": (0.000002, 0.000006),
}


def _lookup_cost(model: str, table: dict[str, tuple[float, float]]) -> tuple[float, float]:
    """Exact-match first, then prefix-match (handles ``gpt-4o-2024-08-06``)."""
    if model in table:
        return table[model]
    for key, price in table.items():
        if model.startswith(key):
            return price
    return (0.0, 0.0)


# ---------------------------------------------------------------------------
# Normalised result type
# ---------------------------------------------------------------------------


@dataclass
class ParsedSpan:
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float
    input_text: str
    output_text: str
    is_stream: bool
    error: str | None = None


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


def _openai_input(request: dict[str, Any] | None) -> str:
    if not request:
        return ""
    msgs = request.get("messages")
    if isinstance(msgs, list):
        parts: list[str] = []
        for m in msgs:
            content = m.get("content") if isinstance(m, dict) else None
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for p in content:
                    text = p.get("text") if isinstance(p, dict) else None
                    if isinstance(text, str):
                        parts.append(text)
        return "\n".join(parts)
    prompt = request.get("prompt")
    if isinstance(prompt, str):
        return prompt
    inp = request.get("input")
    if isinstance(inp, str):
        return inp
    if isinstance(inp, list):
        return "\n".join(str(x) for x in inp)
    return ""


def _openai_output(response: dict[str, Any] | None) -> str:
    if not response:
        return ""
    choices = response.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str):
                    return c
            text = first.get("text")
            if isinstance(text, str):
                return text
    return ""


def parse_openai(
    request: dict[str, Any] | None, response: dict[str, Any] | None, is_stream: bool
) -> ParsedSpan:
    model = (response or {}).get("model") or (request or {}).get("model") or "unknown"
    usage = (response or {}).get("usage") or {}
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or input_tokens + output_tokens)
    in_c, out_c = _lookup_cost(model, _OPENAI_COSTS)
    return ParsedSpan(
        model=model,
        provider="openai",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cost_usd=input_tokens * in_c + output_tokens * out_c,
        input_text=_openai_input(request),
        output_text=_openai_output(response),
        is_stream=is_stream,
    )


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------


def _anthropic_input(request: dict[str, Any] | None) -> str:
    if not request:
        return ""
    msgs = request.get("messages")
    if not isinstance(msgs, list):
        return ""
    parts: list[str] = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for p in content:
                text = p.get("text") if isinstance(p, dict) else None
                if isinstance(text, str):
                    parts.append(text)
    return "\n".join(parts)


def _anthropic_output(response: dict[str, Any] | None) -> str:
    if not response:
        return ""
    content = response.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for p in content:
        if isinstance(p, dict):
            t = p.get("text")
            if isinstance(t, str):
                parts.append(t)
    return "".join(parts)


def parse_anthropic(
    request: dict[str, Any] | None, response: dict[str, Any] | None, is_stream: bool
) -> ParsedSpan:
    model = (response or {}).get("model") or (request or {}).get("model") or "unknown"
    usage = (response or {}).get("usage") or {}
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    in_c, out_c = _lookup_cost(model, _ANTHROPIC_COSTS)
    return ParsedSpan(
        model=model,
        provider="anthropic",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=input_tokens * in_c + output_tokens * out_c,
        input_text=_anthropic_input(request),
        output_text=_anthropic_output(response),
        is_stream=is_stream,
    )


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------


def _gemini_input(request: dict[str, Any] | None) -> str:
    if not request:
        return ""
    contents = request.get("contents")
    if not isinstance(contents, list):
        return ""
    parts: list[str] = []
    for c in contents:
        if not isinstance(c, dict):
            continue
        inner = c.get("parts")
        if isinstance(inner, list):
            for p in inner:
                text = p.get("text") if isinstance(p, dict) else None
                if isinstance(text, str):
                    parts.append(text)
    return "\n".join(parts)


def _gemini_output(response: dict[str, Any] | None) -> str:
    if not response:
        return ""
    candidates = response.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    first = candidates[0]
    parts = (first.get("content") or {}).get("parts") if isinstance(first, dict) else None
    if not isinstance(parts, list):
        return ""
    out: list[str] = []
    for p in parts:
        if isinstance(p, dict):
            t = p.get("text")
            if isinstance(t, str):
                out.append(t)
    return "".join(out)


def parse_gemini(
    request: dict[str, Any] | None, response: dict[str, Any] | None, is_stream: bool
) -> ParsedSpan:
    model = (response or {}).get("modelVersion") or (request or {}).get("model") or "unknown"
    usage = (response or {}).get("usageMetadata") or {}
    input_tokens = int(usage.get("promptTokenCount") or 0)
    output_tokens = int(usage.get("candidatesTokenCount") or 0)
    total_tokens = int(usage.get("totalTokenCount") or input_tokens + output_tokens)
    in_c, out_c = _lookup_cost(model, _GEMINI_COSTS)
    return ParsedSpan(
        model=model,
        provider="gemini",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cost_usd=input_tokens * in_c + output_tokens * out_c,
        input_text=_gemini_input(request),
        output_text=_gemini_output(response),
        is_stream=is_stream,
    )


# ---------------------------------------------------------------------------
# Cohere
# ---------------------------------------------------------------------------


def _cohere_input(request: dict[str, Any] | None) -> str:
    if not request:
        return ""
    msg = request.get("message")
    if isinstance(msg, str):
        return msg
    prompt = request.get("prompt")
    if isinstance(prompt, str):
        return prompt
    msgs = request.get("messages")
    if isinstance(msgs, list):
        contents: list[str] = []
        for m in msgs:
            if isinstance(m, dict):
                c = m.get("content")
                if isinstance(c, str):
                    contents.append(c)
        return "\n".join(contents)
    return ""


def _cohere_output(response: dict[str, Any] | None) -> str:
    if not response:
        return ""
    top_text = response.get("text")
    if isinstance(top_text, str):
        return top_text
    msg = response.get("message")
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, list):
            parts: list[str] = []
            for c in content:
                if isinstance(c, dict):
                    t = c.get("text")
                    if isinstance(t, str):
                        parts.append(t)
            return "".join(parts)
    gens = response.get("generations")
    if isinstance(gens, list) and gens:
        first = gens[0]
        if isinstance(first, dict):
            gt = first.get("text")
            if isinstance(gt, str):
                return gt
    return ""


def parse_cohere(
    request: dict[str, Any] | None, response: dict[str, Any] | None, is_stream: bool
) -> ParsedSpan:
    model = (request or {}).get("model") or "unknown"
    # v1: meta.billed_units, v2: usage.tokens
    meta = (response or {}).get("meta") or {}
    usage_v2 = (response or {}).get("usage") or {}
    tokens = meta.get("billed_units") or usage_v2.get("tokens") or {}
    input_tokens = int(tokens.get("input_tokens") or 0)
    output_tokens = int(tokens.get("output_tokens") or 0)
    in_c, out_c = _lookup_cost(model, _COHERE_COSTS)
    return ParsedSpan(
        model=model,
        provider="cohere",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=input_tokens * in_c + output_tokens * out_c,
        input_text=_cohere_input(request),
        output_text=_cohere_output(response),
        is_stream=is_stream,
    )


# ---------------------------------------------------------------------------
# Mistral (OpenAI-shaped)
# ---------------------------------------------------------------------------


def parse_mistral(
    request: dict[str, Any] | None, response: dict[str, Any] | None, is_stream: bool
) -> ParsedSpan:
    base = parse_openai(request, response, is_stream)
    model = base.model
    in_c, out_c = _lookup_cost(model, _MISTRAL_COSTS)
    return ParsedSpan(
        model=model,
        provider="mistral",
        input_tokens=base.input_tokens,
        output_tokens=base.output_tokens,
        total_tokens=base.total_tokens,
        cost_usd=base.input_tokens * in_c + base.output_tokens * out_c,
        input_text=base.input_text,
        output_text=base.output_text,
        is_stream=is_stream,
    )


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


def parse_span(
    parser: ParserName,
    request: dict[str, Any] | None,
    response: dict[str, Any] | None,
    is_stream: bool,
) -> ParsedSpan:
    if parser == "openai":
        return parse_openai(request, response, is_stream)
    if parser == "anthropic":
        return parse_anthropic(request, response, is_stream)
    if parser == "gemini":
        return parse_gemini(request, response, is_stream)
    if parser == "cohere":
        return parse_cohere(request, response, is_stream)
    if parser == "mistral":
        return parse_mistral(request, response, is_stream)
    raise ValueError(f"Unknown parser: {parser}")
