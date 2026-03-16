"""Core type definitions for AgentLens."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class SpanKind(str, Enum):
    LLM_CALL = "llm_call"
    TOOL_CALL = "tool_call"
    AGENT_LOOP = "agent_loop"
    RETRIEVAL = "retrieval"
    EMBEDDING = "embedding"
    CHAIN = "chain"
    UNKNOWN = "unknown"


class SpanStatus(str, Enum):
    UNSET = "UNSET"
    OK = "OK"
    ERROR = "ERROR"


SpanAttributes = dict[str, str | int | float | bool | list[str]]


@dataclass
class SpanEvent:
    name: str
    timestamp_ms: int
    attributes: SpanAttributes = field(default_factory=dict)


@dataclass
class ReadableSpan:
    trace_id: str
    span_id: str
    name: str
    kind: SpanKind
    start_time_ms: int
    end_time_ms: int
    duration_ms: int
    status: SpanStatus
    attributes: SpanAttributes = field(default_factory=dict)
    events: list[SpanEvent] = field(default_factory=list)
    parent_span_id: str | None = None
    status_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "parentSpanId": self.parent_span_id,
            "name": self.name,
            "kind": self.kind.value,
            "startTimeMs": self.start_time_ms,
            "endTimeMs": self.end_time_ms,
            "durationMs": self.duration_ms,
            "status": self.status.value,
            "statusMessage": self.status_message,
            "attributes": self.attributes,
            "events": [
                {
                    "name": e.name,
                    "timestampMs": e.timestamp_ms,
                    "attributes": e.attributes,
                }
                for e in self.events
            ],
        }
