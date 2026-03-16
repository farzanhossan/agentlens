"""AgentLens SDK configuration."""

from __future__ import annotations

from dataclasses import dataclass, field

_DEFAULT_ENDPOINT = "https://ingest.agentlens.dev"


@dataclass
class AgentLensConfig:
    """Configuration passed to :meth:`AgentLens.init`.

    Args:
        api_key: Raw API key (e.g. ``proj_live_abc123``). Sent as
            ``X-API-Key`` header on every ingest request.
        project_id: AgentLens project UUID. Attached to every span.
        endpoint: Base URL of the ingest endpoint.
        flush_interval_ms: How often (ms) the buffer flushes when the
            batch-size limit has not been reached. Default: 500.
        max_batch_size: Maximum spans per flush batch. Default: 100.
        redact_pii: When ``True``, PII patterns are redacted from
            ``input`` and ``output`` before buffering. Default: ``False``.
    """

    api_key: str
    project_id: str
    endpoint: str = field(default=_DEFAULT_ENDPOINT)
    flush_interval_ms: int = field(default=500)
    max_batch_size: int = field(default=100)
    redact_pii: bool = field(default=False)
