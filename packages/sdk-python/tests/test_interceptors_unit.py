"""Unit tests for the network-layer interceptor pieces (registry, parsers,
streaming) — no HTTP required.
"""

from __future__ import annotations

from agentlens.interceptors.parsers import parse_span
from agentlens.interceptors.registry import LLM_REGISTRY, match_llm
from agentlens.interceptors.streaming import synthesize_streaming_response


class TestRegistry:
    def test_matches_openai_chat_endpoint(self) -> None:
        m = match_llm("https://api.openai.com/v1/chat/completions")
        assert m is not None
        assert m.provider == "openai"

    def test_matches_anthropic_messages(self) -> None:
        m = match_llm("https://api.anthropic.com/v1/messages")
        assert m is not None
        assert m.parser == "anthropic"

    def test_matches_gemini_models(self) -> None:
        m = match_llm(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        )
        assert m is not None
        assert m.parser == "gemini"

    def test_matches_cohere_v2_chat(self) -> None:
        m = match_llm("https://api.cohere.com/v2/chat")
        assert m is not None

    def test_matches_mistral(self) -> None:
        m = match_llm("https://api.mistral.ai/v1/chat/completions")
        assert m is not None

    def test_unknown_host_returns_none(self) -> None:
        assert match_llm("https://example.com/v1/chat/completions") is None

    def test_known_host_unknown_path_returns_none(self) -> None:
        assert match_llm("https://api.openai.com/v1/files") is None

    def test_garbage_url_returns_none(self) -> None:
        assert match_llm("not a url") is None

    def test_registry_has_all_five_providers(self) -> None:
        providers = {entry.provider for entry in LLM_REGISTRY.values()}
        assert providers == {"openai", "anthropic", "gemini", "cohere", "mistral"}


class TestParsers:
    def test_openai_extracts_text_and_tokens(self) -> None:
        req = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]}
        resp = {
            "model": "gpt-4o-mini",
            "choices": [{"message": {"content": "hello"}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4},
        }
        s = parse_span("openai", req, resp, False)
        assert s.input_text == "hi"
        assert s.output_text == "hello"
        assert s.input_tokens == 3
        assert s.output_tokens == 1
        assert s.cost_usd > 0

    def test_openai_version_suffix_falls_back_to_prefix_pricing(self) -> None:
        resp = {
            "model": "gpt-4o-2024-08-06",
            "usage": {"prompt_tokens": 1000, "completion_tokens": 1000},
        }
        s = parse_span("openai", {}, resp, False)
        # gpt-4o pricing (0.0000025 input, 0.000010 output) per token
        assert s.cost_usd > 0

    def test_anthropic_extracts_content_blocks(self) -> None:
        req = {
            "model": "claude-3-5-sonnet-20240620",
            "messages": [{"role": "user", "content": "yo"}],
        }
        resp = {
            "model": "claude-3-5-sonnet-20240620",
            "content": [{"type": "text", "text": "hi back"}],
            "usage": {"input_tokens": 5, "output_tokens": 2},
        }
        s = parse_span("anthropic", req, resp, False)
        assert s.output_text == "hi back"
        assert s.input_tokens == 5
        assert s.output_tokens == 2

    def test_gemini_extracts_candidates_parts(self) -> None:
        req = {"model": "gemini-1.5-flash", "contents": [{"parts": [{"text": "ping"}]}]}
        resp = {
            "modelVersion": "gemini-1.5-flash",
            "candidates": [{"content": {"parts": [{"text": "pong"}]}}],
            "usageMetadata": {
                "promptTokenCount": 1,
                "candidatesTokenCount": 1,
                "totalTokenCount": 2,
            },
        }
        s = parse_span("gemini", req, resp, False)
        assert s.input_text == "ping"
        assert s.output_text == "pong"
        assert s.input_tokens == 1

    def test_cohere_v1_meta_billed_units(self) -> None:
        resp = {"text": "ok", "meta": {"billed_units": {"input_tokens": 2, "output_tokens": 1}}}
        s = parse_span("cohere", {"model": "command-r"}, resp, False)
        assert s.output_text == "ok"
        assert s.input_tokens == 2

    def test_cohere_v2_usage_tokens(self) -> None:
        resp = {
            "message": {"content": [{"text": "hey"}]},
            "usage": {"tokens": {"input_tokens": 3, "output_tokens": 1}},
        }
        s = parse_span("cohere", {"model": "command-r"}, resp, False)
        assert s.output_text == "hey"
        assert s.input_tokens == 3

    def test_mistral_uses_openai_shape(self) -> None:
        resp = {
            "model": "mistral-small",
            "choices": [{"message": {"content": "salut"}}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 1},
        }
        s = parse_span("mistral", {"model": "mistral-small"}, resp, False)
        assert s.provider == "mistral"
        assert s.output_text == "salut"
        assert s.input_tokens == 4


class TestStreamingSynthesis:
    def test_openai_sse_round_trip(self) -> None:
        raw = (
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\n'
            'data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n'
            "data: [DONE]\n\n"
        )
        resp = synthesize_streaming_response(raw, "openai", {"model": "gpt-4o-mini"})
        assert resp["choices"][0]["message"]["content"] == "Hello world"
        assert resp["usage"]["prompt_tokens"] == 5
        assert resp["usage"]["completion_tokens"] == 2

    def test_anthropic_sse_round_trip(self) -> None:
        raw = (
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n'
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n'
            'data: {"type":"message_delta","usage":{"input_tokens":4,"output_tokens":2}}\n\n'
        )
        resp = synthesize_streaming_response(raw, "anthropic", {"model": "claude-3-5-sonnet"})
        assert resp["content"][0]["text"] == "Hi there"
        assert resp["usage"]["input_tokens"] == 4
        assert resp["usage"]["output_tokens"] == 2

    def test_gemini_sse_round_trip(self) -> None:
        raw = (
            'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n'
            'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}],'
            '"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\n\n'
        )
        resp = synthesize_streaming_response(raw, "gemini", {"model": "gemini-1.5-flash"})
        assert resp["candidates"][0]["content"]["parts"][0]["text"] == "Hello"
        assert resp["usageMetadata"]["promptTokenCount"] == 3
        assert resp["usageMetadata"]["candidatesTokenCount"] == 2

    def test_cohere_v1_ndjson_round_trip(self) -> None:
        raw = (
            '{"event_type":"text-generation","text":"Hel"}\n'
            '{"event_type":"text-generation","text":"lo"}\n'
            '{"event_type":"stream-end","response":{"text":"Hello","meta":{"billed_units":{"input_tokens":2,"output_tokens":2}}}}\n'
        )
        resp = synthesize_streaming_response(raw, "cohere", {"model": "command-r"})
        assert resp["text"] == "Hello"
        assert resp["meta"]["billed_units"]["input_tokens"] == 2

    def test_cohere_v2_sse_round_trip(self) -> None:
        raw = (
            "event: content-delta\n"
            'data: {"delta":{"message":{"content":{"text":"Hey"}}}}\n\n'
            "event: message-end\n"
            'data: {"delta":{"usage":{"tokens":{"input_tokens":1,"output_tokens":1}}}}\n\n'
        )
        resp = synthesize_streaming_response(raw, "cohere", {"model": "command-r"})
        assert resp["text"] == "Hey"
        assert resp["meta"]["billed_units"]["input_tokens"] == 1

    def test_mistral_reuses_openai_shape(self) -> None:
        raw = (
            'data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\n'
            'data: {"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n'
            "data: [DONE]\n\n"
        )
        resp = synthesize_streaming_response(raw, "mistral", {"model": "mistral-small"})
        assert resp["choices"][0]["message"]["content"] == "Bonjour"
        assert resp["usage"]["prompt_tokens"] == 2
