import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { z } from 'zod';
import { TraceStatus } from '../database/entities/trace.entity.js';
import { SpanStatus } from '../database/entities/span.entity.js';
import { ElasticsearchService } from './elasticsearch/elasticsearch.service.js';
import { computeCost } from './pricing/model-pricing.js';
import type { ProcessedSpan, RawSpanData } from './span-processor.types.js';

// ── Validation schema ─────────────────────────────────────────────────────────

const RawSpanSchema = z.object({
  spanId: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  parentSpanId: z.string().max(128).optional(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(512),
  model: z.string().max(128).optional(),
  provider: z.string().max(64).optional(),
  input: z.string().optional(),
  output: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  status: z.enum(['success', 'error', 'timeout']),
  errorMessage: z.string().max(4_096).optional(),
  metadata: z.record(z.unknown()).default({}),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

// ── PII patterns ──────────────────────────────────────────────────────────────

interface PiiRule {
  label: string;
  pattern: RegExp;
}

const PII_RULES: PiiRule[] = [
  { label: 'EMAIL', pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { label: 'PHONE', pattern: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { label: 'SSN', pattern: /\b(?!000|666|9\d{2})\d{3}[- ]?\d{2}[- ]?\d{4}\b/g },
  { label: 'CREDIT_CARD', pattern: /\b(?:\d[ -]?){13,19}\b/g },
  { label: 'API_KEY', pattern: /\b(?:sk|pk|key|api_key|token|secret)[_-]?[A-Za-z0-9]{20,}\b/gi },
  { label: 'BEARER', pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi },
];

function scrubText(text: string): string {
  let result = text;
  for (const { label, pattern } of PII_RULES) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED-${label}]`);
  }
  return result;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class SpanProcessorService {
  private readonly logger = new Logger(SpanProcessorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly esService: ElasticsearchService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Validates raw job data against the span schema.
   * @throws {BadRequestException} if any required field is missing or malformed.
   */
  validateSpan(raw: unknown): RawSpanData {
    const result = RawSpanSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.flatten();
      this.logger.warn('Span validation failed', issues);
      throw new BadRequestException({
        message: 'Invalid span payload',
        details: issues,
      });
    }
    return result.data as RawSpanData;
  }

  /**
   * Replaces PII patterns in the `input` and `output` fields.
   * All other fields are returned unchanged.
   */
  scrubPII(span: RawSpanData): RawSpanData {
    return {
      ...span,
      input: span.input !== undefined ? scrubText(span.input) : undefined,
      output: span.output !== undefined ? scrubText(span.output) : undefined,
    };
  }

  /**
   * Looks up model pricing and computes `costUsd`.
   * If provider/model are absent or unknown, `costUsd` is left as-is.
   */
  calculateCost(span: RawSpanData): ProcessedSpan {
    let costUsd = span.costUsd;

    if (
      span.provider &&
      span.model &&
      span.inputTokens !== undefined &&
      span.outputTokens !== undefined
    ) {
      const computed = computeCost(
        span.provider,
        span.model,
        span.inputTokens,
        span.outputTokens,
      );
      if (computed !== undefined) costUsd = computed;
    }

    return { ...span, costUsd };
  }

  /**
   * Atomically upserts the parent trace row.
   *
   * On first insert: creates the trace with `status = 'running'`.
   * On conflict: increments counters and escalates status to 'error' if needed.
   *
   * Uses a raw parameterised query via the supplied `EntityManager` so this
   * participates in the caller's transaction.
   */
  async upsertTrace(span: ProcessedSpan, em: EntityManager): Promise<void> {
    const totalTokens = (span.inputTokens ?? 0) + (span.outputTokens ?? 0);
    const costUsd = span.costUsd ?? 0;
    const latencyMs = span.latencyMs ?? 0;

    // Derive trace-level status from this span
    const traceStatus =
      span.status === 'error' ? TraceStatus.ERROR : TraceStatus.RUNNING;

    await em.query(
      `
      INSERT INTO traces (
        id, project_id, status,
        total_spans, total_tokens, total_cost_usd, total_latency_ms,
        started_at, ended_at, metadata
      ) VALUES (
        $1, $2, $3,
        1, $4, $5, $6,
        $7, $8, $9
      )
      ON CONFLICT (id) DO UPDATE SET
        total_spans     = traces.total_spans + 1,
        total_tokens    = traces.total_tokens + EXCLUDED.total_tokens,
        total_cost_usd  = traces.total_cost_usd + EXCLUDED.total_cost_usd,
        total_latency_ms = traces.total_latency_ms + EXCLUDED.total_latency_ms,
        status = CASE
          WHEN EXCLUDED.status = 'error'   THEN 'error'::trace_status
          WHEN traces.status   = 'error'   THEN 'error'::trace_status
          WHEN EXCLUDED.status = 'timeout' THEN 'timeout'::trace_status
          WHEN traces.status   = 'timeout' THEN 'timeout'::trace_status
          ELSE traces.status
        END,
        ended_at = CASE
          WHEN EXCLUDED.ended_at IS NOT NULL THEN EXCLUDED.ended_at
          ELSE traces.ended_at
        END
      `,
      [
        span.traceId,
        span.projectId,
        traceStatus,
        totalTokens,
        costUsd,
        latencyMs,
        new Date(span.startedAt),
        span.endedAt ? new Date(span.endedAt) : null,
        JSON.stringify(span.metadata),
      ],
    );
  }

  /**
   * Inserts the span row into PostgreSQL.
   * `input` and `output` are intentionally excluded — they live in Elasticsearch.
   */
  async insertSpan(span: ProcessedSpan, em: EntityManager): Promise<void> {
    const status = span.status as SpanStatus;

    await em.query(
      `
      INSERT INTO spans (
        id, trace_id, project_id, parent_span_id,
        name, model, provider,
        input_tokens, output_tokens, cost_usd, latency_ms,
        status, error_message,
        started_at, ended_at, metadata
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [
        span.spanId,
        span.traceId,
        span.projectId,
        span.parentSpanId ?? null,
        span.name,
        span.model ?? null,
        span.provider ?? null,
        span.inputTokens ?? null,
        span.outputTokens ?? null,
        span.costUsd ?? null,
        span.latencyMs ?? null,
        status,
        span.errorMessage ?? null,
        new Date(span.startedAt),
        span.endedAt ? new Date(span.endedAt) : null,
        JSON.stringify(span.metadata),
      ],
    );
  }

  /**
   * Indexes the full span (including `input`/`output` text) into Elasticsearch.
   * Errors here are logged but do not roll back the PostgreSQL transaction.
   */
  async indexToElasticsearch(span: ProcessedSpan): Promise<void> {
    try {
      await this.esService.indexSpan(span);
    } catch (err) {
      this.logger.error(
        `ES indexing failed for span ${span.spanId}: ${String(err)}`,
      );
      // Non-fatal: PostgreSQL is the source of truth for structured data
    }
  }

  /** Convenience: run upsertTrace + insertSpan inside a single transaction. */
  async persistSpan(span: ProcessedSpan): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await this.upsertTrace(span, em);
      await this.insertSpan(span, em);
    });
  }
}
