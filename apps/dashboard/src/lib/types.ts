// Traces
export type TraceStatus = 'running' | 'success' | 'error' | 'timeout';

export interface TraceSummary {
  id: string;
  agentName: string | null;
  status: TraceStatus;
  totalSpans: number;
  totalCostUsd: string;
  totalLatencyMs: number | null;
  startedAt: string;
  inputPreview?: string;
  totalTokens?: number;
}

export interface SpanNode {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  latencyMs: number | null;
  status: 'success' | 'error' | 'timeout';
  startedAt: string;
  endedAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  input: string | null;
  output: string | null;
  children: SpanNode[];
}

export interface TraceDetail extends TraceSummary {
  spans: SpanNode[];
}

export interface TraceStats {
  totalTraces: number;
  errorRate: number;
  avgCostUsd: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Cost
export interface CostSummary {
  totalCostUsd: string;
  avgCostPerTrace: string;
  mostExpensiveModel: string | null;
  mostExpensiveAgent: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  prevPeriodCostUsd: number;
  monthCostUsd?: number;
  monthlyBudgetUsd?: number;
}

export interface CostTimeseries {
  date: string;
  costUsd: string;
}

export interface CostByModel {
  model: string;
  costUsd: string;
  spanCount: number;
  avgTokensPerCall: number;
  avgCostPerCall: number;
  avgLatencyMs: number;
  callCount: number;
}

export interface CostByAgent {
  agentName: string;
  costUsd: string;
  traceCount: number;
}

// Alerts
export type AlertType = 'error_rate' | 'cost_spike' | 'latency_p95' | 'failure';
export type AlertChannel = 'slack' | 'email' | 'webhook';

export interface AlertResponse {
  id: string;
  projectId: string;
  name: string;
  type: AlertType;
  threshold: string;
  channel: AlertChannel;
  channelConfig: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface CreateAlertPayload {
  name: string;
  type: AlertType;
  threshold: number;
  channel: AlertChannel;
  channelConfig: Record<string, unknown>;
}

export interface AlertFiring {
  id: string;
  alertId: string;
  projectId: string;
  alertName: string;
  alertType: AlertType;
  currentValue: string;
  threshold: string;
  channel: AlertChannel;
  deliveryStatus: 'success' | 'failed' | 'pending';
  errorMessage?: string;
  firedAt: string;
}

// Overview
export interface HourlyVolume {
  hour: string;
  total: number;
  errors: number;
}

export interface ModelUsage {
  model: string;
  calls: number;
  costUsd: number;
}

export interface TopAgent {
  agentName: string;
  calls: number;
  errors: number;
  avgLatencyMs: number;
  costUsd: number;
}

export interface RecentError {
  traceId: string;
  errorMessage: string;
  agentName?: string;
  model?: string;
  startedAt: string;
}

export interface OverviewData {
  totalRequests: number;
  totalRequestsPrev: number;
  errorCount: number;
  errorCountPrev: number;
  totalCostUsd: number;
  monthCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  activeTraces: number;
  hourlyVolume: HourlyVolume[];
  modelUsage: ModelUsage[];
  topAgents: TopAgent[];
  recentErrors: RecentError[];
}

// Live Feed entry
export interface LiveFeedEntry {
  spanId: string;
  traceId: string;
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  status: string;
  input?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  startedAt: string;
}
