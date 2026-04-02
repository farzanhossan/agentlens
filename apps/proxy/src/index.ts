// src/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { loadConfig } from './config';
import { parseProxyRoute } from './router';
import { handleProxyRequest } from './proxy';
import { SpanEmitter } from './span-emitter';
import { ProjectCache } from './project-cache';
import { PROVIDER_UPSTREAMS } from './parsers';

const config = loadConfig();
const emitter = new SpanEmitter(config.ingestUrl, config.ingestApiKey);
const projectCache = new ProjectCache(config.projectValidationUrl, config.projectCacheTtlMs);

const app = new Hono();

app.use('*', logger());
app.use('*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// Proxy catch-all route
app.all('/v1/p/*', async (c) => {
  const route = parseProxyRoute(c.req.path);
  if (!route) {
    return c.json({ error: 'Invalid proxy route' }, 400);
  }

  // Validate project
  const valid = await projectCache.isValid(route.projectId);
  if (!valid) {
    return c.json({ error: 'Invalid project ID' }, 401);
  }

  // Determine upstream base URL
  let upstreamBaseUrl = PROVIDER_UPSTREAMS[route.provider];
  if (!upstreamBaseUrl) {
    // Generic provider: require X-AgentLens-Upstream header
    upstreamBaseUrl = c.req.header('X-AgentLens-Upstream') || '';
    if (!upstreamBaseUrl) {
      return c.json({ error: 'X-AgentLens-Upstream header required for generic provider' }, 400);
    }
  }

  // Read request body (only for methods that have a body)
  const method = c.req.method;
  let requestBody: unknown = null;
  if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    try {
      requestBody = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
  }

  // Extract headers to forward
  const requestHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });

  const response = await handleProxyRequest({
    method,
    provider: route.provider,
    projectId: route.projectId,
    upstreamPath: route.upstreamPath,
    upstreamBaseUrl,
    requestBody,
    requestHeaders,
    emitter,
    bufferMaxSize: config.bufferMaxSize,
  });

  return response;
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

const port = config.port;
console.log(`AgentLens Proxy listening on :${port}`);
serve({ fetch: app.fetch, port });

export default app;
