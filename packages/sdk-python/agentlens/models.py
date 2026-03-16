"""Pydantic v2 wire-format models for AgentLens spans."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

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
    metadata: Dict[str, Any] = {}
    started_at: str  # ISO-8601

    parent_span_id: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    input: Optional[str] = None
    output: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    latency_ms: Optional[int] = None
    error_message: Optional[str] = None
    ended_at: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        """Serialise to a camelCase dict, omitting ``None`` values."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)
