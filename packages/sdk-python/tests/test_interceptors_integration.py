"""End-to-end tests for the httpx + requests interceptors.

Stands up a real local http.server speaking the OpenAI response shape, then
points httpx / requests at it (registering 127.0.0.1 in LLM_REGISTRY for the
duration of the test). Captures emitted spans by monkey-patching
``AgentLens._push_span``.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from agentlens.agentlens import AgentLens
from agentlens.interceptors.httpx_patch import patch_httpx
from agentlens.interceptors.registry import LLM_REGISTRY, LLMEndpoint

TEST_HOST = "127.0.0.1"

_OPENAI_RESPONSE = {
    "model": "gpt-4o-mini",
    "choices": [{"message": {"content": "hi back", "role": "assistant"}}],
    "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
}

_OPENAI_STREAM_BODY = (
    'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n'
    'data: {"choices":[{"delta":{"content":"there"}}]}\n\n'
    'data: {"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n'
    "data: [DONE]\n\n"
)


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 — stdlib signature
        length = int(self.headers.get("content-length", 0))
        _ = self.rfile.read(length)
        if self.path.endswith("/stream"):
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            self.wfile.write(_OPENAI_STREAM_BODY.encode())
            return
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(_OPENAI_RESPONSE).encode())

    def log_message(self, *_args: Any) -> None:  # noqa: ANN401 — stdlib signature
        pass  # silence stderr noise


@pytest.fixture
def server() -> Any:
    httpd = HTTPServer((TEST_HOST, 0), _Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    saved = LLM_REGISTRY.get(TEST_HOST)
    LLM_REGISTRY[TEST_HOST] = LLMEndpoint(
        provider="openai",
        parser="openai",
        paths=("/v1/chat/completions",),
    )
    try:
        yield port
    finally:
        if saved is None:
            LLM_REGISTRY.pop(TEST_HOST, None)
        else:
            LLM_REGISTRY[TEST_HOST] = saved
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture
def captured() -> Any:
    """Patch AgentLens to capture pushed spans without spinning up the buffer."""
    spans: list[dict[str, Any]] = []
    with (
        patch.object(AgentLens, "_is_initialized", classmethod(lambda cls: True)),
        patch.object(AgentLens, "_push_span", classmethod(lambda cls, span: spans.append(span))),
    ):
        yield spans


def test_httpx_sync_intercepts_openai_call(server: int, captured: list[dict[str, Any]]) -> None:
    patch_httpx()
    with httpx.Client() as client:
        resp = client.post(
            f"http://{TEST_HOST}:{server}/v1/chat/completions",
            json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert resp.status_code == 200
    assert resp.json()["choices"][0]["message"]["content"] == "hi back"

    assert len(captured) == 1
    span = captured[0]
    assert span["provider"] == "openai"
    assert span["model"] == "gpt-4o-mini"
    assert span["inputTokens"] == 3
    assert span["outputTokens"] == 2
    assert span["status"] == "success"


@pytest.mark.asyncio
async def test_httpx_async_intercepts_openai_call(
    server: int, captured: list[dict[str, Any]]
) -> None:
    patch_httpx()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"http://{TEST_HOST}:{server}/v1/chat/completions",
            json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert resp.status_code == 200
    assert len(captured) == 1
    assert captured[0]["inputTokens"] == 3


def test_httpx_streaming_response_extracts_tokens(
    server: int, captured: list[dict[str, Any]]
) -> None:
    patch_httpx()
    with httpx.Client() as client:
        resp = client.post(
            f"http://{TEST_HOST}:{server}/v1/chat/completions/stream",
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
            },
        )
    assert resp.status_code == 200
    assert len(captured) == 1
    span = captured[0]
    # Synthesized from SSE chunks
    assert span["inputTokens"] == 2
    assert span["outputTokens"] == 2
    assert span["output"] == "Hi there"
    assert span["metadata"].get("stream") is True


def test_httpx_passes_non_llm_requests_through(captured: list[dict[str, Any]]) -> None:
    """Unregistered hosts must not be intercepted."""
    patch_httpx()
    httpd = HTTPServer((TEST_HOST, 0), _Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        # Note: we did NOT register TEST_HOST in this test (no `server` fixture)
        with httpx.Client() as client:
            resp = client.post(
                f"http://{TEST_HOST}:{port}/v1/chat/completions",
                json={"model": "gpt-4o-mini"},
            )
        assert resp.status_code == 200
        assert captured == []
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_requests_intercepts_openai_call(server: int, captured: list[dict[str, Any]]) -> None:
    requests = pytest.importorskip("requests")
    from agentlens.interceptors.requests_patch import patch_requests

    patch_requests()
    resp = requests.post(
        f"http://{TEST_HOST}:{server}/v1/chat/completions",
        json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp.status_code == 200
    assert len(captured) == 1
    assert captured[0]["inputTokens"] == 3
    assert captured[0]["outputTokens"] == 2


def test_traced_context_propagates_to_intercepted_span(
    server: int, captured: list[dict[str, Any]]
) -> None:
    """Span emitted from inside ``AgentLens.trace(...)`` inherits the trace's
    contextvars — verify by setting the contextvars manually (so we don't
    need a fully-initialised AgentLens singleton with a real buffer).
    """
    import uuid

    from agentlens.context import _current_span_id, _current_trace_id

    trace_id = str(uuid.uuid4())
    span_id = str(uuid.uuid4())
    t1 = _current_trace_id.set(trace_id)
    t2 = _current_span_id.set(span_id)
    try:
        patch_httpx()
        with httpx.Client() as client:
            client.post(
                f"http://{TEST_HOST}:{server}/v1/chat/completions",
                json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
            )
    finally:
        _current_span_id.reset(t2)
        _current_trace_id.reset(t1)

    assert len(captured) == 1
    assert captured[0]["traceId"] == trace_id
    assert captured[0]["parentSpanId"] == span_id
