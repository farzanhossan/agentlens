import { Buffer } from './buffer.js';
import { Tracer } from './tracer.js';
import { Transport } from './transport.js';
import { maybeRedact } from './redactor.js';
import type { AgentLensConfig, SpanData } from './types.js';
import type { Span } from './span.js';

const DEFAULT_ENDPOINT = 'https://api-agentlens.techmatbd.com';

/**
 * AgentLens singleton — the primary entry point for the SDK.
 *
 * @example
 * ```ts
 * // In your application bootstrap:
 * AgentLens.init({
 *   apiKey: process.env.AGENTLENS_API_KEY!,
 *   projectId: process.env.AGENTLENS_PROJECT_ID!,
 *   redactPII: true,
 * });
 *
 * // Anywhere in your code:
 * const result = await AgentLens.trace('my-agent-loop', async (span) => {
 *   span.setMetadata('userId', '123');
 *   return runAgent();
 * });
 * ```
 */
export class AgentLens {
  private static instance: AgentLens | null = null;

  private readonly tracer: Tracer;
  private readonly buffer: Buffer;
  private readonly redactPII: boolean;
  private readonly projectId: string;

  private constructor(config: Required<AgentLensConfig>) {
    this.projectId = config.projectId;
    this.redactPII = config.redactPII;

    const transport = new Transport(config.endpoint, config.apiKey);
    this.buffer = new Buffer(transport, {
      flushIntervalMs: config.flushIntervalMs,
      maxBatchSize: config.maxBatchSize,
    });

    const sink = (span: SpanData): void => {
      const sanitised: SpanData = {
        ...span,
        input: maybeRedact(span.input, this.redactPII),
        output: maybeRedact(span.output, this.redactPII),
      };
      this.buffer.push(sanitised);
    };

    this.tracer = new Tracer(config.projectId, sink);
    this.buffer.start();
  }

  // ── Static public API ───────────────────────────────────────────────────────

  /**
   * Initialises the AgentLens SDK. Must be called once before any `trace()`
   * call. Subsequent calls to `init()` are no-ops.
   */
  static init(config: AgentLensConfig): void {
    if (AgentLens.instance) return;
    AgentLens.instance = new AgentLens({
      endpoint: DEFAULT_ENDPOINT,
      flushIntervalMs: 500,
      maxBatchSize: 100,
      redactPII: false,
      ...config,
    });
  }

  /**
   * Wraps `fn` in a new span named `name`.
   *
   * Nested calls automatically become child spans. If `fn` throws the span is
   * marked `'error'` and the exception is re-thrown.
   *
   * @throws {Error} if `AgentLens.init()` has not been called.
   */
  static trace<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    return AgentLens.requireInstance().tracer.trace(name, fn);
  }

  /**
   * Flushes all buffered spans to the transport immediately.
   * Await this during graceful shutdown before your process exits.
   */
  static flush(): Promise<void> {
    return AgentLens.requireInstance().buffer.flush();
  }

  /**
   * Stops the periodic flush timer and performs a final flush.
   * After `shutdown()` the singleton is destroyed; a subsequent `init()` call
   * will re-initialise it.
   */
  static async shutdown(): Promise<void> {
    const sdk = AgentLens.requireInstance();
    await sdk.buffer.shutdown();
    AgentLens.instance = null;
  }

  // ── Internal helpers for auto-instrumentation packages ─────────────────────
  // These are prefixed with `_` to signal they are not part of the public API.
  // Auto-patchers (`@farzanhossans/agentlens-openai`, `@farzanhossans/agentlens-anthropic`, etc.) use them
  // to push manually-managed spans (e.g. streaming responses whose lifetime
  // cannot be tied to a single Promise resolution).

  /**
   * @internal Returns `true` if `AgentLens.init()` has been called.
   */
  static _isInitialized(): boolean {
    return AgentLens.instance !== null;
  }

  /**
   * @internal Returns the configured `projectId`, or `null` if uninitialised.
   */
  static _getProjectId(): string | null {
    return AgentLens.instance?.projectId ?? null;
  }

  /**
   * @internal
   * Pushes a finished `SpanData` into the buffer with PII redaction applied.
   * No-ops if the SDK is not initialised — safe to call unconditionally.
   */
  static _pushSpan(spanData: SpanData): void {
    const sdk = AgentLens.instance;
    if (!sdk) return;
    const sanitised: SpanData = {
      ...spanData,
      input: maybeRedact(spanData.input, sdk.redactPII),
      output: maybeRedact(spanData.output, sdk.redactPII),
    };
    sdk.buffer.push(sanitised);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private static requireInstance(): AgentLens {
    if (!AgentLens.instance) {
      throw new Error(
        'AgentLens is not initialised. Call AgentLens.init({ apiKey, projectId }) first.',
      );
    }
    return AgentLens.instance;
  }
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export { Span } from './span.js';
export { Tracer } from './tracer.js';
export { Buffer } from './buffer.js';
export { Transport } from './transport.js';
export { redact, maybeRedact } from './redactor.js';
export { getCurrentTrace, getCurrentTraceId, getCurrentSpanId, runWithTrace } from './context.js';
export type { SpanData, SpanStatus, TraceContext, AgentLensConfig } from './types.js';
