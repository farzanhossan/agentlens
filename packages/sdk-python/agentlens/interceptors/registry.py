"""LLM endpoint registry — mirrors ``packages/sdk-universal/src/registry.ts``."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

ParserName = Literal["openai", "anthropic", "gemini", "cohere", "mistral"]


@dataclass(frozen=True)
class LLMEndpoint:
    provider: str
    parser: ParserName
    paths: tuple[str, ...]


LLM_REGISTRY: dict[str, LLMEndpoint] = {
    "api.openai.com": LLMEndpoint(
        "openai", "openai", ("/v1/chat/completions", "/v1/completions", "/v1/embeddings")
    ),
    "api.anthropic.com": LLMEndpoint("anthropic", "anthropic", ("/v1/messages",)),
    "generativelanguage.googleapis.com": LLMEndpoint(
        "gemini", "gemini", ("/v1beta/models", "/v1/models")
    ),
    "api.cohere.com": LLMEndpoint("cohere", "cohere", ("/v1/chat", "/v1/generate", "/v2/chat")),
    "api.mistral.ai": LLMEndpoint("mistral", "mistral", ("/v1/chat/completions",)),
}


def match_llm(url: str) -> LLMEndpoint | None:
    """Return the registry entry matching *url*, or ``None``.

    Never raises — malformed URLs simply return ``None``.
    """
    try:
        parsed = urlparse(url)
    except (ValueError, AttributeError):
        return None
    host = parsed.hostname
    if not host:
        return None
    entry = LLM_REGISTRY.get(host)
    if entry is None:
        return None
    path = parsed.path or "/"
    if any(path.startswith(p) for p in entry.paths):
        return entry
    return None


def match_host_path(host: str | None, path: str | None) -> LLMEndpoint | None:
    """Match by separately-known host and path (used by request adapters)."""
    if not host or not path:
        return None
    entry = LLM_REGISTRY.get(host)
    if entry is None:
        return None
    path_only = path.split("?", 1)[0]
    if any(path_only.startswith(p) for p in entry.paths):
        return entry
    return None
