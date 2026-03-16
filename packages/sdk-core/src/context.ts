import { AsyncLocalStorage } from 'async_hooks';
import type { TraceContext } from './types.js';

/**
 * AsyncLocalStorage store that holds the ambient tracing context for the
 * current async execution chain. Each nested `trace()` call forks the store
 * with an updated `currentSpanId` so that parent/child relationships are
 * captured correctly without any manual bookkeeping.
 */
const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Returns the `TraceContext` for the current async execution chain,
 * or `undefined` if called outside a `trace()` call.
 */
export function getCurrentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` with a new context derived from `ctx`.
 * Uses `AsyncLocalStorage.run()` so the scope is automatically restored when
 * `fn` returns or throws — no cleanup needed by callers.
 */
export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Returns the spanId of the currently active span, or `undefined` if there
 * is no active trace context.
 */
export function getCurrentSpanId(): string | undefined {
  return storage.getStore()?.currentSpanId;
}

/**
 * Returns the traceId of the currently active trace, or `undefined` if there
 * is no active trace context.
 */
export function getCurrentTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
