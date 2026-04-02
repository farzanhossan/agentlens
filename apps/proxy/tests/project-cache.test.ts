// tests/project-cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectCache } from '../src/project-cache';

describe('ProjectCache', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates project via API and caches result', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    const cache = new ProjectCache('http://api:3001/v1/projects', 60_000);

    const first = await cache.isValid('proj-1');
    const second = await cache.isValid('proj-1');

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cached
  });

  it('caches invalid projects too', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 });
    const cache = new ProjectCache('http://api:3001/v1/projects', 60_000);

    const first = await cache.isValid('bad-proj');
    const second = await cache.isValid('bad-proj');

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('allows all projects in standalone mode (no validation URL)', async () => {
    const cache = new ProjectCache(undefined, 60_000);

    const result = await cache.isValid('anything');
    expect(result).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats fetch errors as invalid', async () => {
    fetchSpy.mockRejectedValue(new Error('network'));
    const cache = new ProjectCache('http://api:3001/v1/projects', 60_000);

    const result = await cache.isValid('proj-1');
    expect(result).toBe(false);
  });
});
