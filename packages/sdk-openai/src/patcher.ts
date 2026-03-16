import type OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import type { Completion, CompletionCreateParamsNonStreaming } from 'openai/resources/completions';
import type { CreateEmbeddingResponse, EmbeddingCreateParams } from 'openai/resources/embeddings';
import type { Stream } from 'openai/streaming';
import { v4 as uuidv4 } from 'uuid';
import { AgentLens, Span, getCurrentSpanId, getCurrentTraceId } from '@agentlens/core';
import { calculateCost } from './pricing.js';

// ── Patch bookkeeping ─────────────────────────────────────────────────────────

type AnyFn = (...args: unknown[]) => unknown;

interface PatchRecord {
  proto: object;
  method: string;
  original: AnyFn;
}

/** @internal Exposed so tests can replace record.original with a mock. */
export const patches: PatchRecord[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when the SDK is ready; logs a warning and returns false otherwise. */
function isReady(): boolean {
  if (AgentLens._isInitialized()) return true;
  // eslint-disable-next-line no-console
  console.warn(
    '[AgentLens] @agentlens/openai is loaded but AgentLens.init() has not been called. ' +
      'OpenAI calls will not be traced.',
  );
  return false;
}

/** Creates a raw Span and resolves the trace/parent context from AsyncLocalStorage. */
function makeSpan(name: string): Span | null {
  const projectId = AgentLens._getProjectId();
  if (!projectId) return null;

  const traceId = getCurrentTraceId() ?? uuidv4();
  const parentSpanId = getCurrentSpanId();
  return new Span(uuidv4(), traceId, name, projectId, parentSpanId);
}

/** Ends the span and pushes it via the internal sink (applies PII redaction). */
function finishSpan(span: Span): void {
  span.end();
  AgentLens._pushSpan(span.toJSON());
}

/**
 * Wraps an OpenAI streaming `Stream` and intercepts it to accumulate the full
 * output text, then ends the span when the stream is exhausted or throws.
 */
async function* wrapChatStream(
  span: Span,
  stream: Stream<ChatCompletionChunk>,
  model: string,
): AsyncGenerator<ChatCompletionChunk> {
  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      content += delta;

      // OpenAI may send usage in the last chunk when stream_options.include_usage=true
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? 0;
        completionTokens = chunk.usage.completion_tokens ?? 0;
      }

      yield chunk;
    }

    if (content) span.setOutput(content);
    if (promptTokens || completionTokens) {
      const cost = calculateCost(model, promptTokens, completionTokens);
      span.setTokens(promptTokens, completionTokens, cost);
    }
  } catch (err) {
    span.setError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    finishSpan(span);
  }
}

// ── chat.completions.create ───────────────────────────────────────────────────

type ChatCreate = {
  (
    params: ChatCompletionCreateParamsNonStreaming,
    options?: OpenAI.RequestOptions,
  ): Promise<ChatCompletion>;
  (
    params: ChatCompletionCreateParamsStreaming,
    options?: OpenAI.RequestOptions,
  ): Promise<Stream<ChatCompletionChunk>>;
  (
    params: ChatCompletionCreateParamsBase,
    options?: OpenAI.RequestOptions,
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
};

function patchChatCompletions(proto: object): void {
  // Push the record first so tests can replace record.original after patch()
  const record: PatchRecord = {
    proto,
    method: 'create',
    original: (proto as Record<string, AnyFn>)['create'],
  };
  patches.push(record);

  const patched = async function (
    this: unknown,
    params: ChatCompletionCreateParamsBase,
    options?: OpenAI.RequestOptions,
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
    if (!isReady()) {
      return (record.original as ChatCreate).call(this, params as ChatCompletionCreateParamsNonStreaming, options);
    }

    const span = makeSpan('openai.chat.completions');
    if (!span) {
      return (record.original as ChatCreate).call(this, params as ChatCompletionCreateParamsNonStreaming, options);
    }

    span.setModel(params.model, 'openai');
    if (params.messages) {
      span.setInput(JSON.stringify(params.messages));
    }

    // ── Streaming branch ────────────────────────────────────────────────────
    if ((params as { stream?: boolean }).stream === true) {
      let rawStream: Stream<ChatCompletionChunk>;
      try {
        rawStream = (await (record.original as ChatCreate).call(
          this,
          params as ChatCompletionCreateParamsStreaming,
          options,
        )) as Stream<ChatCompletionChunk>;
      } catch (err) {
        span.setError(err instanceof Error ? err : new Error(String(err)));
        finishSpan(span);
        throw err;
      }

      // Return a wrapped async generator. The span ends when the generator is
      // exhausted — matching the true lifetime of the streaming call.
      return wrapChatStream(span, rawStream, params.model) as unknown as Stream<ChatCompletionChunk>;
    }

    // ── Non-streaming branch ────────────────────────────────────────────────
    try {
      const result = (await (record.original as ChatCreate).call(
        this,
        params as ChatCompletionCreateParamsNonStreaming,
        options,
      )) as ChatCompletion;

      const choice = result.choices[0];
      if (choice?.message.content) span.setOutput(choice.message.content);
      if (result.usage) {
        const { prompt_tokens, completion_tokens } = result.usage;
        const cost = calculateCost(result.model, prompt_tokens, completion_tokens);
        span.setTokens(prompt_tokens, completion_tokens, cost);
      }

      return result;
    } catch (err) {
      span.setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      finishSpan(span);
    }
  };

  (proto as Record<string, unknown>)['create'] = patched as unknown as ChatCreate;
}

// ── completions.create (legacy) ───────────────────────────────────────────────

function patchLegacyCompletions(proto: object): void {
  const record: PatchRecord = {
    proto,
    method: 'create',
    original: (proto as Record<string, AnyFn>)['create'],
  };
  patches.push(record);

  const patched = async function (
    this: unknown,
    params: CompletionCreateParamsNonStreaming,
    options?: OpenAI.RequestOptions,
  ): Promise<Completion> {
    if (!isReady()) {
      return record.original.call(this, params, options) as Promise<Completion>;
    }

    const span = makeSpan('openai.completions');
    if (!span) return record.original.call(this, params, options) as Promise<Completion>;

    span.setModel(params.model, 'openai');
    if (params.prompt && typeof params.prompt === 'string') {
      span.setInput(params.prompt);
    }

    try {
      const result = (await record.original.call(this, params, options)) as Completion;
      const text = result.choices[0]?.text;
      if (text) span.setOutput(text);
      if (result.usage) {
        const { prompt_tokens, completion_tokens } = result.usage;
        const cost = calculateCost(result.model, prompt_tokens, completion_tokens);
        span.setTokens(prompt_tokens, completion_tokens, cost);
      }
      return result;
    } catch (err) {
      span.setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      finishSpan(span);
    }
  };

  (proto as Record<string, unknown>)['create'] = patched;
}

// ── embeddings.create ─────────────────────────────────────────────────────────

function patchEmbeddings(proto: object): void {
  const record: PatchRecord = {
    proto,
    method: 'create',
    original: (proto as Record<string, AnyFn>)['create'],
  };
  patches.push(record);

  const patched = async function (
    this: unknown,
    params: EmbeddingCreateParams,
    options?: OpenAI.RequestOptions,
  ): Promise<CreateEmbeddingResponse> {
    if (!isReady()) {
      return record.original.call(this, params, options) as Promise<CreateEmbeddingResponse>;
    }

    const span = makeSpan('openai.embeddings');
    if (!span) return record.original.call(this, params, options) as Promise<CreateEmbeddingResponse>;

    span.setModel(params.model, 'openai');
    if (typeof params.input === 'string') {
      span.setInput(params.input);
    } else if (Array.isArray(params.input)) {
      span.setInput(JSON.stringify(params.input));
    }

    try {
      const result = (await record.original.call(
        this,
        params,
        options,
      )) as CreateEmbeddingResponse;
      if (result.usage) {
        const cost = calculateCost(params.model, result.usage.prompt_tokens, 0);
        span.setTokens(result.usage.prompt_tokens, 0, cost);
      }
      return result;
    } catch (err) {
      span.setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      finishSpan(span);
    }
  };

  (proto as Record<string, unknown>)['create'] = patched;
}

// ── Public patch / unpatch ────────────────────────────────────────────────────

let patched = false;

/**
 * Monkey-patches the OpenAI SDK by reaching into the prototype chain of a
 * temporary client instance.  Safe to call multiple times — subsequent calls
 * are no-ops.
 *
 * @param OpenAIClass - Optional: pass the OpenAI constructor explicitly to
 *   guarantee the same module instance is patched (useful in ESM test
 *   environments where `require()` and `import` resolve differently).
 *
 * Called automatically when `@agentlens/openai` is imported.
 */
export function patch(OpenAIClass?: typeof OpenAI): void {
  if (patched) return;

  // Construct a throw-away client to navigate to the resource prototypes.
  // The OpenAI constructor does NOT make network calls; `apiKey` is required
  // but any non-empty string is accepted here.
  let client: OpenAI;
  try {
    const Ctor =
      OpenAIClass ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('openai') as { default: typeof OpenAI }).default;
    client = new Ctor({ apiKey: '__agentlens_probe__' });
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[AgentLens] openai package not found — skipping auto-patch.');
    return;
  }

  patchChatCompletions(Object.getPrototypeOf(client.chat.completions) as object);
  patchLegacyCompletions(Object.getPrototypeOf(client.completions) as object);
  patchEmbeddings(Object.getPrototypeOf(client.embeddings) as object);

  patched = true;
}

/**
 * Restores all patched OpenAI methods to their original implementations.
 * Primarily used in tests to ensure a clean state between test cases.
 */
export function unpatch(): void {
  for (const { proto, method, original } of patches.splice(0)) {
    (proto as Record<string, unknown>)[method] = original;
  }
  patched = false;
}
