import { describe, it, expect } from 'vitest';
import { parseProxyRoute } from '../src/router';

describe('parseProxyRoute', () => {
  it('parses openai chat completions path', () => {
    const result = parseProxyRoute('/v1/p/abc-123/openai/v1/chat/completions');
    expect(result).toEqual({
      projectId: 'abc-123',
      provider: 'openai',
      upstreamPath: '/v1/chat/completions',
    });
  });

  it('parses anthropic messages path', () => {
    const result = parseProxyRoute('/v1/p/proj-456/anthropic/v1/messages');
    expect(result).toEqual({
      projectId: 'proj-456',
      provider: 'anthropic',
      upstreamPath: '/v1/messages',
    });
  });

  it('parses generic provider with custom path', () => {
    const result = parseProxyRoute('/v1/p/proj-789/generic/api/generate');
    expect(result).toEqual({
      projectId: 'proj-789',
      provider: 'generic',
      upstreamPath: '/api/generate',
    });
  });

  it('returns null for invalid paths', () => {
    expect(parseProxyRoute('/health')).toBeNull();
    expect(parseProxyRoute('/v1/p/')).toBeNull();
    expect(parseProxyRoute('/v1/p/abc')).toBeNull();
    expect(parseProxyRoute('/v1/spans')).toBeNull();
  });

  it('handles paths with query strings', () => {
    const result = parseProxyRoute('/v1/p/abc/openai/v1/chat/completions');
    expect(result?.upstreamPath).toBe('/v1/chat/completions');
  });
});
