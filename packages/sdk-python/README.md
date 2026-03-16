# agentlens

Python SDK for [AgentLens](https://agentlens.dev) — AI agent observability.

## Installation

```bash
pip install agentlens
```

## Quick start

```python
from agentlens import AgentLens

AgentLens.init(api_key="proj_xxx.hmac", project_id="<your-project-uuid>")

with AgentLens.trace("classify-intent") as span:
    result = call_llm(prompt)
    span.set_output(result)
```

## Auto-instrumentation

```python
# Patch OpenAI automatically (install agentlens[openai])
import agentlens.patchers.openai

# Patch Anthropic automatically (install agentlens[anthropic])
import agentlens.patchers.anthropic
```

## Documentation

Full documentation at [docs.agentlens.dev](https://docs.agentlens.dev).
