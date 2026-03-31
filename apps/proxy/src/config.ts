export interface ProxyConfig {
  ingestUrl: string;
  ingestApiKey: string;
  port: number;
  projectValidationUrl?: string;
  projectCacheTtlMs: number;
  maxBodySize: number;       // bytes
  bufferMaxSize: number;     // bytes
  logLevel: string;
}

export function loadConfig(): ProxyConfig {
  const ingestUrl = process.env.AGENTLENS_INGEST_URL;
  if (!ingestUrl) {
    throw new Error('AGENTLENS_INGEST_URL is required');
  }

  return {
    ingestUrl,
    ingestApiKey: process.env.AGENTLENS_INGEST_API_KEY || 'proxy-internal',
    port: parseInt(process.env.PORT || '8080', 10),
    projectValidationUrl: process.env.PROJECT_VALIDATION_URL,
    projectCacheTtlMs: parseInt(process.env.PROJECT_CACHE_TTL_MS || '60000', 10),
    maxBodySize: parseBytes(process.env.MAX_BODY_SIZE || '10mb'),
    bufferMaxSize: parseBytes(process.env.BUFFER_MAX_SIZE || '10mb'),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function parseBytes(value: string): number {
  const match = value.match(/^(\d+)(mb|kb|b)?$/i);
  if (!match) return 10 * 1024 * 1024;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'b').toLowerCase();
  if (unit === 'mb') return num * 1024 * 1024;
  if (unit === 'kb') return num * 1024;
  return num;
}
