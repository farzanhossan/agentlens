/**
 * scripts/seed-demo.ts
 *
 * Populates AgentLens with realistic demo data so a fresh dashboard feels alive.
 * Run with:  pnpm seed:demo
 *
 * Idempotent — running twice will not duplicate data.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Client as EsClient } from '@elastic/elasticsearch';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

import { seedConfig } from './seed-demo.config';
import type { AgentName, ModelWeight } from './seed-demo.config';

// ── Entity imports ─────────────────────────────────────────────────────────────
// Resolved relative to project root when running with tsx.
import {
  AlertChannel,
  AlertEntity,
  AlertType,
  OrganizationEntity,
  OrgPlan,
  ProjectEntity,
  SpanEntity,
  SpanStatus,
  TraceEntity,
  TraceStatus,
  UserEntity,
  UserRole,
} from '../apps/api/src/database/entities/index';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SpanSpec {
  name: string;
  minMs: number;
  maxMs: number;
  isLlmCall: boolean;
}

interface GeneratedSpan {
  id: string;
  name: string;
  parentSpanId: string | undefined;
  latencyMs: number;
  startedAt: Date;
  endedAt: Date;
  input: string | undefined;
  output: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  costUsd: number | undefined;
  status: SpanStatus;
  errorMessage: string | undefined;
  model: string | undefined;
  provider: string | undefined;
}

// ── Agent content library ──────────────────────────────────────────────────────

const AGENT_CONTENT: Record<AgentName, { inputs: string[]; outputs: string[] }> = {
  'customer-support-agent': {
    inputs: [
      'How do I reset my password?',
      "My order hasn't arrived yet and it's been 2 weeks.",
      'I want to request a full refund for my recent purchase.',
      'Can you help me update my billing information?',
      "I'm having trouble logging into my account.",
      'How do I cancel my subscription?',
      'What are your business hours for live support?',
      "I was charged twice for the same order. Can you fix this?",
      'How do I change the email address on my account?',
      'My coupon code is not working at checkout.',
      "I need to return an item that arrived damaged.",
      'Can I upgrade my plan mid-billing cycle?',
    ],
    outputs: [
      "To reset your password, go to Settings > Security > Change Password. You'll receive a reset link via email within a few minutes.",
      "I'm sorry for the inconvenience. I've checked your order status and it shows as in transit. I'll escalate this to our fulfilment team and you should receive an update within 24 hours.",
      "I've processed your refund request. The amount will be returned to your original payment method within 5–7 business days.",
      "To update your billing information, navigate to Account > Billing > Payment Methods. You can add a new card or update existing details there.",
      "It looks like your account may have been temporarily locked after multiple failed login attempts. I've sent a verification email to unlock it.",
      "To cancel your subscription, go to Account > Subscription > Cancel Plan. Your access will remain active until the end of the current billing period.",
      'Our support team is available Monday–Friday, 9 AM–6 PM UTC. For urgent issues, our chatbot is available 24/7.',
      "I can see a duplicate charge on your account. I've initiated a refund for the second charge and you should see it reversed within 3–5 business days.",
      "To change your email, go to Settings > Profile > Contact Information. You'll need to verify the new address before the change takes effect.",
      "I've checked your coupon code and it appears to have expired. I'd be happy to apply a 10% discount to your current order as a courtesy.",
    ],
  },
  'code-review-agent': {
    inputs: [
      'Review this TypeScript function for potential null pointer exceptions:\n```ts\nfunction getUser(id: string) {\n  return db.users.find(u => u.id === id).name;\n}\n```',
      'Is this SQL query safe from injection attacks?\n```sql\nconst query = `SELECT * FROM users WHERE email = \'${email}\'`;\n```',
      "Check this React component for performance issues:\n```tsx\nfunction List({ items }) {\n  return items.map(i => <div onClick={() => handleClick(i)}>{i.name}</div>);\n}\n```",
      'Review this API endpoint for security vulnerabilities:\n```ts\napp.get("/file", (req, res) => {\n  res.sendFile(req.query.path);\n});\n```',
      "Does this function handle edge cases correctly?\n```py\ndef divide(a, b):\n    return a / b\n```",
      'Review this authentication middleware for issues:\n```ts\nfunction auth(req, res, next) {\n  const token = req.headers.token;\n  if (jwt.verify(token, secret)) next();\n}\n```',
    ],
    outputs: [
      "I found 2 issues: 1. Missing null check — `db.users.find()` returns `undefined` if no match, causing a runtime error on `.name`. Fix: `return db.users.find(u => u.id === id)?.name ?? null`. 2. Consider using `findById` or an indexed lookup for better performance.",
      "This query is vulnerable to SQL injection. Never interpolate user input directly into SQL strings. Fix: use parameterised queries — `db.query('SELECT * FROM users WHERE email = $1', [email])`. This applies to all database drivers.",
      "Performance issues found: 1. Inline arrow functions in `onClick` create new function references on every render, preventing React from memoising list items. Fix: extract handler and use `useCallback`. 2. Missing `key` prop on list items will cause reconciliation warnings.",
      "Critical path traversal vulnerability: `req.query.path` allows an attacker to read any file on the server (e.g., `/etc/passwd`). Fix: validate and sanitise the path, confine it to a whitelist directory using `path.resolve` and check it starts with the expected base path.",
      "Edge case not handled: division by zero when `b === 0` raises `ZeroDivisionError` in Python. Fix: add a guard — `if b == 0: raise ValueError('Divisor cannot be zero')` or return `None` depending on your contract.",
      "Two issues: 1. Missing error handling — `jwt.verify` throws on invalid tokens; wrap in try/catch and return 401. 2. The token should be read from `Authorization: Bearer <token>` header, not a custom `token` header, to follow OAuth 2.0 conventions.",
    ],
  },
  'data-extraction-agent': {
    inputs: [
      'Extract all dates mentioned in this contract:\n"This agreement is effective from January 15, 2024 and shall terminate on December 31, 2025, with a review period beginning October 1, 2025."',
      'Find the total invoice amount and line items from:\n"Invoice #INV-2024-0892\nConsulting Services: $4,500.00\nSoftware License: $1,200.00\nSupport Package: $800.00\nSubtotal: $6,500.00\nTax (8%): $520.00\nTotal Due: $7,020.00"',
      "Extract all person names and their roles from this meeting transcript:\n\"John Smith (CEO) opened the meeting. Sarah Johnson (CFO) presented Q3 results. Mike Chen (CTO) discussed the product roadmap.\"",
      "Parse the following address into structured components:\n\"742 Evergreen Terrace, Springfield, IL 62704, United States\"",
      "Extract all product SKUs and quantities from this order:\n\"Order #ORD-55821: SKU-A1023 x3, SKU-B0044 x1, SKU-C2219 x5, SKU-A1023 x2 (replacement)\"",
    ],
    outputs: [
      "Extracted dates:\n- Effective date: 2024-01-15\n- Termination date: 2025-12-31\n- Review period start: 2025-10-01\n\nAll dates converted to ISO 8601 format.",
      "Invoice summary:\n- Invoice number: INV-2024-0892\n- Line items: Consulting Services ($4,500.00), Software License ($1,200.00), Support Package ($800.00)\n- Subtotal: $6,500.00\n- Tax: $520.00 (8%)\n- Total due: $7,020.00",
      "Extracted persons:\n1. John Smith — CEO\n2. Sarah Johnson — CFO\n3. Mike Chen — CTO",
      "Structured address:\n- Street: 742 Evergreen Terrace\n- City: Springfield\n- State: IL\n- ZIP: 62704\n- Country: United States",
      "Extracted SKUs:\n- SKU-A1023: 5 units (3 + 2 replacement)\n- SKU-B0044: 1 unit\n- SKU-C2219: 5 units\n\nNote: SKU-A1023 appears twice; quantities merged.",
    ],
  },
  'email-draft-agent': {
    inputs: [
      'Draft a follow-up email to a client about a project that is 2 weeks behind schedule.',
      'Write a professional response declining a meeting request due to scheduling conflicts.',
      'Compose an email introducing our new pricing plan to existing customers.',
      'Draft an apology email to a customer whose order was lost in transit.',
      "Write an email to a new hire welcoming them to the team and outlining their first week.",
      'Compose a renewal reminder email for customers whose subscription expires in 30 days.',
    ],
    outputs: [
      "Subject: Project Update — Revised Timeline\n\nDear [Client Name],\n\nI hope this message finds you well. I wanted to reach out personally regarding the current status of your project.\n\nDue to unforeseen technical complexities, we are currently running approximately two weeks behind our original schedule. I sincerely apologise for this delay and want to assure you that our team is fully committed to delivering the highest quality outcome.\n\nWe have identified the root causes and have put additional resources in place to accelerate progress. I'd welcome the opportunity to schedule a brief call this week to walk you through our revised timeline.\n\nThank you for your continued patience and understanding.\n\nBest regards,\n[Your Name]",
      "Subject: Re: Meeting Request — Alternative Availability\n\nDear [Name],\n\nThank you for reaching out and for the kind invitation to meet.\n\nUnfortunately, I have a prior commitment during the proposed time and am unable to attend. I would very much like to connect — could we explore an alternative time? I have availability on [Date 1] or [Date 2] if either works for your schedule.\n\nLooking forward to speaking with you.\n\nBest regards,\n[Your Name]",
      "Subject: Introducing Our New Pricing Plans\n\nDear [Customer Name],\n\nWe're excited to share some important updates to our pricing structure, designed with you in mind.\n\nStarting [Date], we will be introducing three new tiers — Starter, Professional, and Enterprise — each tailored to different usage needs. As a valued existing customer, you will be grandfathered into your current rate for the next 12 months.\n\nVisit our pricing page to explore the new plans or speak with our team to find the best fit for your needs.\n\nThank you for being part of our community.\n\nWarm regards,\n[Company Name] Team",
      "Subject: Sincere Apologies — Your Order\n\nDear [Customer Name],\n\nI am writing to sincerely apologise for the loss of your recent order #[Order Number]. This falls well below the standard of service we hold ourselves to, and I am deeply sorry for the inconvenience this has caused.\n\nI have arranged for an immediate replacement to be shipped via express delivery at no charge. You should receive a tracking confirmation within the next few hours.\n\nAs a gesture of goodwill, I have also added a 20% discount to your account for your next purchase.\n\nThank you for your patience, and please do not hesitate to contact me directly if you need anything further.\n\nSincerely,\n[Your Name]",
    ],
  },
};

const ERROR_MESSAGES = [
  'Rate limit exceeded: too many requests per minute',
  'Context length exceeded: prompt too long for model',
  'Connection timeout after 30000ms',
  'Invalid API key provided',
  'Model overloaded, please retry',
];

const SPAN_PIPELINE: SpanSpec[] = [
  { name: 'classify-intent',   minMs: 200,  maxMs: 500,  isLlmCall: false },
  { name: 'retrieve-context',  minMs: 400,  maxMs: 900,  isLlmCall: false },
  { name: 'generate-response', minMs: 1000, maxMs: 3000, isLlmCall: true  },
  { name: 'validate-output',   minMs: 100,  maxMs: 300,  isLlmCall: false },
  { name: 'format-response',   minMs: 50,   maxMs: 150,  isLlmCall: false },
];

const AGENT_NAMES: AgentName[] = [
  'customer-support-agent',
  'code-review-agent',
  'data-extraction-agent',
  'email-draft-agent',
];

// ── Utility helpers ────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Box-Muller normal distribution sample. */
function randNormal(mean: number, stdDev: number): number {
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random() || 1e-10;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function pickWeightedModel(): ModelWeight {
  const r = Math.random();
  for (const m of seedConfig.models) {
    if (r <= m.weight) return m;
  }
  return seedConfig.models[seedConfig.models.length - 1] as ModelWeight;
}

function calcCost(model: ModelWeight, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1000) * model.inputCostPer1k +
    (outputTokens / 1000) * model.outputCostPer1k
  );
}

/**
 * Returns a random timestamp within the last `daysBack` days, weighted toward
 * weekdays and peak hours.
 */
function randomTimestamp(daysBack: number): Date {
  const now = Date.now();
  const windowMs = daysBack * 24 * 60 * 60 * 1000;

  for (let attempts = 0; attempts < 100; attempts++) {
    const candidate = new Date(now - Math.random() * windowMs);
    const dayOfWeek = candidate.getUTCDay(); // 0=Sun, 6=Sat
    const hour = candidate.getUTCHours();

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPeak = hour >= seedConfig.peakHourStart && hour <= seedConfig.peakHourEnd;

    // Accept with probability proportional to desired volume
    const weekendThreshold = 1 / seedConfig.weekdayMultiplier;
    if (isWeekend && Math.random() > weekendThreshold) continue;
    if (!isPeak && Math.random() > 0.35) continue;

    return candidate;
  }

  // Fallback — should rarely hit
  return new Date(now - Math.random() * windowMs);
}

// ── Span generation ────────────────────────────────────────────────────────────

function generateSpans(
  traceId: string,
  projectId: string,
  traceStartedAt: Date,
  agentName: AgentName,
  traceStatus: TraceStatus,
  model: ModelWeight,
  inputTokens: number,
  outputTokens: number,
  totalLatencyMs: number,
): GeneratedSpan[] {
  const spanCount = randInt(1, 5); // 1–5 spans
  const specs = SPAN_PIPELINE.slice(0, spanCount);
  const content = AGENT_CONTENT[agentName];
  const hasError = traceStatus === TraceStatus.ERROR;
  const hasTimeout = traceStatus === TraceStatus.TIMEOUT;

  const spans: GeneratedSpan[] = [];
  let cursor = traceStartedAt.getTime();
  let rootSpanId: string | undefined;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i] as SpanSpec;
    const spanId = randomUUID();
    const isRoot = i === 0;
    const isLast = i === specs.length - 1;
    const isLlmCall = spec.isLlmCall;

    const latencyMs = isLlmCall
      ? clamp(
          Math.round(randNormal(totalLatencyMs * 0.6, 300)),
          spec.minMs,
          Math.max(spec.maxMs, totalLatencyMs),
        )
      : randInt(spec.minMs, spec.maxMs);

    const startedAt = new Date(cursor);
    const endedAt = new Date(cursor + latencyMs);
    cursor += latencyMs;

    // Determine span status
    let spanStatus: SpanStatus = SpanStatus.SUCCESS;
    let errorMessage: string | undefined;

    if (isLast && hasError) {
      spanStatus = SpanStatus.ERROR;
      errorMessage = pickRandom(ERROR_MESSAGES);
    } else if (isLast && hasTimeout) {
      spanStatus = SpanStatus.TIMEOUT;
      errorMessage = 'Operation timed out';
    }

    spans.push({
      id: spanId,
      name: spec.name,
      parentSpanId: isRoot ? undefined : rootSpanId,
      latencyMs,
      startedAt,
      endedAt,
      input: isLlmCall ? pickRandom(content.inputs) : undefined,
      output: isLlmCall && spanStatus === SpanStatus.SUCCESS ? pickRandom(content.outputs) : undefined,
      inputTokens: isLlmCall ? inputTokens : undefined,
      outputTokens: isLlmCall && spanStatus === SpanStatus.SUCCESS ? outputTokens : undefined,
      costUsd: isLlmCall ? calcCost(model, inputTokens, outputTokens) : undefined,
      status: spanStatus,
      errorMessage,
      model: isLlmCall ? model.model : undefined,
      provider: isLlmCall ? model.provider : undefined,
    });

    if (isRoot) rootSpanId = spanId;
  }

  return spans;
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function renderProgress(done: number, total: number): void {
  const width = 20;
  const pct = done / total;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const label = `${bar} ${Math.round(pct * 100)}% | ${done}/${total} traces`;
  process.stdout.write(`\r  ${label}`);
  if (done === total) process.stdout.write('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();
  const cfg = seedConfig;

  console.log('\n🌱 Seeding AgentLens demo data...\n');

  // ── Database connection ──────────────────────────────────────────────────
  const DATABASE_URL =
    process.env['DATABASE_URL'] ?? 'postgresql://agentlens:agentlens@localhost:5432/agentlens';

  const dataSource = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    synchronize: false,
    entities: [
      OrganizationEntity,
      ProjectEntity,
      TraceEntity,
      SpanEntity,
      AlertEntity,
      UserEntity,
    ],
    logging: false,
  });

  await dataSource.initialize();

  // ── Elasticsearch connection ─────────────────────────────────────────────
  const ES_URL = process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200';
  const esClient = new EsClient({
    node: ES_URL,
    auth: {
      username: process.env['ELASTICSEARCH_USERNAME'] ?? 'elastic',
      password: process.env['ELASTICSEARCH_PASSWORD'] ?? 'agentlens',
    },
    tls: { rejectUnauthorized: false },
    requestTimeout: 30_000,
  });

  const orgRepo   = dataSource.getRepository(OrganizationEntity);
  const userRepo  = dataSource.getRepository(UserEntity);
  const projRepo  = dataSource.getRepository(ProjectEntity);
  const traceRepo = dataSource.getRepository(TraceEntity);
  const spanRepo  = dataSource.getRepository(SpanEntity);
  const alertRepo = dataSource.getRepository(AlertEntity);

  try {
    // ── Idempotency check ──────────────────────────────────────────────────
    let org = await orgRepo.findOneBy({ slug: cfg.orgSlug });

    if (org) {
      console.log(`  ℹ️  Demo org "${cfg.orgName}" already exists — skipping creation.`);
    } else {
      org = orgRepo.create({
        name: cfg.orgName,
        slug: cfg.orgSlug,
        plan: OrgPlan.PRO,
      });
      await orgRepo.save(org);
      console.log(`  ✓ Created demo org: ${cfg.orgName}`);
    }

    // ── User ───────────────────────────────────────────────────────────────
    let user = await userRepo.findOneBy({ email: cfg.userEmail });
    if (!user) {
      const passwordHash = await bcrypt.hash(cfg.userPassword, 12);
      user = userRepo.create({
        orgId: org.id,
        email: cfg.userEmail,
        passwordHash,
        role: UserRole.OWNER,
      });
      await userRepo.save(user);
      console.log(`  ✓ Created demo user: ${cfg.userEmail}`);
    }

    // ── Project ────────────────────────────────────────────────────────────
    let project = await projRepo.findOneBy({ organizationId: org.id, name: cfg.projectName });
    if (!project) {
      // Use a deterministic-looking API key for demo (not a real secret)
      const apiKey = `al_demo_${randomUUID().replace(/-/g, '')}`;
      project = projRepo.create({
        organizationId: org.id,
        name: cfg.projectName,
        apiKey,
        description: 'Demo project — auto-seeded for onboarding.',
        retentionDays: 30,
      });
      await projRepo.save(project);
      console.log(`  ✓ Created demo project: ${cfg.projectName}`);
    }

    // ── Ensure ES index ────────────────────────────────────────────────────
    const INDEX = 'agentlens_spans';
    const indexExists = await esClient.indices.exists({ index: INDEX });
    if (!indexExists) {
      await esClient.indices.create({
        index: INDEX,
        body: {
          mappings: {
            properties: {
              spanId:       { type: 'keyword' },
              traceId:      { type: 'keyword' },
              parentSpanId: { type: 'keyword' },
              projectId:    { type: 'keyword' },
              name:         { type: 'keyword' },
              model:        { type: 'keyword' },
              provider:     { type: 'keyword' },
              status:       { type: 'keyword' },
              input:        { type: 'text', analyzer: 'standard' },
              output:       { type: 'text', analyzer: 'standard' },
              startedAt:    { type: 'date' },
              endedAt:      { type: 'date' },
              inputTokens:  { type: 'integer' },
              outputTokens: { type: 'integer' },
              costUsd:      { type: 'float' },
              latencyMs:    { type: 'integer' },
              errorMessage: { type: 'text' },
              metadata:     { type: 'object', dynamic: true },
            },
          },
          settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: '5s' },
        },
      });
    }

    // ── Traces + spans ─────────────────────────────────────────────────────
    console.log(`  ✓ Seeding ${cfg.traceCount} traces over ${cfg.daysBack} days...`);

    let totalSpansIndexed = 0;
    const ES_BATCH = 50; // spans per ES bulk call
    const DB_BATCH = 50; // traces per DB insert

    const traceBuffer: TraceEntity[] = [];
    const spanBuffer:  SpanEntity[]  = [];
    const esBulkOps: Array<Record<string, unknown>> = [];

    const agentList = [...AGENT_NAMES];

    for (let i = 0; i < cfg.traceCount; i++) {
      const agentName = agentList[i % agentList.length] as AgentName;
      const model = pickWeightedModel();
      const traceId = randomUUID();

      // Determine trace status
      const roll = Math.random();
      let traceStatus: TraceStatus;
      if (roll < cfg.successRate) {
        traceStatus = TraceStatus.SUCCESS;
      } else if (roll < cfg.successRate + cfg.errorRate) {
        traceStatus = TraceStatus.ERROR;
      } else {
        traceStatus = TraceStatus.TIMEOUT;
      }

      const totalLatencyMs = clamp(
        Math.round(randNormal(cfg.latencyMeanMs, cfg.latencyStdDevMs)),
        cfg.latencyMinMs,
        cfg.latencyMaxMs,
      );

      const inputTokens  = randInt(cfg.inputTokensMin, cfg.inputTokensMax);
      const outputTokens = traceStatus === TraceStatus.SUCCESS
        ? randInt(cfg.outputTokensMin, cfg.outputTokensMax)
        : randInt(10, 50);

      const traceStartedAt = randomTimestamp(cfg.daysBack);
      const traceEndedAt   = new Date(traceStartedAt.getTime() + totalLatencyMs);

      const generatedSpans = generateSpans(
        traceId,
        project.id,
        traceStartedAt,
        agentName,
        traceStatus,
        model,
        inputTokens,
        outputTokens,
        totalLatencyMs,
      );

      const totalCostUsd = generatedSpans.reduce(
        (sum, s) => sum + (s.costUsd ?? 0),
        0,
      );

      // Build TraceEntity
      const trace = traceRepo.create({
        id: traceId,
        projectId: project.id,
        agentName,
        status: traceStatus,
        totalSpans: generatedSpans.length,
        totalTokens: inputTokens + outputTokens,
        totalCostUsd: totalCostUsd.toFixed(6),
        totalLatencyMs,
        startedAt: traceStartedAt,
        endedAt: traceEndedAt,
        metadata: { seedDemo: true },
      });
      traceBuffer.push(trace);

      // Build SpanEntity + ES doc for each span
      for (const gs of generatedSpans) {
        const spanEntity = spanRepo.create({
          id: gs.id,
          traceId,
          projectId: project.id,
          parentSpanId: gs.parentSpanId,
          name: gs.name,
          model: gs.model,
          provider: gs.provider,
          inputTokens: gs.inputTokens,
          outputTokens: gs.outputTokens,
          costUsd: gs.costUsd !== undefined ? gs.costUsd.toFixed(6) : undefined,
          latencyMs: gs.latencyMs,
          status: gs.status,
          errorMessage: gs.errorMessage,
          startedAt: gs.startedAt,
          endedAt: gs.endedAt,
          metadata: { seedDemo: true },
        });
        spanBuffer.push(spanEntity);

        if (gs.input !== undefined || gs.output !== undefined) {
          esBulkOps.push({ index: { _index: INDEX, _id: gs.id } });
          esBulkOps.push({
            spanId:       gs.id,
            traceId,
            parentSpanId: gs.parentSpanId,
            projectId:    project.id,
            name:         gs.name,
            model:        gs.model,
            provider:     gs.provider,
            status:       gs.status,
            input:        gs.input,
            output:       gs.output,
            startedAt:    gs.startedAt.toISOString(),
            endedAt:      gs.endedAt.toISOString(),
            inputTokens:  gs.inputTokens,
            outputTokens: gs.outputTokens,
            costUsd:      gs.costUsd,
            latencyMs:    gs.latencyMs,
            errorMessage: gs.errorMessage,
            metadata:     { seedDemo: true },
          });
        }
      }

      // Flush DB buffers
      if (traceBuffer.length >= DB_BATCH || i === cfg.traceCount - 1) {
        await traceRepo.save(traceBuffer.splice(0));
        await spanRepo.save(spanBuffer.splice(0));
      }

      // Flush ES buffer
      if (esBulkOps.length >= ES_BATCH * 2 || i === cfg.traceCount - 1) {
        if (esBulkOps.length > 0) {
          const resp = await esClient.bulk({ body: esBulkOps.splice(0), refresh: false });
          totalSpansIndexed += resp.items.length;
        }
      }

      renderProgress(i + 1, cfg.traceCount);
    }

    console.log(`  ✓ Indexed ${totalSpansIndexed.toLocaleString()} spans to Elasticsearch`);

    // ── Alerts ─────────────────────────────────────────────────────────────
    const existingAlerts = await alertRepo.countBy({ projectId: project.id });
    if (existingAlerts === 0) {
      const alerts: Partial<AlertEntity>[] = [
        {
          projectId: project.id,
          name: 'High Error Rate',
          type: AlertType.ERROR_RATE,
          threshold: '10.0000',
          channel: AlertChannel.SLACK,
          channelConfig: { webhookUrl: 'https://hooks.slack.com/services/DEMO/DEMO/DEMO' },
          isActive: true,
        },
        {
          projectId: project.id,
          name: 'Cost Spike',
          type: AlertType.COST_SPIKE,
          threshold: '5.0000',
          channel: AlertChannel.EMAIL,
          channelConfig: { to: 'alerts@democorp.com' },
          isActive: true,
        },
        {
          projectId: project.id,
          name: 'Latency P95 Alert',
          type: AlertType.LATENCY_P95,
          threshold: '5000.0000',
          channel: AlertChannel.WEBHOOK,
          channelConfig: { url: 'https://alerts.democorp.com/webhook' },
          isActive: true,
        },
      ];

      await alertRepo.save(alerts.map((a) => alertRepo.create(a)));
      console.log('  ✓ Created 3 alerts');
    } else {
      console.log('  ℹ️  Alerts already exist — skipping.');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 Done! Seed complete in ${elapsed}s\n`);
    console.log('  Dashboard: http://localhost:5173');
    console.log(`  Login:     ${cfg.userEmail} / ${cfg.userPassword}\n`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ Seed failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
