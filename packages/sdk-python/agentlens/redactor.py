"""PII redactor — same patterns as the TypeScript SDK.

Each pattern is replaced with a bracketed label so consumers can see
that a value existed without retaining the sensitive data.

Usage::

    from agentlens.redactor import redact, maybe_redact

    clean = redact("Contact user@example.com or call 415-555-1234")
    # -> "Contact [REDACTED-EMAIL] or call [REDACTED-PHONE]"
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Redaction rules — identical patterns to the TypeScript SDK's redactor.ts
# ---------------------------------------------------------------------------

_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "EMAIL",
        # RFC 5321-ish — intentionally broad for PII detection
        re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    ),
    (
        "PHONE",
        # North-American + international E.164 variants
        re.compile(r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b"),
    ),
    (
        "SSN",
        re.compile(r"\b(?!000|666|9\d{2})\d{3}[- ]?\d{2}[- ]?\d{4}\b"),
    ),
    (
        "CREDIT_CARD",
        # Luhn-formatted 13-19 digit card numbers with optional separators
        re.compile(r"\b(?:\d[ \-]?){13,19}\b"),
    ),
    (
        "API_KEY",
        # Common API key patterns: sk-…, pk-…, key-…, token-… (32+ chars)
        re.compile(
            r"\b(?:sk|pk|key|api_key|token|secret)[_\-]?[A-Za-z0-9]{20,}\b",
            re.IGNORECASE,
        ),
    ),
    (
        "BEARER_TOKEN",
        # Authorization: Bearer <token>
        re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b", re.IGNORECASE),
    ),
]


def redact(text: str) -> str:
    """Scan *text* for PII patterns and replace each match with
    ``[REDACTED-<TYPE>]``.  Returns the sanitised string.
    """
    result = text
    for label, pattern in _RULES:
        result = pattern.sub(f"[REDACTED-{label}]", result)
    return result


def maybe_redact(text: str | None, enabled: bool) -> str | None:
    """Conditionally redact *text*; returns ``None`` / ``undefined`` unchanged."""
    if not enabled or text is None:
        return text
    return redact(text)
