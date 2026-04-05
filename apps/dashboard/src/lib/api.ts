import axios from 'axios';
import type {
  Paginated,
  TraceSummary,
  TraceStats,
  TraceDetail,
  SpanNode,
  CostSummary,
  CostTimeseries,
  CostByModel,
  CostByAgent,
  AlertResponse,
  CreateAlertPayload,
  OverviewData,
} from './types';

const BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
const ENV_PROJECT_ID = (import.meta.env['VITE_PROJECT_ID'] as string | undefined) ?? '';

function getProjectId(): string {
  return localStorage.getItem('agentlens_project_id') ?? ENV_PROJECT_ID;
}

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('agentlens_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const pid = getProjectId();
  if (pid) config.headers['x-project-id'] = pid;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      localStorage.removeItem('agentlens_token');
      localStorage.removeItem('agentlens_project_id');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0] ?? '';
}

function isoToday(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

// ── Internal API shapes ───────────────────────────────────────────────────────

interface ApiPaginatedDto<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}

interface ApiTraceSummary {
  id: string;
  projectId: string;
  status: string;
  agentName?: string;
  totalSpans: number;
  totalTokens: number;
  totalCostUsd: number;
  totalLatencyMs?: number;
  startedAt: string;
  endedAt?: string;
  inputPreview?: string;
}

interface ApiTraceStats {
  totalTraces: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  dateFrom: string;
  dateTo: string;
}

interface ApiSpanNode {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  model?: string;
  provider?: string;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  startedAt: string;
  endedAt?: string;
  errorMessage?: string;
  metadata: Record<string, unknown>;
  input?: string;
  output?: string;
  children: ApiSpanNode[];
}

interface ApiTraceDetail extends ApiTraceSummary {
  metadata: Record<string, unknown>;
  spans: ApiSpanNode[];
}

interface ApiCostSummaryDto {
  totalCostUsd: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  prevPeriodCostUsd?: number;
  byModel: Array<{
    model: string;
    provider: string;
    costUsd: number;
    spanCount: number;
    avgTokensPerCall?: number;
    avgCostPerCall?: number;
    avgLatencyMs?: number;
    callCount?: number;
  }>;
  byDate: Array<{ date: string; costUsd: number }>;
  byAgent: Array<{ agentName: string; costUsd: number }>;
  dateFrom: string;
  dateTo: string;
}

interface ApiCostTimeseriesDto {
  dates: Array<{ date: string; costUsd: number }>;
}

export interface ProjectResponse {
  id: string;
  name: string;
  organizationId: string;
  retentionDays: number;
  createdAt: string;
}

export interface ProjectWithKey extends ProjectResponse {
  apiKey: string;
}

// ── Span node mapper ─────────────────────────────────────────────────────────

function mapSpanNode(node: ApiSpanNode): SpanNode {
  return {
    spanId: node.id,
    parentSpanId: node.parentSpanId ?? null,
    name: node.name,
    model: node.model ?? null,
    provider: node.provider ?? null,
    inputTokens: node.inputTokens ?? null,
    outputTokens: node.outputTokens ?? null,
    costUsd: node.costUsd != null ? String(node.costUsd) : null,
    latencyMs: node.latencyMs ?? null,
    status: node.status as SpanNode['status'],
    startedAt: node.startedAt,
    endedAt: node.endedAt ?? null,
    errorMessage: node.errorMessage ?? null,
    metadata: node.metadata,
    input: node.input ?? null,
    output: node.output ?? null,
    children: node.children.map(mapSpanNode),
  };
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectResponse[]> {
  const res = await api.get<ProjectResponse[]>('/projects');
  return res.data;
}

export async function createProject(name: string): Promise<ProjectWithKey> {
  const res = await api.post<ProjectWithKey>('/projects', { name });
  return res.data;
}

export async function deleteProject(projectId: string): Promise<void> {
  await api.delete(`/projects/${projectId}`);
}

export async function rotateProjectKey(projectId: string): Promise<ProjectWithKey> {
  const res = await api.post<ProjectWithKey>(`/projects/${projectId}/rotate-key`);
  return res.data;
}

// ── Overview ──────────────────────────────────────────────────────────────────

export async function fetchOverview(hours = 24): Promise<OverviewData> {
  const res = await api.get<OverviewData>(`/projects/${getProjectId()}/overview`, {
    params: { hours },
  });
  return res.data;
}

// ── Traces ────────────────────────────────────────────────────────────────────

export interface TraceListParams {
  cursor?: string;
  status?: string;
  agentName?: string;
  from?: string;
  to?: string;
  limit?: number;
  model?: string;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  minCostUsd?: number;
  maxCostUsd?: number;
}

export async function fetchTraces(params: TraceListParams): Promise<Paginated<TraceSummary>> {
  const limit = params.limit ?? 20;
  const res = await api.get<ApiPaginatedDto<ApiTraceSummary>>(
    `/projects/${getProjectId()}/traces`,
    {
      params: {
        cursor: params.cursor,
        status: params.status,
        agentName: params.agentName,
        dateFrom: params.from,
        dateTo: params.to,
        limit,
        model: params.model,
        minLatencyMs: params.minLatencyMs,
        maxLatencyMs: params.maxLatencyMs,
        minCostUsd: params.minCostUsd,
        maxCostUsd: params.maxCostUsd,
      },
    },
  );
  const { data, nextCursor } = res.data;
  return {
    items: data.map((t) => ({
      id: t.id,
      agentName: t.agentName ?? null,
      status: t.status as TraceSummary['status'],
      totalSpans: t.totalSpans,
      totalCostUsd: t.totalCostUsd != null ? String(t.totalCostUsd) : '0',
      totalLatencyMs: t.totalLatencyMs ?? null,
      startedAt: t.startedAt,
      inputPreview: t.inputPreview,
      totalTokens: t.totalTokens,
    })),
    nextCursor,
    hasMore: data.length >= limit,
  };
}

export async function fetchTraceStats(): Promise<TraceStats> {
  const res = await api.get<ApiTraceStats>(
    `/projects/${getProjectId()}/traces/stats`,
    {
      params: {
        dateFrom: isoDateDaysAgo(30),
        dateTo: isoToday(),
      },
    },
  );
  const s = res.data;
  const avgCostUsd = s.totalTraces > 0
    ? (s.totalCostUsd / s.totalTraces).toFixed(6)
    : '0.000000';
  return {
    totalTraces: s.totalTraces,
    errorRate: 1 - s.successRate,
    avgCostUsd,
    avgLatencyMs: Math.round(s.avgLatencyMs),
    p95LatencyMs: 0,
  };
}

export async function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  const res = await api.get<ApiTraceDetail>(`/projects/${getProjectId()}/traces/${traceId}`);
  const t = res.data;
  return {
    id: t.id,
    agentName: t.agentName ?? null,
    status: t.status as TraceSummary['status'],
    totalSpans: t.totalSpans,
    totalCostUsd: t.totalCostUsd != null ? String(t.totalCostUsd) : '0',
    totalLatencyMs: t.totalLatencyMs ?? null,
    startedAt: t.startedAt,
    spans: t.spans.map(mapSpanNode),
  };
}

// ── Cost ──────────────────────────────────────────────────────────────────────

export interface CostRangeParams {
  from: string;
  to: string;
}

export async function fetchCostSummary(params: CostRangeParams): Promise<CostSummary> {
  const res = await api.get<ApiCostSummaryDto>(`/projects/${getProjectId()}/cost/summary`, {
    params: { dateFrom: params.from, dateTo: params.to },
  });
  const d = res.data;
  const topModel = [...d.byModel].sort((a, b) => b.costUsd - a.costUsd)[0];
  const topAgent = [...d.byAgent].sort((a, b) => b.costUsd - a.costUsd)[0];
  return {
    totalCostUsd: String(d.totalCostUsd),
    avgCostPerTrace: '0',
    mostExpensiveModel: topModel?.model ?? null,
    mostExpensiveAgent: topAgent?.agentName ?? null,
    totalInputTokens: d.totalInputTokens ?? 0,
    totalOutputTokens: d.totalOutputTokens ?? 0,
    prevPeriodCostUsd: d.prevPeriodCostUsd ?? 0,
  };
}

export async function fetchCostTimeseries(params: CostRangeParams): Promise<CostTimeseries[]> {
  const res = await api.get<ApiCostTimeseriesDto>(`/projects/${getProjectId()}/cost/timeseries`, {
    params: { dateFrom: params.from, dateTo: params.to },
  });
  return res.data.dates.map((d) => ({ date: d.date, costUsd: String(d.costUsd) }));
}

export async function fetchCostByModel(params: CostRangeParams): Promise<CostByModel[]> {
  const res = await api.get<ApiCostSummaryDto>(`/projects/${getProjectId()}/cost/summary`, {
    params: { dateFrom: params.from, dateTo: params.to },
  });
  return res.data.byModel.map((m) => ({
    model: m.model,
    costUsd: String(m.costUsd),
    spanCount: m.spanCount,
    avgTokensPerCall: m.avgTokensPerCall ?? 0,
    avgCostPerCall: m.avgCostPerCall ?? 0,
    avgLatencyMs: m.avgLatencyMs ?? 0,
    callCount: m.callCount ?? m.spanCount,
  }));
}

export async function fetchCostByAgent(params: CostRangeParams): Promise<CostByAgent[]> {
  const res = await api.get<ApiCostSummaryDto>(`/projects/${getProjectId()}/cost/summary`, {
    params: { dateFrom: params.from, dateTo: params.to },
  });
  return res.data.byAgent.map((a) => ({
    agentName: a.agentName,
    costUsd: String(a.costUsd),
    traceCount: 0,
  }));
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function fetchAlerts(): Promise<AlertResponse[]> {
  const res = await api.get<AlertResponse[]>(`/projects/${getProjectId()}/alerts`);
  return res.data;
}

export async function createAlert(payload: CreateAlertPayload): Promise<AlertResponse> {
  const res = await api.post<AlertResponse>(`/projects/${getProjectId()}/alerts`, payload);
  return res.data;
}

export async function updateAlert(id: string, payload: Partial<CreateAlertPayload & { isActive: boolean }>): Promise<AlertResponse> {
  const res = await api.patch<AlertResponse>(`/projects/${getProjectId()}/alerts/${id}`, payload);
  return res.data;
}

export async function deleteAlert(id: string): Promise<void> {
  await api.delete(`/projects/${getProjectId()}/alerts/${id}`);
}
