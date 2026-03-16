import axios from 'axios';
import type {
  Paginated,
  TraceSummary,
  TraceStats,
  TraceDetail,
  CostSummary,
  CostTimeseries,
  CostByModel,
  CostByAgent,
  AlertResponse,
  CreateAlertPayload,
} from './types';

const BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
const PROJECT_ID = (import.meta.env['VITE_PROJECT_ID'] as string | undefined) ?? '';

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('agentlens_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (PROJECT_ID) config.headers['x-project-id'] = PROJECT_ID;
  return config;
});

// Traces
export interface TraceListParams {
  cursor?: string;
  status?: string;
  agentName?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function fetchTraces(params: TraceListParams): Promise<Paginated<TraceSummary>> {
  const res = await api.get<Paginated<TraceSummary>>('/dashboard/traces', { params });
  return res.data;
}

export async function fetchTraceStats(): Promise<TraceStats> {
  const res = await api.get<TraceStats>('/dashboard/traces/stats');
  return res.data;
}

export async function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  const res = await api.get<TraceDetail>(`/dashboard/traces/${traceId}`);
  return res.data;
}

// Cost
export interface CostRangeParams {
  from: string;
  to: string;
}

export async function fetchCostSummary(params: CostRangeParams): Promise<CostSummary> {
  const res = await api.get<CostSummary>('/dashboard/cost/summary', { params });
  return res.data;
}

export async function fetchCostTimeseries(params: CostRangeParams): Promise<CostTimeseries[]> {
  const res = await api.get<{ data: CostTimeseries[] }>('/dashboard/cost/timeseries', { params });
  return res.data.data;
}

export async function fetchCostByModel(params: CostRangeParams): Promise<CostByModel[]> {
  const res = await api.get<{ data: CostByModel[] }>('/dashboard/cost/by-model', { params });
  return res.data.data;
}

export async function fetchCostByAgent(params: CostRangeParams): Promise<CostByAgent[]> {
  const res = await api.get<{ data: CostByAgent[] }>('/dashboard/cost/by-agent', { params });
  return res.data.data;
}

// Alerts
export async function fetchAlerts(): Promise<AlertResponse[]> {
  const res = await api.get<AlertResponse[]>('/dashboard/alerts');
  return res.data;
}

export async function createAlert(payload: CreateAlertPayload): Promise<AlertResponse> {
  const res = await api.post<AlertResponse>('/dashboard/alerts', payload);
  return res.data;
}

export async function updateAlert(id: string, payload: Partial<CreateAlertPayload & { isActive: boolean }>): Promise<AlertResponse> {
  const res = await api.patch<AlertResponse>(`/dashboard/alerts/${id}`, payload);
  return res.data;
}

export async function deleteAlert(id: string): Promise<void> {
  await api.delete(`/dashboard/alerts/${id}`);
}
