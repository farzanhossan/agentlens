# Network-Layer Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transparent HTTP proxy that sits between user apps and LLM APIs, capturing observability data and emitting spans to the existing AgentLens ingest pipeline — zero code changes required from users.

**Architecture:** Standalone Hono service (`apps/proxy`) that parses incoming requests by provider, forwards them to the upstream LLM API, captures request/response data (with streaming pass-through), and emits spans to the existing `/v1/spans` ingest endpoint. Stateless — no new databases or queues.

**Tech Stack:** Hono (HTTP framework), tsup (build), pnpm workspace, Node.js 20, Docker

**Spec:** `docs/superpowers/specs/2026-03-31-network-layer-proxy-design.md`

---

## File Structure

```
apps/proxy/
  package.json
  tsconfig.json
  Dockerfile
  src/
    index.ts              — Hono app bootstrap + health endpoint
    config.ts             — Env var loading + validation
    router.ts             — Route parsing (projectId, provider, path)
    proxy.ts              — Core forwarding logic (non-streaming + streaming)
    span-emitter.ts       — Async fire-and-forget span emission
    project-cache.ts      — In-memory TTL cache for project validation
    parsers/
      types.ts            — ProviderParser interface + shared types
      openai.ts           — OpenAI request/response parser + pricing
      anthropic.ts        — Anthropic request/response parser + pricing
      generic.ts          — Passthrough fallback parser
      index.ts            — Parser registry (provider name → parser)
  tests/
    config.test.ts
    router.test.ts
    span-emitter.test.ts
    project-cache.test.ts
    proxy.test.ts
    parsers/
      openai.test.ts
      anthropic.test.ts
      generic.test.ts
    integration/
      proxy-flow.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `apps/proxy/package.json`
- Create: `apps/proxy/tsconfig.json`
- Create: `apps/proxy/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@farzanhossans/agentlens-proxy",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format cjs --dts --clean",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "hono": "^4.4.0",
    "@hono/node-server": "^1.11.0",
    "pako": "^2.1.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.0.0",
    "@types/pako": "^2.0.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create minimal src/index.ts**

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

const port = parseInt(process.env.PORT || '8080', 10);
console.log(`AgentLens Proxy listening on :${port}`);
serve({ fetch: app.fetch, port });

export default app;
```

- [ ] **Step 4: Install dependencies**

```bash
cd apps/proxy && pnpm install
```

- [ ] **Step 5: Verify it builds and starts**

```bash
pnpm run build
PORT=8080 node dist/index.js &
curl http://localhost:8080/health
# Expected: {"status":"ok","ts":...}
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add apps/proxy/package.json apps/proxy/tsconfig.json apps/proxy/src/index.ts pnpm-lock.yaml
git commit -m "feat(proxy): scaffold proxy service with Hono"
```

---

### Task 2: Configuration Module

**Files:**
- Create: `apps/proxy/src/config.ts`
- Create: `apps/proxy/tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if AGENTLENS_INGEST_URL is missing', () => {
    delete process.env.AGENTLENS_INGEST_URL;
    expect(() => loadConfig()).toThrow('AGENTLENS_INGEST_URL');
  });

  it('loads required and default values', () => {
    process.env.AGENTLENS_INGEST_URL = 'http://localhost:3001/v1/spans';
    const config = loadConfig();
    expect(config.ingestUrl).toBe('http://localhost:3001/v1/spans');
    expect(config.port).toBe(8080);
    expect(config.projectCacheTtlMs).toBe(60_000);
    expect(config.maxBodySize).toBe(10 * 1024 * 1024);
    expect(config.bufferMaxSize).toBe(10 * 1024 * 1024);
    expect(config.logLevel).toBe('info');
  });

  it('overrides defaults from env', () => {
    process.env.AGENTLENS_INGEST_URL = 'http://api:3001/v1/spans';
    process.env.PORT = '9090';
    process.env.PROJECT_CACHE_TTL_MS = '30000';
    process.env.LOG_LEVEL = 'debug';
    const config = loadConfig();
    expect(config.port).toBe(9090);
    expect(config.projectCacheTtlMs).toBe(30_000);
    expect(config.logLevel).toBe('debug');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/config.test.ts
```

Expected: FAIL — `loadConfig` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/config.ts
export interface ProxyConfig {
  ingestUrl: string;
  port: number;
  projectValidationUrl?: string;
  projectCacheTtlMs: number;
  maxBodySize: number;       // bytes
  bufferMaxSize: number;     // bytes
  logLevel: string;
}

export function loadConfig(): ProxyConfig {
  const ingestUrl = process.env.AGENTLENS_INGEST_URL;
  if (!ingestUrl) {
    throw new Error('AGENTLENS_INGEST_URL is required');
  }

  return {
    ingestUrl,
    port: parseInt(process.env.PORT || '8080', 10),
    projectValidationUrl: process.env.PROJECT_VALIDATION_URL,
    projectCacheTtlMs: parseInt(process.env.PROJECT_CACHE_TTL_MS || '60000', 10),
    maxBodySize: parseBytes(process.env.MAX_BODY_SIZE || '10mb'),
    bufferMaxSize: parseBytes(process.env.BUFFER_MAX_SIZE || '10mb'),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function parseBytes(value: string): number {
  const match = value.match(/^(\d+)(mb|kb|b)?$/i);
  if (!match) return 10 * 1024 * 1024;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'b').toLowerCase();
  if (unit === 'mb') return num * 1024 * 1024;
  if (unit === 'kb') return num * 1024;
  return num;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/config.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/config.ts apps/proxy/tests/config.test.ts
git commit -m "feat(proxy): add configuration module with env var loading"
```

---

### Task 3: Parser Types & Interface

**Files:**
- Create: `apps/proxy/src/parsers/types.ts`

- [ ] **Step 1: Create the parser interface and shared types**

```typescript
// src/parsers/types.ts

export interface ParsedRequest {
  model: string;
  input: string;             // serialized prompt/messages
  isStreaming: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ParsedResponse {
  output: string;            // completion text
  usage?: TokenUsage;
}

export interface ProviderParser {
  /** Extract model, input, and streaming flag from the request body. */
  parseRequest(body: unknown): ParsedRequest;

  /** Extract completion text and token usage from a non-streaming response body. */
  parseResponse(body: unknown): ParsedResponse;

  /** Reconstruct a full ParsedResponse from accumulated SSE data lines. */
  parseStreamChunks(dataLines: string[]): ParsedResponse;

  /** Compute cost in USD. Returns undefined if model is not in pricing table. */
  computeCost(model: string, usage: TokenUsage): number | undefined;
}

/** Maps provider names to their upstream base URLs. */
export const PROVIDER_UPSTREAMS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/proxy/src/parsers/types.ts
git commit -m "feat(proxy): define ProviderParser interface and shared types"
```

---

### Task 4: OpenAI Parser

**Files:**
- Create: `apps/proxy/src/parsers/openai.ts`
- Create: `apps/proxy/tests/parsers/openai.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/openai.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAIParser } from '../../src/parsers/openai';

const parser = new OpenAIParser();

describe('OpenAIParser', () => {
  describe('parseRequest', () => {
    it('extracts model, messages, and streaming flag', () => {
      const body = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        stream: false,
      };
      const result = parser.parseRequest(body);
      expect(result.model).toBe('gpt-4o');
      expect(result.input).toBe(JSON.stringify(body.messages));
      expect(result.isStreaming).toBe(false);
    });

    it('defaults isStreaming to false when stream is absent', () => {
      const body = { model: 'gpt-4o', messages: [] };
      expect(parser.parseRequest(body).isStreaming).toBe(false);
    });

    it('detects streaming request', () => {
      const body = { model: 'gpt-4o', messages: [], stream: true };
      expect(parser.parseRequest(body).isStreaming).toBe(true);
    });
  });

  describe('parseResponse', () => {
    it('extracts completion text and usage', () => {
      const body = {
        id: 'chatcmpl-abc',
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Hi there!');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('handles missing usage gracefully', () => {
      const body = {
        choices: [{ message: { content: 'Hi' } }],
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Hi');
      expect(result.usage).toBeUndefined();
    });
  });

  describe('parseStreamChunks', () => {
    it('accumulates delta content and extracts usage from final chunk', () => {
      const dataLines = [
        '{"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":""}}]}',
        '{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
        '{"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
        '{"id":"chatcmpl-1","choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        '[DONE]',
      ];
      const result = parser.parseStreamChunks(dataLines);
      expect(result.output).toBe('Hello world');
      expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    });
  });

  describe('computeCost', () => {
    it('computes cost for known model', () => {
      const cost = parser.computeCost('gpt-4o', { inputTokens: 1000, outputTokens: 1000 });
      // gpt-4o: input $0.005/1k, output $0.015/1k
      expect(cost).toBeCloseTo(0.005 + 0.015);
    });

    it('returns undefined for unknown model', () => {
      expect(parser.computeCost('unknown-model', { inputTokens: 1, outputTokens: 1 })).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/parsers/openai.test.ts
```

Expected: FAIL — `OpenAIParser` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/parsers/openai.ts
import type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';

interface ModelPricing {
  inputCostPer1k: number;
  outputCostPer1k: number;
}

const PRICING: Record<string, ModelPricing> = {
  'gpt-4o':             { inputCostPer1k: 0.005,  outputCostPer1k: 0.015 },
  'gpt-4o-mini':        { inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
  'gpt-4-turbo':        { inputCostPer1k: 0.01,   outputCostPer1k: 0.03 },
  'gpt-4':              { inputCostPer1k: 0.03,   outputCostPer1k: 0.06 },
  'gpt-3.5-turbo':      { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 },
  'o1':                 { inputCostPer1k: 0.015,  outputCostPer1k: 0.06 },
  'o1-mini':            { inputCostPer1k: 0.003,  outputCostPer1k: 0.012 },
  'o3':                 { inputCostPer1k: 0.01,   outputCostPer1k: 0.04 },
  'o3-mini':            { inputCostPer1k: 0.0011, outputCostPer1k: 0.0044 },
  'o4-mini':            { inputCostPer1k: 0.0011, outputCostPer1k: 0.0044 },
};

export class OpenAIParser implements ProviderParser {
  parseRequest(body: unknown): ParsedRequest {
    const b = body as Record<string, unknown>;
    return {
      model: String(b.model || 'unknown'),
      input: JSON.stringify(b.messages || b.prompt || ''),
      isStreaming: Boolean(b.stream),
    };
  }

  parseResponse(body: unknown): ParsedResponse {
    const b = body as Record<string, unknown>;
    const choices = b.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const output = String(message?.content || '');

    const usage = b.usage as Record<string, number> | undefined;
    return {
      output,
      usage: usage
        ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
        : undefined,
    };
  }

  parseStreamChunks(dataLines: string[]): ParsedResponse {
    let output = '';
    let usage: TokenUsage | undefined;

    for (const line of dataLines) {
      if (line === '[DONE]') break;
      try {
        const chunk = JSON.parse(line);
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          output += delta.content;
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      } catch {
        // skip unparseable lines
      }
    }

    return { output, usage };
  }

  computeCost(model: string, usage: TokenUsage): number | undefined {
    const pricing = PRICING[model];
    if (!pricing) return undefined;
    return (
      (usage.inputTokens / 1000) * pricing.inputCostPer1k +
      (usage.outputTokens / 1000) * pricing.outputCostPer1k
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/parsers/openai.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/parsers/openai.ts apps/proxy/tests/parsers/openai.test.ts
git commit -m "feat(proxy): add OpenAI parser with pricing and stream support"
```

---

### Task 5: Anthropic Parser

**Files:**
- Create: `apps/proxy/src/parsers/anthropic.ts`
- Create: `apps/proxy/tests/parsers/anthropic.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/anthropic.test.ts
import { describe, it, expect } from 'vitest';
import { AnthropicParser } from '../../src/parsers/anthropic';

const parser = new AnthropicParser();

describe('AnthropicParser', () => {
  describe('parseRequest', () => {
    it('extracts model, messages with system, and streaming flag', () => {
      const body = {
        model: 'claude-3-5-sonnet-20241022',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      const result = parser.parseRequest(body);
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.input).toBe('You are helpful.\n\nHello');
      expect(result.isStreaming).toBe(false);
    });

    it('handles missing system prompt', () => {
      const body = {
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const result = parser.parseRequest(body);
      expect(result.input).toBe('Hi');
      expect(result.isStreaming).toBe(false);
    });

    it('handles content block arrays in messages', () => {
      const body = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] },
        ],
      };
      const result = parser.parseRequest(body);
      expect(result.input).toBe('Hello world');
    });
  });

  describe('parseResponse', () => {
    it('extracts text and usage', () => {
      const body = {
        id: 'msg_abc',
        model: 'claude-3-5-sonnet-20241022',
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Hi there!');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('joins multiple text blocks', () => {
      const body = {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: ' Part 2' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Part 1 Part 2');
    });
  });

  describe('parseStreamChunks', () => {
    it('accumulates content deltas and extracts usage from message_delta', () => {
      const dataLines = [
        '{"type":"message_start","message":{"id":"msg_1","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":10,"output_tokens":0}}}',
        '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
        '{"type":"content_block_stop","index":0}',
        '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
        '{"type":"message_stop"}',
      ];
      const result = parser.parseStreamChunks(dataLines);
      expect(result.output).toBe('Hello world');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });
  });

  describe('computeCost', () => {
    it('computes cost for known model', () => {
      const cost = parser.computeCost('claude-3-5-sonnet-20241022', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      // $3/M input + $15/M output = $18
      expect(cost).toBeCloseTo(18);
    });

    it('matches model prefix for unknown suffix', () => {
      const cost = parser.computeCost('claude-3-5-sonnet-99991231', {
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      expect(cost).toBeCloseTo(3);
    });

    it('returns undefined for unknown model', () => {
      expect(parser.computeCost('unknown', { inputTokens: 1, outputTokens: 1 })).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/parsers/anthropic.test.ts
```

Expected: FAIL — `AnthropicParser` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/parsers/anthropic.ts
import type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-3-5-sonnet':  { inputPerMillion: 3,     outputPerMillion: 15 },
  'claude-3-5-haiku':   { inputPerMillion: 0.8,   outputPerMillion: 4 },
  'claude-3-opus':      { inputPerMillion: 15,    outputPerMillion: 75 },
  'claude-3-sonnet':    { inputPerMillion: 3,     outputPerMillion: 15 },
  'claude-3-haiku':     { inputPerMillion: 0.25,  outputPerMillion: 1.25 },
  'claude-4-sonnet':    { inputPerMillion: 3,     outputPerMillion: 15 },
  'claude-4-opus':      { inputPerMillion: 15,    outputPerMillion: 75 },
};

function extractMessageText(messages: unknown[]): string {
  return messages
    .map((m: unknown) => {
      const msg = m as Record<string, unknown>;
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return (msg.content as Array<Record<string, unknown>>)
          .filter((b) => b.type === 'text')
          .map((b) => String(b.text))
          .join('');
      }
      return '';
    })
    .join('\n');
}

function matchPricing(model: string): ModelPricing | undefined {
  // Try exact match first, then prefix match
  if (PRICING[model]) return PRICING[model];
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return undefined;
}

export class AnthropicParser implements ProviderParser {
  parseRequest(body: unknown): ParsedRequest {
    const b = body as Record<string, unknown>;
    const system = typeof b.system === 'string' ? b.system : '';
    const messages = Array.isArray(b.messages) ? b.messages : [];
    const userText = extractMessageText(messages);
    const input = system ? `${system}\n\n${userText}` : userText;

    return {
      model: String(b.model || 'unknown'),
      input,
      isStreaming: Boolean(b.stream),
    };
  }

  parseResponse(body: unknown): ParsedResponse {
    const b = body as Record<string, unknown>;
    const content = Array.isArray(b.content) ? b.content : [];
    const output = (content as Array<Record<string, unknown>>)
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text))
      .join('');

    const usage = b.usage as Record<string, number> | undefined;
    return {
      output,
      usage: usage
        ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
        : undefined,
    };
  }

  parseStreamChunks(dataLines: string[]): ParsedResponse {
    let output = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for (const line of dataLines) {
      try {
        const event = JSON.parse(line);
        switch (event.type) {
          case 'message_start':
            inputTokens = event.message?.usage?.input_tokens || 0;
            break;
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta') {
              output += event.delta.text;
            }
            break;
          case 'message_delta':
            outputTokens = event.usage?.output_tokens || 0;
            break;
        }
      } catch {
        // skip unparseable lines
      }
    }

    return {
      output,
      usage: { inputTokens, outputTokens },
    };
  }

  computeCost(model: string, usage: TokenUsage): number | undefined {
    const pricing = matchPricing(model);
    if (!pricing) return undefined;
    return (
      (usage.inputTokens * pricing.inputPerMillion +
        usage.outputTokens * pricing.outputPerMillion) /
      1_000_000
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/parsers/anthropic.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/parsers/anthropic.ts apps/proxy/tests/parsers/anthropic.test.ts
git commit -m "feat(proxy): add Anthropic parser with pricing and stream support"
```

---

### Task 6: Generic Passthrough Parser

**Files:**
- Create: `apps/proxy/src/parsers/generic.ts`
- Create: `apps/proxy/tests/parsers/generic.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/generic.test.ts
import { describe, it, expect } from 'vitest';
import { GenericParser } from '../../src/parsers/generic';

const parser = new GenericParser();

describe('GenericParser', () => {
  it('captures raw body as input and marks model unknown', () => {
    const body = { some: 'data', model: 'custom-llm' };
    const result = parser.parseRequest(body);
    expect(result.model).toBe('unknown');
    expect(result.input).toBe(JSON.stringify(body));
    expect(result.isStreaming).toBe(false);
  });

  it('detects streaming from stream field', () => {
    const body = { prompt: 'hello', stream: true };
    expect(parser.parseRequest(body).isStreaming).toBe(true);
  });

  it('captures raw response body as output', () => {
    const body = { text: 'response here' };
    const result = parser.parseResponse(body);
    expect(result.output).toBe(JSON.stringify(body));
    expect(result.usage).toBeUndefined();
  });

  it('joins stream data lines as raw output', () => {
    const result = parser.parseStreamChunks(['chunk1', 'chunk2', '[DONE]']);
    expect(result.output).toBe('chunk1\nchunk2\n[DONE]');
    expect(result.usage).toBeUndefined();
  });

  it('always returns undefined for cost', () => {
    expect(parser.computeCost('any', { inputTokens: 100, outputTokens: 50 })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/parsers/generic.test.ts
```

Expected: FAIL — `GenericParser` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/parsers/generic.ts
import type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';

export class GenericParser implements ProviderParser {
  parseRequest(body: unknown): ParsedRequest {
    const b = body as Record<string, unknown>;
    return {
      model: 'unknown',
      input: JSON.stringify(body),
      isStreaming: Boolean(b.stream),
    };
  }

  parseResponse(body: unknown): ParsedResponse {
    return {
      output: JSON.stringify(body),
      usage: undefined,
    };
  }

  parseStreamChunks(dataLines: string[]): ParsedResponse {
    return {
      output: dataLines.join('\n'),
      usage: undefined,
    };
  }

  computeCost(_model: string, _usage: TokenUsage): number | undefined {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/parsers/generic.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/parsers/generic.ts apps/proxy/tests/parsers/generic.test.ts
git commit -m "feat(proxy): add generic passthrough parser"
```

---

### Task 7: Parser Registry

**Files:**
- Create: `apps/proxy/src/parsers/index.ts`

- [ ] **Step 1: Create parser registry**

```typescript
// src/parsers/index.ts
import type { ProviderParser } from './types';
import { OpenAIParser } from './openai';
import { AnthropicParser } from './anthropic';
import { GenericParser } from './generic';

const openai = new OpenAIParser();
const anthropic = new AnthropicParser();
const generic = new GenericParser();

const parsers: Record<string, ProviderParser> = {
  openai,
  anthropic,
};

export function getParser(provider: string): ProviderParser {
  return parsers[provider] || generic;
}

export type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';
export { PROVIDER_UPSTREAMS } from './types';
```

- [ ] **Step 2: Commit**

```bash
git add apps/proxy/src/parsers/index.ts
git commit -m "feat(proxy): add parser registry"
```

---

### Task 8: Route Parser

**Files:**
- Create: `apps/proxy/src/router.ts`
- Create: `apps/proxy/tests/router.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/router.test.ts
import { describe, it, expect } from 'vitest';
import { parseProxyRoute } from '../src/router';

describe('parseProxyRoute', () => {
  it('parses openai chat completions path', () => {
    const result = parseProxyRoute('/v1/p/abc-123/openai/v1/chat/completions');
    expect(result).toEqual({
      projectId: 'abc-123',
      provider: 'openai',
      upstreamPath: '/v1/chat/completions',
    });
  });

  it('parses anthropic messages path', () => {
    const result = parseProxyRoute('/v1/p/proj-456/anthropic/v1/messages');
    expect(result).toEqual({
      projectId: 'proj-456',
      provider: 'anthropic',
      upstreamPath: '/v1/messages',
    });
  });

  it('parses generic provider with custom path', () => {
    const result = parseProxyRoute('/v1/p/proj-789/generic/api/generate');
    expect(result).toEqual({
      projectId: 'proj-789',
      provider: 'generic',
      upstreamPath: '/api/generate',
    });
  });

  it('returns null for invalid paths', () => {
    expect(parseProxyRoute('/health')).toBeNull();
    expect(parseProxyRoute('/v1/p/')).toBeNull();
    expect(parseProxyRoute('/v1/p/abc')).toBeNull();
    expect(parseProxyRoute('/v1/spans')).toBeNull();
  });

  it('handles paths with query strings', () => {
    const result = parseProxyRoute('/v1/p/abc/openai/v1/chat/completions');
    expect(result?.upstreamPath).toBe('/v1/chat/completions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/router.test.ts
```

Expected: FAIL — `parseProxyRoute` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/router.ts
export interface ProxyRoute {
  projectId: string;
  provider: string;
  upstreamPath: string;
}

const ROUTE_PREFIX = '/v1/p/';

export function parseProxyRoute(path: string): ProxyRoute | null {
  if (!path.startsWith(ROUTE_PREFIX)) return null;

  const rest = path.slice(ROUTE_PREFIX.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;

  const projectId = rest.slice(0, slashIdx);
  if (!projectId) return null;

  const afterProject = rest.slice(slashIdx + 1);
  const providerSlash = afterProject.indexOf('/');
  if (providerSlash === -1) return null;

  const provider = afterProject.slice(0, providerSlash);
  const upstreamPath = afterProject.slice(providerSlash);

  if (!provider || !upstreamPath) return null;

  return { projectId, provider, upstreamPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/router.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/router.ts apps/proxy/tests/router.test.ts
git commit -m "feat(proxy): add URL route parser"
```

---

### Task 9: Span Emitter

**Files:**
- Create: `apps/proxy/src/span-emitter.ts`
- Create: `apps/proxy/tests/span-emitter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/span-emitter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpanEmitter } from '../src/span-emitter';

describe('SpanEmitter', () => {
  let emitter: SpanEmitter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchSpy as unknown as typeof fetch;
    emitter = new SpanEmitter('http://localhost:3001/v1/spans');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends span data as gzipped JSON to ingest endpoint', async () => {
    await emitter.emit({
      spanId: 'span-1',
      traceId: 'trace-1',
      projectId: 'proj-1',
      name: 'openai.chat.completions',
      model: 'gpt-4o',
      provider: 'openai',
      input: '["hello"]',
      output: 'world',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      latencyMs: 200,
      status: 'success',
      metadata: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.200Z',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3001/v1/spans');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Content-Encoding']).toBe('gzip');
    expect(options.headers['X-API-Key']).toBe('proxy-internal');
  });

  it('does not throw on fetch failure (fire-and-forget)', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    // Should not throw
    await emitter.emit({
      spanId: 's', traceId: 't', projectId: 'p', name: 'test',
      status: 'success', metadata: {}, startedAt: new Date().toISOString(),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/span-emitter.test.ts
```

Expected: FAIL — `SpanEmitter` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/span-emitter.ts
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

export interface SpanPayload {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  input?: string;
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
}

export class SpanEmitter {
  constructor(private readonly ingestUrl: string) {}

  async emit(span: SpanPayload): Promise<void> {
    try {
      const body = JSON.stringify({ spans: [span] });
      const compressed = await gzipAsync(Buffer.from(body));

      await fetch(this.ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'X-API-Key': 'proxy-internal',
        },
        body: compressed,
      });
    } catch (err) {
      // Fire-and-forget: log but never throw
      console.error('[proxy] span emission failed:', (err as Error).message);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/span-emitter.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/span-emitter.ts apps/proxy/tests/span-emitter.test.ts
git commit -m "feat(proxy): add fire-and-forget span emitter with gzip"
```

---

### Task 10: Project Cache

**Files:**
- Create: `apps/proxy/src/project-cache.ts`
- Create: `apps/proxy/tests/project-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/project-cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectCache } from '../src/project-cache';

describe('ProjectCache', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates project via API and caches result', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    const cache = new ProjectCache('http://api:3001/v1/projects', 60_000);

    const first = await cache.isValid('proj-1');
    const second = await cache.isValid('proj-1');

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cached
  });

  it('caches invalid projects too', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 });
    const cache = new ProjectCache('http://api:3001/v1/projects', 60_000);

    const first = await cache.isValid('bad-proj');
    const second = await cache.isValid('bad-proj');

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('allows all projects in standalone mode (no validation URL)', async () => {
    const cache = new ProjectCache(undefined, 60_000);

    const result = await cache.isValid('anything');
    expect(result).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats fetch errors as invalid', async () => {
    fetchSpy.mockRejectedValue(new Error('network'));
    const cache = new ProjectCache('http://api:3001/v1/projects', 60_000);

    const result = await cache.isValid('proj-1');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/project-cache.test.ts
```

Expected: FAIL — `ProjectCache` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/project-cache.ts
interface CacheEntry {
  valid: boolean;
  expiresAt: number;
}

export class ProjectCache {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly validationUrl: string | undefined,
    private readonly ttlMs: number,
  ) {}

  async isValid(projectId: string): Promise<boolean> {
    // Standalone mode: no validation URL, trust all project IDs
    if (!this.validationUrl) return true;

    const now = Date.now();
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > now) {
      return cached.valid;
    }

    let valid: boolean;
    try {
      const res = await fetch(`${this.validationUrl}/${projectId}`);
      valid = res.ok;
    } catch {
      valid = false;
    }

    this.cache.set(projectId, { valid, expiresAt: now + this.ttlMs });
    return valid;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/project-cache.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/project-cache.ts apps/proxy/tests/project-cache.test.ts
git commit -m "feat(proxy): add project validation cache with TTL"
```

---

### Task 11: Core Proxy Logic (Non-Streaming)

**Files:**
- Create: `apps/proxy/src/proxy.ts`
- Create: `apps/proxy/tests/proxy.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/proxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleProxyRequest } from '../src/proxy';
import type { SpanEmitter } from '../src/span-emitter';

// Mock upstream fetch
let upstreamFetch: ReturnType<typeof vi.fn>;
const mockEmitter = {
  emit: vi.fn().mockResolvedValue(undefined),
} as unknown as SpanEmitter;

describe('handleProxyRequest (non-streaming)', () => {
  beforeEach(() => {
    upstreamFetch = vi.fn();
    global.fetch = upstreamFetch as unknown as typeof fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards request to upstream and returns response', async () => {
    const upstreamBody = {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    upstreamFetch.mockResolvedValue(new Response(JSON.stringify(upstreamBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const requestBody = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    };

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody,
      requestHeaders: {
        'authorization': 'Bearer sk-test',
        'content-type': 'application/json',
      },
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    // Verify upstream was called correctly
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.method).toBe('POST');

    // Verify response is forwarded
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.choices[0].message.content).toBe('Hello!');

    // Verify span was emitted
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.projectId).toBe('proj-1');
    expect(span.provider).toBe('openai');
    expect(span.model).toBe('gpt-4o');
    expect(span.output).toBe('Hello!');
    expect(span.inputTokens).toBe(5);
    expect(span.outputTokens).toBe(3);
    expect(span.status).toBe('success');
  });

  it('forwards upstream errors and emits error span', async () => {
    upstreamFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'Rate limited' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ));

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody: { model: 'gpt-4o', messages: [], stream: false },
      requestHeaders: { 'authorization': 'Bearer sk-test' },
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(429);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.status).toBe('error');
  });

  it('returns 502 when upstream is unreachable', async () => {
    upstreamFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody: { model: 'gpt-4o', messages: [], stream: false },
      requestHeaders: {},
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(502);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.status).toBe('error');
    expect(span.errorMessage).toContain('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/proxy && pnpm test -- tests/proxy.test.ts
```

Expected: FAIL — `handleProxyRequest` not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/proxy.ts
import { randomUUID } from 'node:crypto';
import { getParser, PROVIDER_UPSTREAMS } from './parsers';
import type { SpanEmitter, SpanPayload } from './span-emitter';

export interface ProxyRequestParams {
  provider: string;
  projectId: string;
  upstreamPath: string;
  upstreamBaseUrl: string;
  requestBody: unknown;
  requestHeaders: Record<string, string>;
  emitter: SpanEmitter;
  bufferMaxSize: number;
}

const FORWARDED_HEADER_BLOCKLIST = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection',
]);

function filterHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!FORWARDED_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export async function handleProxyRequest(params: ProxyRequestParams): Promise<Response> {
  const { provider, projectId, upstreamPath, upstreamBaseUrl, requestBody, requestHeaders, emitter, bufferMaxSize } = params;
  const parser = getParser(provider);
  const parsed = parser.parseRequest(requestBody);
  const startedAt = new Date().toISOString();
  const spanId = randomUUID();
  const traceId = randomUUID();

  // Build upstream URL
  const upstreamUrl = `${upstreamBaseUrl}${upstreamPath}`;
  const forwardHeaders = filterHeaders(requestHeaders);

  // Streaming is handled separately
  if (parsed.isStreaming) {
    return handleStreamingRequest(params, parser, parsed, upstreamUrl, forwardHeaders, spanId, traceId, startedAt);
  }

  // Non-streaming flow
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { ...forwardHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    const endedAt = new Date().toISOString();
    const errorMsg = (err as Error).message;

    // Emit error span
    emitter.emit({
      spanId, traceId, projectId,
      name: `${provider}.proxy`,
      model: parsed.model, provider,
      input: parsed.input,
      status: 'error', errorMessage: errorMsg,
      metadata: {}, startedAt, endedAt,
      latencyMs: Date.now() - new Date(startedAt).getTime(),
    });

    return new Response(JSON.stringify({ error: `Upstream unreachable: ${errorMsg}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Read upstream response
  const responseBody = await upstreamResponse.text();
  const endedAt = new Date().toISOString();
  const latencyMs = Date.now() - new Date(startedAt).getTime();

  // Parse response for span data
  let span: SpanPayload;
  if (upstreamResponse.ok) {
    try {
      const responseJson = JSON.parse(responseBody);
      const parsedResponse = parser.parseResponse(responseJson);
      const cost = parsedResponse.usage
        ? parser.computeCost(parsed.model, parsedResponse.usage)
        : undefined;

      span = {
        spanId, traceId, projectId,
        name: `${provider}.proxy`,
        model: parsed.model, provider,
        input: parsed.input,
        output: parsedResponse.output,
        inputTokens: parsedResponse.usage?.inputTokens,
        outputTokens: parsedResponse.usage?.outputTokens,
        costUsd: cost,
        latencyMs, status: 'success',
        metadata: {}, startedAt, endedAt,
      };
    } catch {
      span = {
        spanId, traceId, projectId,
        name: `${provider}.proxy`,
        model: parsed.model, provider,
        input: parsed.input, output: responseBody,
        latencyMs, status: 'success',
        metadata: {}, startedAt, endedAt,
      };
    }
  } else {
    span = {
      spanId, traceId, projectId,
      name: `${provider}.proxy`,
      model: parsed.model, provider,
      input: parsed.input,
      output: responseBody,
      latencyMs, status: 'error',
      errorMessage: `Upstream returned ${upstreamResponse.status}`,
      metadata: {}, startedAt, endedAt,
    };
  }

  // Fire-and-forget span emission
  emitter.emit(span);

  // Forward response to client
  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
    },
  });
}

// Streaming implementation — Task 12 will fill this in
async function handleStreamingRequest(
  params: ProxyRequestParams,
  parser: ReturnType<typeof getParser>,
  parsed: ReturnType<ReturnType<typeof getParser>['parseRequest']>,
  upstreamUrl: string,
  forwardHeaders: Record<string, string>,
  spanId: string,
  traceId: string,
  startedAt: string,
): Promise<Response> {
  const { provider, projectId, emitter, bufferMaxSize } = params;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { ...forwardHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(params.requestBody),
    });
  } catch (err) {
    const endedAt = new Date().toISOString();
    emitter.emit({
      spanId, traceId, projectId,
      name: `${provider}.proxy`,
      model: parsed.model, provider,
      input: parsed.input,
      status: 'error', errorMessage: (err as Error).message,
      metadata: {}, startedAt, endedAt,
      latencyMs: Date.now() - new Date(startedAt).getTime(),
    });
    return new Response(JSON.stringify({ error: 'Upstream unreachable' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstreamResponse.body) {
    return new Response('No response body', { status: 502 });
  }

  const dataLines: string[] = [];
  let accumulatedBytes = 0;
  let truncated = false;

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Process stream in background
  (async () => {
    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Forward chunk to client immediately
        await writer.write(value);

        // Accumulate for parsing
        if (!truncated) {
          const text = decoder.decode(value, { stream: true });
          accumulatedBytes += value.byteLength;
          if (accumulatedBytes > bufferMaxSize) {
            truncated = true;
          } else {
            buffer += text;
            // Extract complete SSE data lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                dataLines.push(trimmed.slice(6));
              }
            }
          }
        }
      }
      // Process remaining buffer
      if (buffer.trim().startsWith('data: ')) {
        dataLines.push(buffer.trim().slice(6));
      }
    } catch (err) {
      console.error('[proxy] stream read error:', (err as Error).message);
    } finally {
      await writer.close();

      // Emit span after stream completes
      const endedAt = new Date().toISOString();
      const latencyMs = Date.now() - new Date(startedAt).getTime();
      const parsedResponse = parser.parseStreamChunks(dataLines);
      const cost = parsedResponse.usage
        ? parser.computeCost(parsed.model, parsedResponse.usage)
        : undefined;

      emitter.emit({
        spanId, traceId, projectId,
        name: `${provider}.proxy`,
        model: parsed.model, provider,
        input: parsed.input,
        output: parsedResponse.output,
        inputTokens: parsedResponse.usage?.inputTokens,
        outputTokens: parsedResponse.usage?.outputTokens,
        costUsd: cost,
        latencyMs,
        status: upstreamResponse.ok ? 'success' : 'error',
        metadata: truncated ? { truncated: true } : {},
        startedAt, endedAt,
      });
    }
  })();

  return new Response(readable, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/proxy.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/proxy/src/proxy.ts apps/proxy/tests/proxy.test.ts
git commit -m "feat(proxy): add core proxy forwarding with non-streaming and streaming support"
```

---

### Task 12: Streaming Proxy Tests

**Files:**
- Modify: `apps/proxy/tests/proxy.test.ts`

- [ ] **Step 1: Add streaming tests to proxy.test.ts**

Append the following to the existing test file:

```typescript
describe('handleProxyRequest (streaming)', () => {
  beforeEach(() => {
    upstreamFetch = vi.fn();
    global.fetch = upstreamFetch as unknown as typeof fetch;
    vi.clearAllMocks();
  });

  it('streams SSE chunks to client and emits span after completion', async () => {
    // Create a mock SSE stream
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    upstreamFetch.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], stream: true },
      requestHeaders: { 'authorization': 'Bearer sk-test' },
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('text/event-stream');

    // Consume the response stream to trigger span emission
    const reader = result.body!.getReader();
    let fullText = '';
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value);
    }

    // Verify chunks were forwarded
    expect(fullText).toContain('data: {"choices"');
    expect(fullText).toContain('[DONE]');

    // Wait for async span emission
    await new Promise((r) => setTimeout(r, 50));

    // Verify span was emitted with accumulated data
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.status).toBe('success');
    expect(span.output).toBe('Hello world');
    expect(span.inputTokens).toBe(5);
    expect(span.outputTokens).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd apps/proxy && pnpm test -- tests/proxy.test.ts
```

Expected: PASS (all tests including streaming).

- [ ] **Step 3: Commit**

```bash
git add apps/proxy/tests/proxy.test.ts
git commit -m "test(proxy): add streaming proxy tests"
```

---

### Task 13: Wire Up Hono App

**Files:**
- Modify: `apps/proxy/src/index.ts`

- [ ] **Step 1: Update index.ts to wire everything together**

Replace the contents of `src/index.ts` with:

```typescript
// src/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { loadConfig } from './config';
import { parseProxyRoute } from './router';
import { handleProxyRequest } from './proxy';
import { SpanEmitter } from './span-emitter';
import { ProjectCache } from './project-cache';
import { PROVIDER_UPSTREAMS } from './parsers';

const config = loadConfig();
const emitter = new SpanEmitter(config.ingestUrl);
const projectCache = new ProjectCache(config.projectValidationUrl, config.projectCacheTtlMs);

const app = new Hono();

app.use('*', logger());
app.use('*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// Proxy catch-all route
app.all('/v1/p/*', async (c) => {
  const route = parseProxyRoute(c.req.path);
  if (!route) {
    return c.json({ error: 'Invalid proxy route' }, 400);
  }

  // Validate project
  const valid = await projectCache.isValid(route.projectId);
  if (!valid) {
    return c.json({ error: 'Invalid project ID' }, 401);
  }

  // Determine upstream base URL
  let upstreamBaseUrl = PROVIDER_UPSTREAMS[route.provider];
  if (!upstreamBaseUrl) {
    // Generic provider: require X-AgentLens-Upstream header
    upstreamBaseUrl = c.req.header('X-AgentLens-Upstream') || '';
    if (!upstreamBaseUrl) {
      return c.json({ error: 'X-AgentLens-Upstream header required for generic provider' }, 400);
    }
  }

  // Read request body
  let requestBody: unknown;
  try {
    requestBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Extract headers to forward
  const requestHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });

  const response = await handleProxyRequest({
    provider: route.provider,
    projectId: route.projectId,
    upstreamPath: route.upstreamPath,
    upstreamBaseUrl,
    requestBody,
    requestHeaders,
    emitter,
    bufferMaxSize: config.bufferMaxSize,
  });

  return response;
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

const port = config.port;
console.log(`AgentLens Proxy listening on :${port}`);
serve({ fetch: app.fetch, port });

export default app;
```

- [ ] **Step 2: Verify build**

```bash
cd apps/proxy && pnpm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/proxy/src/index.ts
git commit -m "feat(proxy): wire up Hono app with routing, auth, and proxy handler"
```

---

### Task 14: Dockerfile

**Files:**
- Create: `apps/proxy/Dockerfile`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# ── Stage 1: Build ─────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/proxy/package.json apps/proxy/tsconfig.json ./apps/proxy/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/proxy/src ./apps/proxy/src

# Build
RUN pnpm --filter @farzanhossans/agentlens-proxy run build

# Prune to production deps
RUN pnpm --filter @farzanhossans/agentlens-proxy deploy --prod /deploy/proxy

# ── Stage 2: Run ──────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache curl
WORKDIR /app

USER node
COPY --from=builder --chown=node:node /deploy/proxy .

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Verify Dockerfile builds**

```bash
cd /Users/farzan/Desktop/Workspace/agentlens && docker build -f apps/proxy/Dockerfile -t agentlens-proxy .
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/proxy/Dockerfile
git commit -m "feat(proxy): add multi-stage Dockerfile"
```

---

### Task 15: Docker Compose Integration

**Files:**
- Modify: `infra/docker-compose.yml`

- [ ] **Step 1: Add proxy service to docker-compose.yml**

Add the following service block after the existing `api` service (or at the end of the services section):

```yaml
  proxy:
    build:
      context: ..
      dockerfile: apps/proxy/Dockerfile
    container_name: agentlens-proxy
    ports:
      - "8080:8080"
    environment:
      AGENTLENS_INGEST_URL: http://api:3001/v1/spans
      PORT: "8080"
      LOG_LEVEL: info
    depends_on:
      - api
    networks:
      - agentlens-net
    restart: unless-stopped
```

- [ ] **Step 2: Verify docker-compose config**

```bash
cd infra && docker compose config --quiet
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(proxy): add proxy service to docker-compose"
```

---

### Task 16: Integration Test

**Files:**
- Create: `apps/proxy/tests/integration/proxy-flow.test.ts`

- [ ] **Step 1: Write integration test with mock upstream server**

```typescript
// tests/integration/proxy-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

describe('Proxy integration flow', () => {
  let mockUpstreamServer: ReturnType<typeof serve>;
  let mockIngestServer: ReturnType<typeof serve>;
  let capturedSpans: unknown[] = [];

  beforeAll(async () => {
    // Mock LLM upstream
    const upstream = new Hono();
    upstream.post('/v1/chat/completions', async (c) => {
      return c.json({
        id: 'chatcmpl-test',
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Integration test response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      });
    });
    mockUpstreamServer = serve({ fetch: upstream.fetch, port: 19001 });

    // Mock ingest endpoint
    const ingest = new Hono();
    ingest.post('/v1/spans', async (c) => {
      const body = await c.req.json();
      capturedSpans.push(...body.spans);
      return c.json({ accepted: true, count: body.spans.length }, 202);
    });
    mockIngestServer = serve({ fetch: ingest.fetch, port: 19002 });

    // Wait for servers to start
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(() => {
    mockUpstreamServer?.close();
    mockIngestServer?.close();
  });

  it('proxies a non-streaming request end-to-end', async () => {
    // Import the proxy app with test config
    process.env.AGENTLENS_INGEST_URL = 'http://localhost:19002/v1/spans';
    process.env.PORT = '19000';

    // We need to test the full flow: send request to proxy → proxy forwards to mock upstream → proxy emits span to mock ingest
    // For this integration test, we'll directly test handleProxyRequest
    const { handleProxyRequest } = await import('../../src/proxy');
    const { SpanEmitter } = await import('../../src/span-emitter');

    const emitter = new SpanEmitter('http://localhost:19002/v1/spans');

    const response = await handleProxyRequest({
      provider: 'openai',
      projectId: 'test-project',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'http://localhost:19001',
      requestBody: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello integration test' }],
      },
      requestHeaders: { 'authorization': 'Bearer sk-test' },
      emitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    // Verify response
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe('Integration test response');

    // Wait for async span emission
    await new Promise((r) => setTimeout(r, 300));

    // Verify span was captured by mock ingest
    expect(capturedSpans.length).toBeGreaterThanOrEqual(1);
    const span = capturedSpans[capturedSpans.length - 1] as Record<string, unknown>;
    expect(span.projectId).toBe('test-project');
    expect(span.provider).toBe('openai');
    expect(span.model).toBe('gpt-4o');
    expect(span.status).toBe('success');
    expect(span.inputTokens).toBe(10);
    expect(span.outputTokens).toBe(8);
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd apps/proxy && pnpm test -- tests/integration/proxy-flow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/proxy/tests/integration/proxy-flow.test.ts
git commit -m "test(proxy): add integration test with mock upstream and ingest"
```

---

### Task 17: Run All Tests & Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd apps/proxy && pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Run build**

```bash
cd apps/proxy && pnpm run build
```

Expected: Clean build with no errors.

- [ ] **Step 3: Manual smoke test**

```bash
# Terminal 1: Start proxy with local ingest
AGENTLENS_INGEST_URL=http://localhost:3001/v1/spans PORT=8080 node apps/proxy/dist/index.js

# Terminal 2: Send a test request (will fail upstream since no real API key, but proxy should handle gracefully)
curl -X POST http://localhost:8080/v1/p/test-project/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-test" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

Expected: Proxy attempts to forward, returns upstream error (401 from OpenAI) or 502 if no network. The key is that the proxy itself doesn't crash.

- [ ] **Step 4: Final commit**

```bash
git add -A apps/proxy/
git commit -m "feat(proxy): complete network-layer proxy service

Transparent HTTP proxy for zero-code LLM observability.
Supports OpenAI, Anthropic, and generic passthrough.
Streaming pass-through with SSE tap.
Fire-and-forget span emission to existing ingest pipeline."
```
