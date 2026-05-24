# farzanhossans-agentlens

Python SDK for [AgentLens](https://agentlens.dev) — AI agent observability.

Distribution name: `farzanhossans-agentlens` (PyPI). Import path: `agentlens`.

## Installation

```bash
pip install farzanhossans-agentlens
```

## Quick start — one line auto-traces every LLM call

```python
from agentlens import AgentLens

AgentLens.init(api_key="proj_xxx.hmac", project_id="<your-project-uuid>")

# That's it — every httpx / requests call to OpenAI, Anthropic, Gemini,
# Cohere, or Mistral is now traced automatically. No decorators needed.
```

## Grouping calls with `trace()`

```python
with AgentLens.trace("classify-intent") as span:
    result = call_llm(prompt)
    span.set_output(result)
```

## Optional extras

```bash
pip install farzanhossans-agentlens[requests]   # requests support (httpx is built-in)
pip install farzanhossans-agentlens[openai]     # SDK-level OpenAI patcher
pip install farzanhossans-agentlens[anthropic]  # SDK-level Anthropic patcher
pip install farzanhossans-agentlens[all]        # everything
```

## Documentation

Full documentation at [docs.agentlens.dev](https://docs.agentlens.dev).
