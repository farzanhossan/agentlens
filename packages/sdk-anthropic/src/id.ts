import { randomBytes } from 'crypto';

export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}
