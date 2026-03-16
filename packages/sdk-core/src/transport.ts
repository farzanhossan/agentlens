import { gzip } from 'pako';
import type { SpanData } from './types.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;

/**
 * Sends a batch of spans to the AgentLens ingest endpoint over HTTPS.
 *
 * Features:
 * - Gzip-compresses the JSON payload with `pako` (works in Node and browsers).
 * - Retries up to 3 times with exponential backoff on 429 / 5xx responses.
 * - Throws on final failure so the caller (buffer) can log and swallow.
 */
export class Transport {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Posts `spans` to `{endpoint}/v1/spans`.
   * Resolves when the server returns 2xx; throws otherwise (after retries).
   */
  async send(spans: SpanData[]): Promise<void> {
    const compressed = this.compress(spans);
    const body: ArrayBuffer = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    ) as ArrayBuffer;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.endpoint}/v1/spans`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'X-API-Key': this.apiKey,
          },
          body,
        });
      } catch (networkErr) {
        // Network error (DNS, connection refused, timeout) — always retry
        if (attempt === MAX_RETRIES) throw networkErr;
        await this.delay(attempt);
        continue;
      }

      if (response.ok) return;

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        const retryAfterMs = this.parseRetryAfter(response) ?? this.backoff(attempt);
        await this.delay(attempt, retryAfterMs);
        continue;
      }

      // Non-retryable error
      throw new Error(
        `AgentLens transport: HTTP ${response.status} ${response.statusText}`,
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private compress(spans: SpanData[]): Uint8Array {
    const json = JSON.stringify({ spans });
    return gzip(json);
  }

  private backoff(attempt: number): number {
    // Exponential backoff with full jitter: [0, base * 2^attempt)
    const cap = BASE_DELAY_MS * 2 ** attempt;
    return Math.random() * cap;
  }

  private parseRetryAfter(res: Response): number | undefined {
    const header = res.headers.get('Retry-After');
    if (!header) return undefined;
    const seconds = parseFloat(header);
    return isNaN(seconds) ? undefined : seconds * 1_000;
  }

  private delay(attempt: number, ms?: number): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(resolve, ms ?? this.backoff(attempt)),
    );
  }
}
