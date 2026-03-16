import { v4 as uuidv4 } from 'uuid';
import { getCurrentSpanId, getCurrentTraceId, runWithTrace } from './context.js';
import { Span } from './span.js';
import type { SpanData } from './types.js';

export type SpanSink = (span: SpanData) => void;

/**
 * Creates and manages spans for a single AgentLens project.
 *
 * The tracer uses `AsyncLocalStorage` (via `context.ts`) to propagate the
 * active trace/span implicitly through async call chains. Nested `trace()`
 * calls automatically become child spans.
 */
export class Tracer {
  private readonly projectId: string;
  private readonly sink: SpanSink;

  constructor(projectId: string, sink: SpanSink) {
    this.projectId = projectId;
    this.sink = sink;
  }

  /**
   * Wraps `fn` in a new span named `name`.
   *
   * - If called inside an existing `trace()` context the new span is
   *   automatically a child of the current span.
   * - If `fn` throws, the span is marked `'error'` and the exception is
   *   re-thrown unchanged.
   * - The span is always ended and forwarded to the buffer regardless of
   *   whether `fn` succeeds or throws.
   *
   * @example
   * ```ts
   * const result = await tracer.trace('llm.call', async (span) => {
   *   span.setModel('gpt-4o', 'openai');
   *   const completion = await openai.chat.completions.create(...);
   *   span.setOutput(completion.choices[0].message.content ?? '');
   *   span.setTokens(
   *     completion.usage.prompt_tokens,
   *     completion.usage.completion_tokens,
   *   );
   *   return completion;
   * });
   * ```
   */
  async trace<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const spanId = uuidv4();
    const traceId = getCurrentTraceId() ?? uuidv4();
    const parentSpanId = getCurrentSpanId();

    const span = new Span(spanId, traceId, name, this.projectId, parentSpanId);

    const ctx = { traceId, currentSpanId: spanId };

    return runWithTrace(ctx, async () => {
      try {
        const result = await fn(span);
        return result;
      } catch (err) {
        span.setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        span.end();
        this.sink(span.toJSON());
      }
    });
  }
}
