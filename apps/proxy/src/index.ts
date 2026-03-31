import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

const port = parseInt(process.env.PORT || '8080', 10);
console.log(`AgentLens Proxy listening on :${port}`);
serve({ fetch: app.fetch, port });

export default app;
