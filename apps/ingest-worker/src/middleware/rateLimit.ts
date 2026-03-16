import { Redis } from '@upstash/redis/cloudflare';
import type { Context, Next } from 'hono';
import type { ContextVars, Env } from '../types.js';

const RATE_LIMIT = 1_000;        // requests per window
const WINDOW_SECONDS = 60;       // 1-minute fixed window
const WINDOW_MS = WINDOW_SECONDS * 1_000;

/**
 * Fixed-window rate limiter backed by Upstash Redis.
 *
 * Each project gets 1,000 requests per 60-second window. The window key is
 * derived from the current UTC minute, so it resets on the clock boundary.
 *
 * Headers set on every response:
 * - `X-RateLimit-Limit`     — max requests per window
 * - `X-RateLimit-Remaining` — requests left in current window
 * - `X-RateLimit-Reset`     — Unix timestamp (s) when window resets
 *
 * A 429 response additionally includes:
 * - `Retry-After` — seconds until the window resets
 */
export async function rateLimitMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVars }>,
  next: Next,
): Promise<Response | void> {
  const projectId = c.get('projectId');

  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const nowMs = Date.now();
  const window = Math.floor(nowMs / WINDOW_MS);
  const windowResetSec = (window + 1) * WINDOW_SECONDS;
  const secondsUntilReset = windowResetSec - Math.floor(nowMs / 1_000);

  const key = `rl:${projectId}:${window}`;

  // Atomic increment + expiry in a single pipeline round-trip
  const [count] = await redis
    .pipeline()
    .incr(key)
    .expire(key, WINDOW_SECONDS * 2)  // 2× window so the key outlives the window
    .exec<[number, number]>();

  const remaining = Math.max(0, RATE_LIMIT - count);

  c.header('X-RateLimit-Limit', String(RATE_LIMIT));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(windowResetSec));

  if (count > RATE_LIMIT) {
    c.header('Retry-After', String(secondsUntilReset));
    return c.json(
      {
        error: 'Rate limit exceeded',
        retryAfterSeconds: secondsUntilReset,
      },
      429,
    );
  }

  await next();
}
