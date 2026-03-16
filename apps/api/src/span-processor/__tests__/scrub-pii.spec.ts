import { SpanProcessorService } from '../span-processor.service';
import type { RawSpanData } from '../span-processor.types';

const service = new SpanProcessorService(null as never, null as never);

function span(input?: string, output?: string): RawSpanData {
  return {
    spanId: 'span-1',
    traceId: 'trace-1',
    projectId: '00000000-0000-0000-0000-000000000001',
    name: 'test',
    status: 'success',
    metadata: {},
    startedAt: new Date().toISOString(),
    input,
    output,
  };
}

describe('SpanProcessorService.scrubPII', () => {
  it('redacts email addresses', () => {
    const result = service.scrubPII(span('Contact us at user@example.com'));
    expect(result.input).toBe('Contact us at [REDACTED-EMAIL]');
  });

  it('redacts phone numbers', () => {
    const result = service.scrubPII(span('Call 415-555-1234 now'));
    expect(result.input).toContain('[REDACTED-PHONE]');
  });

  it('redacts SSNs', () => {
    const result = service.scrubPII(span('SSN: 123-45-6789'));
    expect(result.input).toContain('[REDACTED-SSN]');
  });

  it('redacts Bearer tokens in output', () => {
    const result = service.scrubPII(
      span(undefined, 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'),
    );
    expect(result.output).toContain('[REDACTED-BEARER]');
  });

  it('redacts API keys', () => {
    const result = service.scrubPII(span('key_abcdefghijklmnopqrstuvwxyz12345'));
    expect(result.input).toContain('[REDACTED-API_KEY]');
  });

  it('leaves non-PII text unchanged', () => {
    const clean = 'The weather today is sunny with a high of 25°C.';
    const result = service.scrubPII(span(clean));
    expect(result.input).toBe(clean);
  });

  it('handles undefined input and output gracefully', () => {
    const result = service.scrubPII(span(undefined, undefined));
    expect(result.input).toBeUndefined();
    expect(result.output).toBeUndefined();
  });

  it('does not mutate the original span', () => {
    const original = span('email: test@test.com');
    service.scrubPII(original);
    expect(original.input).toBe('email: test@test.com');
  });

  it('redacts multiple PII occurrences in a single string', () => {
    const result = service.scrubPII(
      span('email: a@b.com, phone: 555-123-4567, more: c@d.org'),
    );
    expect(result.input).not.toContain('@');
    expect(result.input).not.toContain('555-123-4567');
    expect(result.input).toContain('[REDACTED-EMAIL]');
    expect(result.input).toContain('[REDACTED-PHONE]');
  });
});
