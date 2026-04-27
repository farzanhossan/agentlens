import type { Logger } from '@nestjs/common';

/**
 * Attempts the Elasticsearch query first; if it throws, logs a warning
 * and falls back to the equivalent Postgres query.
 */
export async function withEsFallback<T>(
  esFn: () => Promise<T>,
  pgFn: () => Promise<T>,
  logger: Logger,
): Promise<T> {
  try {
    return await esFn();
  } catch (err) {
    logger.warn(`ES query failed, falling back to Postgres: ${String(err)}`);
    return pgFn();
  }
}
