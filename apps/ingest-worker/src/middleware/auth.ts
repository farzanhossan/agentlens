import type { Context, Next } from 'hono';
import type { ContextVars, Env } from '../types.js';

/**
 * API key format: `proj_{base64(projectId)}.{base64url(hmac)}`
 *
 * The HMAC is SHA-256 over the literal string `proj_{base64(projectId)}`
 * keyed with the shared `HMAC_SECRET`. Verification uses
 * `crypto.subtle.verify` for constant-time comparison — no timing attacks.
 *
 * Key generation (server-side, one-time):
 * ```ts
 * const b64 = btoa(projectId);
 * const msg = new TextEncoder().encode(`proj_${b64}`);
 * const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
 * const sig = await crypto.subtle.sign('HMAC', key, msg);
 * const apiKey = `proj_${b64}.${bytesToBase64Url(new Uint8Array(sig))}`;
 * ```
 */

const HMAC_ALGO = { name: 'HMAC', hash: 'SHA-256' } as const;
const HEADER = 'X-API-Key';

// ── Base64url helpers (no external deps) ─────────────────────────────────────

function base64urlToBytes(b64url: string): Uint8Array {
  // Convert base64url → standard base64
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Restore padding
  const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Core verification ─────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  projectId?: string;
}

/**
 * Verifies an API key and extracts the embedded projectId.
 * Returns `{ valid: false }` for any malformed or invalid key — never throws.
 */
export async function verifyApiKey(
  apiKey: string,
  hmacSecret: string,
): Promise<VerifyResult> {
  const dotIdx = apiKey.lastIndexOf('.');
  if (dotIdx === -1) return { valid: false };

  // prefix = "proj_{base64(projectId)}"
  const prefix = apiKey.slice(0, dotIdx);
  const sigB64url = apiKey.slice(dotIdx + 1);

  if (!prefix.startsWith('proj_')) return { valid: false };

  // Decode the projectId from base64 (standard, not url-safe)
  const projectIdB64 = prefix.slice('proj_'.length);
  let projectId: string;
  try {
    projectId = atob(projectIdB64);
  } catch {
    return { valid: false };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlToBytes(sigB64url);
  } catch {
    return { valid: false };
  }

  // Import HMAC key
  const secretBytes = new TextEncoder().encode(hmacSecret);
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey('raw', secretBytes, HMAC_ALGO, false, ['verify']);
  } catch {
    return { valid: false };
  }

  // Constant-time verification
  const message = new TextEncoder().encode(prefix);
  const valid = await crypto.subtle.verify(HMAC_ALGO, cryptoKey, sigBytes, message);

  return valid ? { valid: true, projectId } : { valid: false };
}

// ── Hono middleware ───────────────────────────────────────────────────────────

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVars }>,
  next: Next,
): Promise<Response | void> {
  const apiKey = c.req.header(HEADER);

  if (!apiKey) {
    return c.json({ error: `Missing ${HEADER} header` }, 401);
  }

  const { valid, projectId } = await verifyApiKey(apiKey, c.env.HMAC_SECRET);

  if (!valid || !projectId) {
    return c.json({ error: 'Invalid or expired API key' }, 401);
  }

  c.set('projectId', projectId);
  await next();
}
