import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { ingestHandler } from './handlers/ingest.js';
import type { ContextVars, Env } from './types.js';

const app = new Hono<{ Bindings: Env; Variables: ContextVars }>();

// ── Global middleware ─────────────────────────────────────────────────────────

app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '/v1/*',
  cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Content-Encoding', 'X-API-Key'],
    maxAge: 86_400,
  }),
);

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// ── Ingestion — auth + rate-limit guarded ─────────────────────────────────────

app.post(
  '/v1/spans',
  authMiddleware,
  rateLimitMiddleware,
  ingestHandler,
);

// ── 404 ───────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ── Global error handler ──────────────────────────────────────────────────────
// Workers must never crash on bad input — all uncaught errors surface here.

app.onError((err, c) => {
  // eslint-disable-next-line no-console
  console.error('[ingest-worker] Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
