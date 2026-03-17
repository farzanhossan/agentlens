import type { Context } from 'hono';
import { z } from 'zod';
import type { ContextVars, Env } from '../types.js';

// ── Validation schema ─────────────────────────────────────────────────────────

const SpanPayloadSchema = z.object({
  spanId: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  parentSpanId: z.string().max(128).optional(),
  projectId: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  model: z.string().max(128).optional(),
  provider: z.string().max(64).optional(),
  input: z.string().max(100_000).optional(),
  output: z.string().max(100_000).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  status: z.enum(['success', 'error', 'timeout']),
  errorMessage: z.string().max(4_096).optional(),
  metadata: z.record(z.unknown()).default({}),
  startedAt: z.string().datetime({ message: 'startedAt must be ISO-8601' }),
  endedAt: z.string().datetime().optional(),
});

const IngestBodySchema = z.object({
  spans: z
    .array(SpanPayloadSchema)
    .min(1, 'At least one span is required')
    .max(100, 'Maximum 100 spans per batch'),
});

// ── Gzip decompression ────────────────────────────────────────────────────────

async function readBody(req: Request): Promise<string> {
  const encoding = req.headers.get('Content-Encoding');

  if (encoding?.toLowerCase() === 'gzip') {
    const decompressed = req.body!.pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(decompressed);
    return response.text();
  }

  return req.text();
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * POST /v1/spans
 *
 * Validates spans at the edge then forwards the batch directly to the NestJS
 * API for processing. Returns 202 immediately.
 */
export async function ingestHandler(
  c: Context<{ Bindings: Env; Variables: ContextVars }>,
): Promise<Response> {
  const projectId = c.get('projectId');

  // ── Parse body (gzip-aware) ─────────────────────────────────────────────────
  let rawText: string;
  try {
    rawText = await readBody(c.req.raw);
  } catch {
    return c.json({ error: 'Failed to read request body' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(rawText);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // ── Validate ────────────────────────────────────────────────────────────────
  const parsed = IngestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Validation failed',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const { spans } = parsed.data;

  // ── Verify projectId consistency ────────────────────────────────────────────
  const mismatch = spans.find((s) => s.projectId !== projectId);
  if (mismatch) {
    return c.json(
      {
        error: 'projectId in span does not match authenticated key',
        offendingSpanId: mismatch.spanId,
      },
      403,
    );
  }

  // ── Forward to NestJS API ───────────────────────────────────────────────────
  const apiUrl = c.env.API_URL || 'https://api.agentlens.dev';

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/v1/spans/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.req.header('X-API-Key') ?? '',
        'X-Forwarded-For': c.req.header('CF-Connecting-IP') ?? '',
        'X-Worker-Secret': c.env.WORKER_SECRET ?? '',
      },
      body: JSON.stringify({ spans }),
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[ingest-worker] Failed to reach API:', err.message);
    return c.json({ error: 'Failed to reach processing API — please retry' }, 503);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[ingest-worker] API error:', response.status, errorText);
    return c.json({ error: 'Processing failed' }, 502);
  }

  return c.json({ accepted: true, count: spans.length }, 202);
}
