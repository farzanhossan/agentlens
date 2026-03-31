import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if AGENTLENS_INGEST_URL is missing', () => {
    delete process.env.AGENTLENS_INGEST_URL;
    expect(() => loadConfig()).toThrow('AGENTLENS_INGEST_URL');
  });

  it('loads required and default values', () => {
    process.env.AGENTLENS_INGEST_URL = 'http://localhost:3001/v1/spans';
    const config = loadConfig();
    expect(config.ingestUrl).toBe('http://localhost:3001/v1/spans');
    expect(config.port).toBe(8080);
    expect(config.projectCacheTtlMs).toBe(60_000);
    expect(config.maxBodySize).toBe(10 * 1024 * 1024);
    expect(config.bufferMaxSize).toBe(10 * 1024 * 1024);
    expect(config.logLevel).toBe('info');
  });

  it('overrides defaults from env', () => {
    process.env.AGENTLENS_INGEST_URL = 'http://api:3001/v1/spans';
    process.env.PORT = '9090';
    process.env.PROJECT_CACHE_TTL_MS = '30000';
    process.env.LOG_LEVEL = 'debug';
    const config = loadConfig();
    expect(config.port).toBe(9090);
    expect(config.projectCacheTtlMs).toBe(30_000);
    expect(config.logLevel).toBe('debug');
  });
});
