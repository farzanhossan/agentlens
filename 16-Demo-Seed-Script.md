Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

You are building the demo seed script for AgentLens.

When a new user signs up, their dashboard is empty. That's a bad first
impression. This seed script populates the dashboard with realistic demo
data so the product feels alive immediately.

Create these files:

---

## FILE 1 — scripts/seed-demo.ts

A standalone TypeScript script that:

### Creates a demo org + project
```
Org: "Demo Corp"
Project: "customer-support-agent"
User: demo@agentlens.dev / Demo1234!
```

### Seeds 500 traces over the last 30 days

Each trace should feel realistic:

Agent types to simulate (rotate between them):
- "customer-support-agent" — answers customer questions
- "code-review-agent" — reviews pull requests
- "data-extraction-agent" — extracts info from documents
- "email-draft-agent" — drafts email responses

Models to use (mix realistically):
- gpt-4o (40% of calls)
- gpt-4o-mini (35% of calls)
- claude-3-5-sonnet (20% of calls)
- claude-3-haiku (5% of calls)

Realistic distribution:
- 92% success, 5% error, 3% timeout
- Latency: 800ms–4500ms (normal distribution around 1800ms)
- Input tokens: 200–2000 (varies by agent type)
- Output tokens: 50–800
- Cost calculated from real model pricing

Each trace has 1–5 spans (nested):
- Span 1: "classify-intent" (fast, 200–500ms)
- Span 2: "retrieve-context" (medium, 400–900ms)
- Span 3: "generate-response" (slow, 1000–3000ms) — the main LLM call
- Span 4 (optional): "validate-output" (fast, 100–300ms)
- Span 5 (optional): "format-response" (fast, 50–150ms)

Realistic inputs/outputs per agent:
customer-support-agent:
  inputs: ["How do I reset my password?", "My order hasn't arrived", "I want a refund", ...]
  outputs: ["To reset your password, go to Settings > Security...", ...]

code-review-agent:
  inputs: ["Review this TypeScript function for bugs...", "Is this SQL query safe from injection?", ...]
  outputs: ["I found 2 issues: 1. Missing null check on line 15...", ...]

data-extraction-agent:
  inputs: ["Extract all dates from this contract...", "Find the total amount in this invoice...", ...]
  outputs: ["Extracted dates: 2024-01-15, 2024-03-20...", ...]

email-draft-agent:
  inputs: ["Draft a follow-up email to client about the delayed project...", ...]
  outputs: ["Subject: Project Update — Timeline Revision\n\nDear [Client]...", ...]

### Error traces (realistic errors)
For the 5% error traces, use realistic error messages:
- "Rate limit exceeded: too many requests per minute"
- "Context length exceeded: prompt too long for model"
- "Connection timeout after 30000ms"
- "Invalid API key provided"
- "Model overloaded, please retry"

### Seeds 3 alerts
1. Error rate alert (threshold: 10%, channel: slack)
2. Cost spike alert (threshold: $5/hour, channel: email)
3. Latency P95 alert (threshold: 5000ms, channel: webhook)

### Seeds Elasticsearch with full span payloads
Every span gets indexed to Elasticsearch with the input/output text
so search actually works in the demo.

### Time distribution
Distribute traces over 30 days with:
- Higher volume on weekdays (Mon–Fri)
- Lower volume on weekends
- Peak hours: 9am–6pm UTC
- Random noise to look natural

---

## FILE 2 — scripts/seed-demo.config.ts

Config file so the seed can be customized:
```typescript
export const seedConfig = {
  traceCount: 500,
  daysBack: 30,
  agentName: 'customer-support-agent',
  errorRate: 0.05,
  timeoutRate: 0.03,
  // ... etc
}
```

---

## FILE 3 — scripts/reset-demo.ts

Opposite of seed — wipes all demo data:
```typescript
// Deletes everything for the demo org
// Useful for resetting the demo environment
```

---

## FILE 4 — Add seed commands to root package.json scripts

```json
{
  "scripts": {
    "seed:demo": "npx tsx scripts/seed-demo.ts",
    "seed:reset": "npx tsx scripts/reset-demo.ts",
    "seed:fresh": "pnpm seed:reset && pnpm seed:demo"
  }
}
```

---

## FILE 5 — Add seed to Makefile

```makefile
seed:        ## Seed demo data
	pnpm seed:demo

seed-reset:  ## Reset demo data
	pnpm seed:reset

seed-fresh:  ## Fresh seed (reset + seed)
	pnpm seed:fresh
```

---

## Requirements

- Script connects directly to PostgreSQL via TypeORM (not through API)
- Script connects directly to Elasticsearch for indexing
- Uses the same entity classes from apps/api/src/database/entities/
- Idempotent — running it twice doesn't duplicate data (check if demo org exists first)
- Progress output:
  ```
  🌱 Seeding AgentLens demo data...
  ✓ Created demo org: Demo Corp
  ✓ Created demo project: customer-support-agent
  ✓ Seeding 500 traces over 30 days...
  ████████████████████ 100% | 500/500 traces
  ✓ Indexed 1,847 spans to Elasticsearch
  ✓ Created 3 alerts

  🎉 Done! Seed complete in 12.3s
  
  Dashboard: http://localhost:5173
  Login: demo@agentlens.dev / Demo1234!
  ```
- Runs in under 30 seconds
- All fake data looks realistic — not obviously lorem ipsum
- No external API calls — all data is generated locally
- TypeScript strict — no any
