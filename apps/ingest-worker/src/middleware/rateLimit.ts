import type { Context, Next } from 'hono';
import type { ContextVars, Env } from '../types.js';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory store — resets on worker restart
// Good enough for MVP; replace with Durable Objects when scale requires it
const store = new Map<string, RateLimitRecord>();

const WINDOW_MS = 60 * 1_000; // 1 minute
const MAX_REQUESTS = 1_000;   // per API key per window

export async function rateLimitMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVars }>,
  next: Next,
): Promise<Response | void> {
  const key = c.req.header('X-API-Key') ?? 'unknown';
  const now = Date.now();

  const record = store.get(key);

  if (!record || now > record.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (record.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1_000);
    return c.json(
      { error: 'Rate limit exceeded', retryAfter },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }

  record.count++;
  return next();
}
