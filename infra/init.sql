-- AgentLens — production PostgreSQL schema bootstrap
-- Run once on a fresh instance.
-- TypeORM migrations manage subsequent schema changes.
-- Requires PostgreSQL 14+

-- ──────────────────────────────────────────────────────────
-- Extensions
-- ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ──────────────────────────────────────────────────────────
-- Enum types
-- ──────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE org_plan AS ENUM ('self_hosted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trace_status AS ENUM ('running', 'success', 'error', 'timeout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE span_status AS ENUM ('success', 'error', 'timeout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE alert_type AS ENUM ('error_rate', 'cost_spike', 'latency_p95', 'failure');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE alert_channel AS ENUM ('slack', 'email', 'webhook');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE delivery_status AS ENUM ('success', 'failed', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────────────────
-- organizations
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(256)    NOT NULL,
    slug                VARCHAR(128)    NOT NULL,
    plan                org_plan        NOT NULL DEFAULT 'self_hosted',
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_organizations_slug UNIQUE (slug)
);

-- ──────────────────────────────────────────────────────────
-- users
-- ──────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email          VARCHAR(320) NOT NULL,
    password_hash  VARCHAR(72)  NOT NULL,
    role           user_role    NOT NULL DEFAULT 'member',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users (org_id);

-- ──────────────────────────────────────────────────────────
-- projects
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             VARCHAR(256) NOT NULL,
    api_key          VARCHAR(64)  NOT NULL,
    description      TEXT,
    retention_days   INT          NOT NULL DEFAULT 30,
    monthly_budget_usd DECIMAL(10, 2),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_projects_api_key UNIQUE (api_key),
    CONSTRAINT chk_projects_retention CHECK (retention_days BETWEEN 1 AND 3650)
);

-- ──────────────────────────────────────────────────────────
-- traces
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traces (
    id                VARCHAR(128)    PRIMARY KEY,      -- = traceId emitted by SDK (any string, e.g. OTel hex)
    project_id        UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id        VARCHAR(128),
    agent_name        VARCHAR(256),
    status            trace_status    NOT NULL DEFAULT 'running',
    total_spans       INT             NOT NULL DEFAULT 0,
    total_tokens      INT             NOT NULL DEFAULT 0,
    total_cost_usd    DECIMAL(10,6)   NOT NULL DEFAULT 0,
    total_latency_ms  INT,
    started_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    ended_at          TIMESTAMPTZ,
    metadata          JSONB           NOT NULL DEFAULT '{}',

    CONSTRAINT chk_traces_ended CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- ──────────────────────────────────────────────────────────
-- spans
-- NOTE: LLM input/output text is stored in Elasticsearch only, not here.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spans (
    id              VARCHAR(128)    PRIMARY KEY,    -- = spanId emitted by SDK (any string, e.g. OTel hex)
    trace_id        VARCHAR(128)    NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    project_id      UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_span_id  VARCHAR(128)    REFERENCES spans(id) ON DELETE SET NULL,
    name            VARCHAR(512)    NOT NULL,
    model           VARCHAR(128),
    provider        VARCHAR(64),
    input_tokens    INT,
    output_tokens   INT,
    cost_usd        DECIMAL(10,6),
    latency_ms      INT,
    status          span_status     NOT NULL DEFAULT 'success',
    error_message   TEXT,
    started_at      TIMESTAMPTZ     NOT NULL,
    ended_at        TIMESTAMPTZ,
    metadata        JSONB           NOT NULL DEFAULT '{}',

    CONSTRAINT chk_spans_ended CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT chk_spans_tokens CHECK (
        (input_tokens IS NULL OR input_tokens >= 0) AND
        (output_tokens IS NULL OR output_tokens >= 0)
    )
);

-- ──────────────────────────────────────────────────────────
-- alerts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(256)    NOT NULL,
    type            alert_type      NOT NULL,
    threshold       DECIMAL(10,4)   NOT NULL,
    channel         alert_channel   NOT NULL,
    channel_config  JSONB           NOT NULL DEFAULT '{}',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_alerts_threshold CHECK (threshold >= 0)
);

-- ──────────────────────────────────────────────────────────
-- alert_firings (history of fired alerts)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_firings (
    id                UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id          UUID              NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    project_id        UUID              NOT NULL,
    alert_name        VARCHAR(256)      NOT NULL,
    alert_type        alert_type        NOT NULL,
    current_value     DECIMAL(10, 4)    NOT NULL,
    threshold         DECIMAL(10, 4)    NOT NULL,
    channel           alert_channel     NOT NULL,
    delivery_status   delivery_status   NOT NULL DEFAULT 'pending',
    error_message     TEXT,
    fired_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_traces_project_created
    ON traces (project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_spans_trace
    ON spans (trace_id);

CREATE INDEX IF NOT EXISTS idx_spans_project_created
    ON spans (project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_spans_status
    ON spans (project_id, status)
    WHERE status = 'error';

CREATE INDEX IF NOT EXISTS idx_traces_session
    ON traces (session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_apikey
    ON projects (api_key);

-- Supporting indexes not in the spec but needed for FK lookups and common queries
CREATE INDEX IF NOT EXISTS idx_projects_org
    ON projects (organization_id);

CREATE INDEX IF NOT EXISTS idx_alerts_project_active
    ON alerts (project_id, is_active);

CREATE INDEX IF NOT EXISTS idx_alert_firings_project
    ON alert_firings (project_id);

CREATE INDEX IF NOT EXISTS idx_alert_firings_alert
    ON alert_firings (alert_id);

CREATE INDEX IF NOT EXISTS idx_traces_status
    ON traces (project_id, status)
    WHERE status IN ('running', 'error');

CREATE INDEX IF NOT EXISTS idx_spans_metadata
    ON spans USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_traces_metadata
    ON traces USING gin (metadata);
