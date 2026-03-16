"""Pydantic v2 wire-format models for AgentLens spans."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class SpanData(BaseModel):
    """Canonical wire format for a single span sent to the ingest endpoint.

    Field names use snake_case internally; ``to_wire()`` serialises them to
    camelCase for the HTTP payload.

    Note:
        ``input`` and ``output`` carry raw LLM prompt/completion text.
        They are forwarded to Elasticsearch by the ingest worker and are
        intentionally absent from the PostgreSQL spans table.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    span_id: str
    trace_id: str
    project_id: str
    name: str
    status: Literal["success", "error", "timeout"] = "success"
    metadata: dict[str, Any] = {}
    started_at: str  # ISO-8601

    parent_span_id: str | None = None
    model: str | None = None
    provider: str | None = None
    input: str | None = None
    output: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    latency_ms: int | None = None
    error_message: str | None = None
    ended_at: str | None = None

    def to_wire(self) -> dict[str, Any]:
        """Serialise to a camelCase dict, omitting ``None`` values."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)
