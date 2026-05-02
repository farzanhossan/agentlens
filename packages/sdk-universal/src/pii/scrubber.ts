interface PIIPattern {
  name: string
  pattern: RegExp
  replacement: string
}

const PII_PATTERNS: PIIPattern[] = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { name: 'phone', pattern: /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/g, replacement: '[PHONE]' },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { name: 'apikey', pattern: /\b(sk|pk|key|token|secret|api[-_]?key)[-_]?[a-zA-Z0-9]{20,}/gi, replacement: '[API_KEY]' },
  { name: 'creditcard', pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CARD]' },
  { name: 'ipv4', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[IP]' },
]

export function scrubPII(text: string): string {
  let result = text
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function scrubObject(obj: unknown): unknown {
  if (typeof obj === 'string') return scrubPII(obj)
  if (Array.isArray(obj)) return obj.map(scrubObject)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, scrubObject(v)]))
  }
  return obj
}
