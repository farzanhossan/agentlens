import type { SpanData, SpanStatus } from './types.js';

/**
 * A mutable span object passed into the `trace()` callback.
 * Callers use the fluent setters to annotate LLM calls; the tracer calls
 * `end()` automatically after the callback resolves or rejects.
 */
export class Span {
  private readonly _spanId: string;
  private readonly _traceId: string;
  private readonly _parentSpanId: string | undefined;
  private readonly _projectId: string;
  private readonly _name: string;
  private readonly _startedAt: Date;

  private _model?: string;
  private _provider?: string;
  private _input?: string;
  private _output?: string;
  private _inputTokens?: number;
  private _outputTokens?: number;
  private _costUsd?: number;
  private _latencyMs?: number;
  private _status: SpanStatus = 'success';
  private _errorMessage?: string;
  private _metadata: Record<string, unknown> = {};
  private _endedAt?: Date;

  constructor(
    spanId: string,
    traceId: string,
    name: string,
    projectId: string,
    parentSpanId?: string,
  ) {
    this._spanId = spanId;
    this._traceId = traceId;
    this._name = name;
    this._projectId = projectId;
    this._parentSpanId = parentSpanId;
    this._startedAt = new Date();
  }

  // ── Fluent setters ──────────────────────────────────────────────────────────

  /**
   * Sets the raw LLM prompt or tool input.
   * Stored in Elasticsearch only — not persisted to PostgreSQL.
   */
  setInput(data: string): this {
    this._input = data;
    return this;
  }

  /**
   * Sets the raw LLM completion or tool output.
   * Stored in Elasticsearch only — not persisted to PostgreSQL.
   */
  setOutput(data: string): this {
    this._output = data;
    return this;
  }

  /** Attaches a free-form metadata key-value pair to this span. */
  setMetadata(key: string, value: unknown): this {
    this._metadata[key] = value;
    return this;
  }

  /** Sets model and provider (e.g. `'gpt-4o'`, `'openai'`). */
  setModel(model: string, provider?: string): this {
    this._model = model;
    if (provider !== undefined) this._provider = provider;
    return this;
  }

  /** Sets token counts and optionally the USD cost. */
  setTokens(inputTokens: number, outputTokens: number, costUsd?: number): this {
    this._inputTokens = inputTokens;
    this._outputTokens = outputTokens;
    if (costUsd !== undefined) this._costUsd = costUsd;
    return this;
  }

  /**
   * Records an error on this span.
   * Automatically sets `status` to `'error'` and captures the message.
   */
  setError(error: Error | string): this {
    this._status = 'error';
    this._errorMessage = error instanceof Error ? error.message : error;
    return this;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Closes the span: records `endedAt` and computes `latencyMs`.
   * Called automatically by the tracer after the callback resolves/rejects.
   * Calling it manually is safe — subsequent calls are no-ops.
   */
  end(): void {
    if (this._endedAt) return;
    this._endedAt = new Date();
    this._latencyMs = this._endedAt.getTime() - this._startedAt.getTime();
  }

  // ── Serialization ───────────────────────────────────────────────────────────

  /**
   * Serializes this span to the wire format expected by the ingest endpoint.
   * `end()` should be called before `toJSON()`.
   */
  toJSON(): SpanData {
    const data: SpanData = {
      spanId: this._spanId,
      traceId: this._traceId,
      projectId: this._projectId,
      name: this._name,
      status: this._status,
      metadata: { ...this._metadata },
      startedAt: this._startedAt.toISOString(),
    };

    if (this._parentSpanId !== undefined) data.parentSpanId = this._parentSpanId;
    if (this._model !== undefined) data.model = this._model;
    if (this._provider !== undefined) data.provider = this._provider;
    if (this._input !== undefined) data.input = this._input;
    if (this._output !== undefined) data.output = this._output;
    if (this._inputTokens !== undefined) data.inputTokens = this._inputTokens;
    if (this._outputTokens !== undefined) data.outputTokens = this._outputTokens;
    if (this._costUsd !== undefined) data.costUsd = this._costUsd;
    if (this._latencyMs !== undefined) data.latencyMs = this._latencyMs;
    if (this._errorMessage !== undefined) data.errorMessage = this._errorMessage;
    if (this._endedAt !== undefined) data.endedAt = this._endedAt.toISOString();

    return data;
  }
}
