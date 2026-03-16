import type Anthropic from '@anthropic-ai/sdk';
import { AgentLens, Span, getCurrentSpanId, getCurrentTraceId } from '@farzanhossan/agentlens-core';
import { generateTraceId } from './id.js';

export interface AnthropicPatchOptions {
  /** No-op option kept for backwards compatibility; the SDK uses the global AgentLens instance. */
  tracer?: never;
  /** Trace ID to attach spans to. If omitted, uses ambient context or generates a new one. */
  traceId?: string;
}

type AnyFn = (...args: unknown[]) => unknown;

// ── Pricing ($ per 1 M tokens) ────────────────────────────────────────────────

const INPUT_PRICE: Record<string, number> = {
  'claude-3-5-sonnet': 3.0,
  'claude-3-5-haiku': 0.8,
  'claude-3-opus': 15.0,
  'claude-3-sonnet': 3.0,
  'claude-3-haiku': 0.25,
  'claude-2': 8.0,
};

const OUTPUT_PRICE: Record<string, number> = {
  'claude-3-5-sonnet': 15.0,
  'claude-3-5-haiku': 4.0,
  'claude-3-opus': 75.0,
  'claude-3-sonnet': 15.0,
  'claude-3-haiku': 1.25,
  'claude-2': 24.0,
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(INPUT_PRICE).find((k) => model.toLowerCase().includes(k)) ?? '';
  const inputRate = INPUT_PRICE[key] ?? 3.0;
  const outputRate = OUTPUT_PRICE[key] ?? 15.0;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isReady(): boolean {
  if (AgentLens._isInitialized()) return true;
  // eslint-disable-next-line no-console
  console.warn(
    '[AgentLens] @farzanhossan/agentlens-anthropic is loaded but AgentLens.init() has not been called. ' +
      'Anthropic calls will not be traced.',
  );
  return false;
}

function makeSpan(name: string, fixedTraceId?: string): Span | null {
  const projectId = AgentLens._getProjectId();
  if (!projectId) return null;

  const traceId = fixedTraceId ?? getCurrentTraceId() ?? generateTraceId();
  const parentSpanId = getCurrentSpanId();
  return new Span(generateTraceId(), traceId, name, projectId, parentSpanId ?? undefined);
}

function finishSpan(span: Span): void {
  span.end();
  AgentLens._pushSpan(span.toJSON());
}

// ── Patch implementation ──────────────────────────────────────────────────────

/**
 * Monkey-patches an Anthropic client instance so every `messages.create` call
 * is automatically wrapped in an AgentLens span.
 *
 * Requires `AgentLens.init()` to have been called first.
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { patchAnthropic } from '@farzanhossan/agentlens-anthropic';
 *
 * const anthropic = patchAnthropic(new Anthropic());
 * ```
 */
export function patchAnthropic(client: Anthropic, options: AnthropicPatchOptions = {}): Anthropic {
  const { traceId: fixedTraceId } = options;
  const original = client.messages.create.bind(client.messages) as AnyFn;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  (client.messages as any).create = async function (
    params: Anthropic.MessageCreateParamsNonStreaming,
    requestOptions?: Anthropic.RequestOptions,
  ): Promise<Anthropic.Message> {
    if (!isReady()) {
      return original(params, requestOptions) as Promise<Anthropic.Message>;
    }

    const span = makeSpan('anthropic.messages.create', fixedTraceId);
    if (!span) {
      return original(params, requestOptions) as Promise<Anthropic.Message>;
    }

    span.setModel(params.model, 'anthropic');

    const systemText =
      typeof params.system === 'string'
        ? params.system
        : (params.system as Array<{ type: string; text?: string }> | undefined)
            ?.filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('\n');

    const userMessages = params.messages
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : (m.content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join(''),
      )
      .join('\n');

    span.setInput(systemText ? `${systemText}\n\n${userMessages}` : userMessages);

    try {
      const result = (await original(params, requestOptions)) as Anthropic.Message;

      const text = result.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      span.setOutput(text);

      const inputTokens = result.usage.input_tokens;
      const outputTokens = result.usage.output_tokens;
      const cost = calculateCost(params.model, inputTokens, outputTokens);
      span.setTokens(inputTokens, outputTokens, cost);

      return result;
    } catch (err) {
      span.setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      finishSpan(span);
    }
  };

  return client;
}
