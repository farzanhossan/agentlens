import type { SpanData } from './types.js';
import type { Transport } from './transport.js';

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_SIZE = 100;

/**
 * In-memory queue that accumulates finished spans and flushes them to the
 * transport in batches.
 *
 * Flush is triggered by whichever comes first:
 * 1. The periodic timer (`flushIntervalMs`, default 500 ms).
 * 2. The queue reaching `maxBatchSize` spans (default 100).
 *
 * Flush errors are caught and logged — they never propagate to the caller.
 */
export class Buffer {
  private readonly transport: Transport;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;

  private queue: SpanData[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    transport: Transport,
    opts: { flushIntervalMs?: number; maxBatchSize?: number } = {},
  ) {
    this.transport = transport;
    this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  }

  /**
   * Starts the periodic flush timer.
   * Must be called once after construction.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);

    // Allow Node.js to exit even with an active timer
    if (typeof this.timer !== 'number' && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Enqueues a finished span. If the queue reaches `maxBatchSize` a flush is
   * triggered immediately (non-blocking).
   */
  push(span: SpanData): void {
    this.queue.push(span);
    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /**
   * Drains the queue and sends all pending spans to the transport.
   * Safe to call at any time (e.g. for graceful shutdown).
   * Never throws — flush errors are swallowed after logging.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    try {
      await this.transport.send(batch);
    } catch (err) {
      // Best-effort: log and continue. We don't re-enqueue to avoid unbounded growth.
      // eslint-disable-next-line no-console
      console.error('[AgentLens] Flush failed — spans dropped:', err);
    }
  }

  /**
   * Stops the periodic timer and performs a final flush.
   * Call during process shutdown (`SIGTERM`, `beforeExit`, etc.).
   */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
