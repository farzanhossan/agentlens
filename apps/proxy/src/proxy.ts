import { randomUUID } from 'node:crypto';
import { getParser } from './parsers';
import type { SpanEmitter, SpanPayload } from './span-emitter';

export interface ProxyRequestParams {
  method: string;
  provider: string;
  projectId: string;
  upstreamPath: string;
  upstreamBaseUrl: string;
  requestBody: unknown;
  requestHeaders: Record<string, string>;
  emitter: SpanEmitter;
  bufferMaxSize: number;
}

const FORWARDED_HEADER_BLOCKLIST = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection',
  'x-agentlens-trace-id', 'x-agentlens-parent-span-id', 'x-agentlens-span-name',
]);

function filterHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!FORWARDED_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Ensure content-type is set without creating a duplicate key. */
function ensureContentType(headers: Record<string, string>): Record<string, string> {
  const hasContentType = Object.keys(headers).some(
    (k) => k.toLowerCase() === 'content-type',
  );
  if (hasContentType) return headers;
  return { ...headers, 'content-type': 'application/json' };
}

const RESPONSE_HEADER_BLOCKLIST = new Set([
  'transfer-encoding', 'connection', 'keep-alive',
]);

function forwardResponseHeaders(upstreamHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  upstreamHeaders.forEach((value, key) => {
    if (!RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      headers[key] = value;
    }
  });
  return headers;
}

export async function handleProxyRequest(params: ProxyRequestParams): Promise<Response> {
  const { method, provider, projectId, upstreamPath, upstreamBaseUrl, requestBody, requestHeaders, emitter } = params;
  const parser = getParser(provider);
  const parsed = requestBody ? parser.parseRequest(requestBody) : { model: 'unknown', input: '', isStreaming: false };
  const startedAt = new Date().toISOString();
  const spanId = randomUUID();
  const traceId = requestHeaders['x-agentlens-trace-id'] || randomUUID();
  const parentSpanId = requestHeaders['x-agentlens-parent-span-id'] || undefined;
  const spanName = requestHeaders['x-agentlens-span-name'] || `${provider}.proxy`;

  const upstreamUrl = `${upstreamBaseUrl}${upstreamPath}`;
  const forwardHeaders = filterHeaders(requestHeaders);

  if (parsed.isStreaming) {
    return handleStreamingRequest(params, parser, parsed, upstreamUrl, forwardHeaders, spanId, traceId, startedAt, parentSpanId, spanName);
  }

  // Non-streaming flow
  const hasBody = requestBody && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
  const upstreamHeaders = hasBody
    ? ensureContentType(forwardHeaders)
    : forwardHeaders;
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: method.toUpperCase(),
      headers: upstreamHeaders,
      ...(hasBody ? { body: JSON.stringify(requestBody) } : {}),
    });
  } catch (err) {
    const endedAt = new Date().toISOString();
    const errorMsg = (err as Error).message;
    emitter.emit({
      spanId, traceId, projectId,
      name: spanName, agentName: spanName, parentSpanId,
      model: parsed.model, provider,
      input: parsed.input,
      status: 'error', errorMessage: errorMsg,
      metadata: {}, startedAt, endedAt,
      latencyMs: Date.now() - new Date(startedAt).getTime(),
    });
    return new Response(JSON.stringify({ error: `Upstream unreachable: ${errorMsg}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const responseBody = await upstreamResponse.text();
  const endedAt = new Date().toISOString();
  const latencyMs = Date.now() - new Date(startedAt).getTime();

  let span: SpanPayload;
  if (upstreamResponse.ok) {
    try {
      const responseJson = JSON.parse(responseBody);
      const parsedResponse = parser.parseResponse(responseJson);
      const cost = parsedResponse.usage
        ? parser.computeCost(parsed.model, parsedResponse.usage)
        : undefined;
      span = {
        spanId, traceId, projectId,
        name: spanName, agentName: spanName, parentSpanId,
        model: parsed.model, provider,
        input: parsed.input,
        output: parsedResponse.output,
        inputTokens: parsedResponse.usage?.inputTokens,
        outputTokens: parsedResponse.usage?.outputTokens,
        costUsd: cost,
        latencyMs, status: 'success',
        metadata: {}, startedAt, endedAt,
      };
    } catch {
      span = {
        spanId, traceId, projectId,
        name: spanName, agentName: spanName, parentSpanId,
        model: parsed.model, provider,
        input: parsed.input, output: responseBody,
        latencyMs, status: 'success',
        metadata: {}, startedAt, endedAt,
      };
    }
  } else {
    span = {
      spanId, traceId, projectId,
      name: spanName, agentName: spanName, parentSpanId,
      model: parsed.model, provider,
      input: parsed.input,
      output: responseBody,
      latencyMs, status: 'error',
      errorMessage: `Upstream returned ${upstreamResponse.status}`,
      metadata: {}, startedAt, endedAt,
    };
  }

  emitter.emit(span);

  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  });
}

async function handleStreamingRequest(
  params: ProxyRequestParams,
  parser: ReturnType<typeof getParser>,
  parsed: ReturnType<ReturnType<typeof getParser>['parseRequest']>,
  upstreamUrl: string,
  forwardHeaders: Record<string, string>,
  spanId: string,
  traceId: string,
  startedAt: string,
  parentSpanId?: string,
  spanName?: string,
): Promise<Response> {
  const { provider, projectId, emitter, bufferMaxSize } = params;
  const resolvedSpanName = spanName || `${provider}.proxy`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: params.method.toUpperCase(),
      headers: ensureContentType(forwardHeaders),
      body: JSON.stringify(params.requestBody),
    });
  } catch (err) {
    const endedAt = new Date().toISOString();
    emitter.emit({
      spanId, traceId, projectId,
      name: resolvedSpanName, agentName: resolvedSpanName, parentSpanId,
      model: parsed.model, provider,
      input: parsed.input,
      status: 'error', errorMessage: (err as Error).message,
      metadata: {}, startedAt, endedAt,
      latencyMs: Date.now() - new Date(startedAt).getTime(),
    });
    return new Response(JSON.stringify({ error: 'Upstream unreachable' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstreamResponse.body) {
    return new Response('No response body', { status: 502 });
  }

  const dataLines: string[] = [];
  let accumulatedBytes = 0;
  let truncated = false;

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        if (!truncated) {
          const text = decoder.decode(value, { stream: true });
          accumulatedBytes += value.byteLength;
          if (accumulatedBytes > bufferMaxSize) {
            truncated = true;
          } else {
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                dataLines.push(trimmed.slice(6));
              }
            }
          }
        }
      }
      if (buffer.trim().startsWith('data: ')) {
        dataLines.push(buffer.trim().slice(6));
      }
    } catch (err) {
      console.error('[proxy] stream read error:', (err as Error).message);
    } finally {
      await writer.close();
      const endedAt = new Date().toISOString();
      const latencyMs = Date.now() - new Date(startedAt).getTime();
      const parsedResponse = parser.parseStreamChunks(dataLines);
      const cost = parsedResponse.usage
        ? parser.computeCost(parsed.model, parsedResponse.usage)
        : undefined;
      emitter.emit({
        spanId, traceId, projectId,
        name: resolvedSpanName, agentName: resolvedSpanName, parentSpanId,
        model: parsed.model, provider,
        input: parsed.input,
        output: parsedResponse.output,
        inputTokens: parsedResponse.usage?.inputTokens,
        outputTokens: parsedResponse.usage?.outputTokens,
        costUsd: cost,
        latencyMs,
        status: upstreamResponse.ok ? 'success' : 'error',
        metadata: truncated ? { truncated: true } : {},
        startedAt, endedAt,
      });
    }
  })();

  const responseHeaders = forwardResponseHeaders(upstreamResponse.headers);
  if (!responseHeaders['content-type']) {
    responseHeaders['content-type'] = 'text/event-stream';
  }
  responseHeaders['cache-control'] = 'no-cache';

  return new Response(readable, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
