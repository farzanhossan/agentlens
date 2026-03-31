import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

export interface SpanPayload {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  input?: string;
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
}

export class SpanEmitter {
  constructor(private readonly ingestUrl: string) {}

  async emit(span: SpanPayload): Promise<void> {
    try {
      const body = JSON.stringify({ spans: [span] });
      const compressed = await gzipAsync(Buffer.from(body));

      await fetch(this.ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'X-API-Key': 'proxy-internal',
        },
        body: compressed,
      });
    } catch (err) {
      // Fire-and-forget: log but never throw
      console.error('[proxy] span emission failed:', (err as Error).message);
    }
  }
}
