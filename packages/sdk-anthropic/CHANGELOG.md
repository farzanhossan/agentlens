# @farzanhossans/agentlens-anthropic

## 1.0.0

### Major Changes

- v1.0.0 — Production-ready release
  - Proxy trace grouping via optional headers (X-AgentLens-Trace-Id, X-AgentLens-Parent-Span-Id, X-AgentLens-Span-Name)
  - Elasticsearch-powered aggregations, analytics, and full-text search
  - Error clustering and pattern detection
  - Index lifecycle management (ILM) with rolling indices
  - Per-project data retention policies
  - Cost analytics with monthly budget tracking
  - Smart alerts (error rate, cost, P95 latency, failure count) via Slack, email, webhook
  - Real-time live feed via WebSocket
  - Session replay for multi-turn conversations
  - PII scrubbing (emails, API keys, SSNs, credit cards)
  - Dashboard: project switcher, trace detail with span hierarchy, overview page
  - Production hardening: dynamic ports, health checks, REDIS_URL support

### Patch Changes

- Updated dependencies
  - @farzanhossans/agentlens-core@1.0.0
