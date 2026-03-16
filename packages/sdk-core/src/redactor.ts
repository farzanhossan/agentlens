/**
 * Lightweight PII redactor applied to `input` and `output` text before
 * spans are buffered. Enabled via `AgentLensConfig.redactPII = true`.
 *
 * Each pattern is replaced with a bracketed label so consumers can see that
 * a value existed without retaining the sensitive data.
 */

interface RedactionRule {
  label: string;
  pattern: RegExp;
}

const RULES: RedactionRule[] = [
  {
    label: 'EMAIL',
    // RFC 5321-ish — intentionally broad for PII detection
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    label: 'PHONE',
    // North-American + international E.164 variants
    pattern: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
  {
    label: 'SSN',
    pattern: /\b(?!000|666|9\d{2})\d{3}[- ]?\d{2}[- ]?\d{4}\b/g,
  },
  {
    label: 'CREDIT_CARD',
    // Luhn-formatted 13-19 digit card numbers with optional separators
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
  },
  {
    label: 'API_KEY',
    // Common API key patterns: sk-…, pk-…, key-…, token-… (32+ chars)
    pattern: /\b(?:sk|pk|key|api_key|token|secret)[_-]?[A-Za-z0-9]{20,}\b/gi,
  },
  {
    label: 'BEARER_TOKEN',
    // Authorization: Bearer <token>
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  },
];

const REPLACEMENT = (label: string): string => `[REDACTED-${label}]`;

/**
 * Scans `text` for PII patterns and replaces each match with
 * `[REDACTED-<TYPE>]`.  Returns the sanitised string.
 */
export function redact(text: string): string {
  let result = text;
  for (const rule of RULES) {
    // Reset lastIndex for global regexes between calls
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, REPLACEMENT(rule.label));
  }
  return result;
}

/**
 * Conditionally redacts `text`. Returns `undefined` unchanged.
 */
export function maybeRedact(text: string | undefined, enabled: boolean): string | undefined {
  if (!enabled || text === undefined) return text;
  return redact(text);
}
