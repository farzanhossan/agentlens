import { describe, expect, it } from 'vitest'
import { scrubObject, scrubPII } from '../pii/scrubber'

describe('scrubPII', () => {
  it('masks email addresses', () => {
    const out = scrubPII('contact me at jane.doe+work@example.com today')
    expect(out).toContain('[EMAIL]')
    expect(out).not.toContain('jane.doe+work@example.com')
  })

  it('masks US-format phone numbers', () => {
    expect(scrubPII('call 415-555-0123')).toContain('[PHONE]')
    expect(scrubPII('reach me: (212) 555 9999')).toContain('[PHONE]')
  })

  it('masks SSN', () => {
    const out = scrubPII('SSN 123-45-6789 on file')
    expect(out).toContain('[SSN]')
    expect(out).not.toContain('123-45-6789')
  })

  it('masks credit-card numbers (16 digits, grouped)', () => {
    expect(scrubPII('card 4111 1111 1111 1111')).toContain('[CARD]')
    expect(scrubPII('card 4111-1111-1111-1111')).toContain('[CARD]')
    expect(scrubPII('card 4111111111111111')).toContain('[CARD]')
  })

  it('masks api-key-like tokens', () => {
    const out = scrubPII('use sk-abcdefghijklmnopqrstuvwxyz to auth')
    expect(out).toContain('[API_KEY]')
  })

  it('masks IPv4 addresses', () => {
    expect(scrubPII('connection from 192.168.1.1 lost')).toContain('[IP]')
  })

  it('leaves non-PII text unchanged', () => {
    const safe = 'hello world, this is just regular content'
    expect(scrubPII(safe)).toBe(safe)
  })

  it('handles strings with multiple distinct PII types', () => {
    const out = scrubPII('email jane@x.com, phone 415-555-0123, ip 10.0.0.1')
    expect(out).toContain('[EMAIL]')
    expect(out).toContain('[PHONE]')
    expect(out).toContain('[IP]')
  })

  // Known limitation: the IP regex matches anything that looks like dotted quads,
  // including software version strings. Documented for users.
  it('NOTE: IP regex is greedy — masks version-like strings (known limitation)', () => {
    expect(scrubPII('node version 18.20.4.0')).toContain('[IP]')
  })
})

describe('scrubObject', () => {
  it('recursively scrubs strings nested in objects and arrays', () => {
    const input = {
      user: { email: 'a@b.com', notes: ['call 415-555-0123', { ip: '10.0.0.1' }] },
      meta: 'no pii here',
      count: 42,
      enabled: true,
      nothing: null,
    }
    const out = scrubObject(input) as typeof input
    expect(out.user.email).toBe('[EMAIL]')
    expect((out.user.notes[0] as string)).toContain('[PHONE]')
    expect((out.user.notes[1] as { ip: string }).ip).toBe('[IP]')
    expect(out.meta).toBe('no pii here')
    expect(out.count).toBe(42)
    expect(out.enabled).toBe(true)
    expect(out.nothing).toBeNull()
  })

  it('preserves non-string scalars unchanged', () => {
    expect(scrubObject(7)).toBe(7)
    expect(scrubObject(true)).toBe(true)
    expect(scrubObject(null)).toBe(null)
    expect(scrubObject(undefined)).toBe(undefined)
  })
})
