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
}

export interface CostTimeseries {
  date: string;
  costUsd: string;
}

export interface CostByModel {
  model: string;
  costUsd: string;
  spanCount: number;
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
