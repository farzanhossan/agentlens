import { Redis } from '@upstash/redis/cloudflare';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ContextVars, Env, SpanPayload } from '../types.js';

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

// ── BullMQ job push ───────────────────────────────────────────────────────────

const QUEUE_PREFIX = 'bull';
const QUEUE_NAME = 'span-ingestion';
const JOB_NAME = 'ingest-span';

/**
 * Pushes a single span as a BullMQ job into the Redis-backed queue.
 *
 * BullMQ internal format (simplified, without Lua-script atomicity):
 * 1. `INCR  bull:span-ingestion:id`          → jobId
 * 2. `HSET  bull:span-ingestion:{jobId}`     → job fields
 * 3. `LPUSH bull:span-ingestion:wait {jobId}` → enqueue
 * 4. `XADD  bull:span-ingestion:events …`    → notify workers (best-effort)
 *
 * The NestJS BullMQ worker processes jobs from `bull:span-ingestion:wait`
 * with the exact same key prefix/queue configuration.
 */
async function pushToBullMQ(redis: Redis, span: SpanPayload, projectId: string): Promise<void> {
  const idKey = `${QUEUE_PREFIX}:${QUEUE_NAME}:id`;
  const waitKey = `${QUEUE_PREFIX}:${QUEUE_NAME}:wait`;
  const eventsKey = `${QUEUE_PREFIX}:${QUEUE_NAME}:events`;

  // Get next job ID atomically
  const jobId = await redis.incr(idKey);
  const jobKey = `${QUEUE_PREFIX}:${QUEUE_NAME}:${jobId}`;

  const now = Date.now();
  const jobData = {
    name: JOB_NAME,
    data: JSON.stringify({ span, projectId }),
    opts: JSON.stringify({ attempts: 3, backoff: { type: 'exponential', delay: 1_000 } }),
    timestamp: now,
    delay: 0,
    priority: 0,
    attempts: 0,
    returnvalue: '',
    processedOn: 0,
    finishedOn: 0,
    progress: 0,
    stacktrace: '[]',
  };

  await redis
    .pipeline()
    .hset(jobKey, jobData)
    .lpush(waitKey, String(jobId))
    // Publish an 'added' event to the BullMQ events stream so active workers
    // are notified immediately rather than relying on polling.
    .xadd(eventsKey, '*', {
      event: 'added',
      jobId: String(jobId),
      name: JOB_NAME,
    })
    .exec();
}

// ── Gzip decompression ────────────────────────────────────────────────────────

/**
 * Reads and optionally decompresses the request body.
 * Supports `Content-Encoding: gzip` via the `DecompressionStream` Web API
 * (available in Cloudflare Workers runtime).
 */
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
 * Accepts a batch of spans from an AgentLens SDK, validates them, and enqueues
 * each one individually into the `span-ingestion` BullMQ queue via Upstash
 * Redis. Returns 202 immediately — never waits for downstream processing.
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
  // Each span's projectId must match the authenticated key's projectId to
  // prevent one project from writing into another's data.
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

  // ── Enqueue ─────────────────────────────────────────────────────────────────
  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const results = await Promise.allSettled(
    spans.map((span) => pushToBullMQ(redis, span as SpanPayload, projectId)),
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  const accepted = results.length - failed;

  if (accepted === 0) {
    // All enqueues failed — signal the client to retry
    return c.json({ error: 'Failed to enqueue spans — please retry' }, 503);
  }

  return c.json(
    {
      accepted,
      failed,
      ...(failed > 0 && { warning: `${failed} span(s) failed to enqueue` }),
    },
    202,
  );
}
