Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

You are a QA engineer for AgentLens. Your job is to verify the ENTIRE platform is working correctly end-to-end.

Do the following steps IN ORDER. Stop and report clearly if anything fails.

---

## STEP 1 — Infrastructure Health Check

Run these checks and report status of each:

1. Check Docker containers are running:
   ```
   docker-compose -f infra/docker-compose.yml ps
   ```
   Expected: postgres, redis, elasticsearch all show "Up"

2. Test PostgreSQL connection:
   ```
   psql $DATABASE_URL -c "SELECT version();"
   ```

3. Test Redis connection:
   ```
   redis-cli -u $REDIS_URL ping
   ```
   Expected: PONG

4. Test Elasticsearch connection:
   ```
   curl http://localhost:9200/_cluster/health
   ```
   Expected: status "green" or "yellow"

Report: ✅ or ❌ for each with exact error if failing.

---

## STEP 2 — Build Verification

1. Run full build with no type errors:
   ```
   pnpm build
   ```

2. Run linter across all packages:
   ```
   pnpm lint
   ```

3. Run all unit tests:
   ```
   pnpm test
   ```

Report: total tests passed / failed / skipped.
List every failing test with the exact error message.

---

## STEP 3 — Database Schema Verification

Connect to PostgreSQL and verify:

1. All tables exist:
   - organizations
   - projects
   - traces
   - spans
   - alerts
   - users

2. All indexes exist:
   ```sql
   SELECT indexname, tablename FROM pg_indexes
   WHERE schemaname = 'public'
   ORDER BY tablename;
   ```

3. All enums exist:
   ```sql
   SELECT typname FROM pg_type WHERE typtype = 'e';
   ```

Report: ✅ or ❌ for each table, index, and enum.

---

## STEP 4 — API Health Check

Start the NestJS API if not running, then test:

1. Health endpoint:
   ```
   curl http://localhost:3000/health
   ```
   Expected: { "status": "ok" }

2. Swagger docs accessible:
   ```
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/docs
   ```
   Expected: 200

3. Auth - Register a test user:
   ```
   curl -X POST http://localhost:3000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@agentlens.dev","password":"Test1234!","orgName":"TestOrg"}'
   ```
   Expected: returns JWT token

4. Auth - Login with that user:
   ```
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@agentlens.dev","password":"Test1234!"}'
   ```
   Expected: returns JWT token

5. Create a project (use JWT from above):
   ```
   curl -X POST http://localhost:3000/projects \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"name":"test-project","description":"E2E test project"}'
   ```
   Expected: returns project with apiKey

Store the JWT and apiKey for next steps.

Report: ✅ or ❌ for each with response body on failure.

---

## STEP 5 — Span Ingestion Pipeline Test

Using the apiKey from Step 4:

1. Send a test span batch:
   ```
   curl -X POST http://localhost:3000/v1/spans \
     -H "X-API-Key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "spans": [
         {
           "spanId": "test-span-001",
           "traceId": "test-trace-001",
           "projectId": "$PROJECT_ID",
           "name": "test-llm-call",
           "model": "gpt-4o",
           "provider": "openai",
           "input": "What is 2+2?",
           "output": "4",
           "inputTokens": 10,
           "outputTokens": 5,
           "costUsd": 0.000015,
           "latencyMs": 850,
           "status": "success",
           "startedAt": "2025-01-01T00:00:00Z",
           "endedAt": "2025-01-01T00:00:00.850Z"
         }
       ]
     }'
   ```
   Expected: 202 Accepted

2. Wait 2 seconds for BullMQ to process, then verify span landed in PostgreSQL:
   ```sql
   SELECT id, name, model, status FROM spans WHERE id = 'test-span-001';
   ```
   Expected: 1 row returned

3. Verify trace was created/updated in PostgreSQL:
   ```sql
   SELECT id, status, "totalSpans" FROM traces WHERE id = 'test-trace-001';
   ```
   Expected: totalSpans = 1

4. Verify span payload indexed in Elasticsearch:
   ```
   curl "http://localhost:9200/agentlens_spans/_doc/test-span-001"
   ```
   Expected: found: true, with input/output fields

Report: ✅ or ❌ for each with exact data or error.

---

## STEP 6 — Dashboard API Test

Using JWT from Step 4:

1. List traces:
   ```
   curl "http://localhost:3000/projects/$PROJECT_ID/traces" \
     -H "Authorization: Bearer $JWT"
   ```
   Expected: array with 1 trace

2. Get trace detail with spans:
   ```
   curl "http://localhost:3000/projects/$PROJECT_ID/traces/test-trace-001" \
     -H "Authorization: Bearer $JWT"
   ```
   Expected: trace object with nested spans array

3. Get span detail (should include input/output from Elasticsearch):
   ```
   curl "http://localhost:3000/projects/$PROJECT_ID/spans/test-span-001" \
     -H "Authorization: Bearer $JWT"
   ```
   Expected: span with input="What is 2+2?" and output="4"

4. Get cost summary:
   ```
   curl "http://localhost:3000/projects/$PROJECT_ID/cost/summary" \
     -H "Authorization: Bearer $JWT"
   ```
   Expected: totalCost > 0

5. Search spans (Elasticsearch full-text):
   ```
   curl "http://localhost:3000/projects/$PROJECT_ID/spans/search?q=2%2B2" \
     -H "Authorization: Bearer $JWT"
   ```
   Expected: returns the test span

Report: ✅ or ❌ for each endpoint.

---

## STEP 7 — Alert Engine Test

1. Create a test alert:
   ```
   curl -X POST "http://localhost:3000/projects/$PROJECT_ID/alerts" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test Error Alert",
       "type": "error_rate",
       "threshold": 0.1,
       "channel": "webhook",
       "channelConfig": { "url": "https://httpbin.org/post" }
     }'
   ```
   Expected: alert created with isActive: true

2. Verify alert is stored:
   ```
   curl "http://localhost:3000/projects/$PROJECT_ID/alerts" \
     -H "Authorization: Bearer $JWT"
   ```
   Expected: array with 1 alert

Report: ✅ or ❌

---

## STEP 8 — SDK Integration Test

Create a file at the project root called test-sdk.ts and run it:

```typescript
import { AgentLens } from '@agentlens/core'

AgentLens.init({
  apiKey: process.env.TEST_API_KEY!,
  project: 'sdk-test',
  endpoint: 'http://localhost:3000'
})

async function main() {
  // Test basic trace
  const result = await AgentLens.trace('sdk-test-span', async (span) => {
    span.setInput({ message: 'hello from SDK test' })
    await new Promise(resolve => setTimeout(resolve, 100))
    span.setOutput({ response: 'SDK working correctly' })
    span.setMetadata('test', true)
    return 'success'
  })

  console.log('Trace result:', result)

  // Test PII scrubbing
  await AgentLens.trace('pii-test', async (span) => {
    span.setInput({
      message: 'My email is test@example.com and SSN is 123-45-6789'
    })
    span.setOutput({ response: 'PII should be redacted' })
  })

  // Flush all pending spans
  await AgentLens.flush()
  console.log('✅ SDK test complete. Check dashboard for traces.')
}

main().catch(console.error)
```

Run it:
```
TEST_API_KEY=$API_KEY npx tsx test-sdk.ts
```

Then verify in DB:
- Trace appeared with status=success
- PII test span has [REDACTED-EMAIL] and [REDACTED-SSN] in input

Report: ✅ or ❌

---

## STEP 9 — Frontend Smoke Test

1. Verify dashboard dev server is running:
   ```
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
   ```
   Expected: 200

2. Verify API is reachable from dashboard origin (CORS check):
   ```
   curl -H "Origin: http://localhost:5173" \
        -H "Access-Control-Request-Method: GET" \
        -X OPTIONS \
        http://localhost:3000/health -v 2>&1 | grep "Access-Control"
   ```
   Expected: Access-Control-Allow-Origin header present

Report: ✅ or ❌

---

## FINAL REPORT

After running ALL steps, produce a final report in this exact format:

```
╔══════════════════════════════════════════════════╗
║         AGENTLENS — FULL SYSTEM TEST REPORT      ║
╠══════════════════════════════════════════════════╣
║  STEP 1 — Infrastructure     [ ✅ PASS / ❌ FAIL ] ║
║  STEP 2 — Build & Tests      [ ✅ PASS / ❌ FAIL ] ║
║  STEP 3 — Database Schema    [ ✅ PASS / ❌ FAIL ] ║
║  STEP 4 — API Health         [ ✅ PASS / ❌ FAIL ] ║
║  STEP 5 — Span Ingestion     [ ✅ PASS / ❌ FAIL ] ║
║  STEP 6 — Dashboard API      [ ✅ PASS / ❌ FAIL ] ║
║  STEP 7 — Alert Engine       [ ✅ PASS / ❌ FAIL ] ║
║  STEP 8 — SDK Integration    [ ✅ PASS / ❌ FAIL ] ║
║  STEP 9 — Frontend           [ ✅ PASS / ❌ FAIL ] ║
╠══════════════════════════════════════════════════╣
║  OVERALL STATUS              [ ✅ READY / ❌ FIX  ] ║
╚══════════════════════════════════════════════════╝

FAILURES TO FIX:
1. [Step X] — description of issue + exact fix needed
2. [Step X] — description of issue + exact fix needed

READY TO LAUNCH: YES / NO
```

For every ❌ — provide the exact fix: code change, config update, or command to run.
Do NOT just describe the problem. Give the solution.
