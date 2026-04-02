import React, { useState, useCallback } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTraces, fetchTraceStats } from '../lib/api';
import type { TraceSummary, TraceStats } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SkeletonRow } from '../components/Skeleton';
import { SearchBar } from '../components/SearchBar';
import { timeAgo } from '../lib/timeago';

const selectClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

type LatencyRange = '' | '<1s' | '1-3s' | '3-5s' | '>5s';
type CostRange = '' | '<0.01' | '0.01-0.10' | '>0.10';

function latencyToParams(range: LatencyRange): { minLatencyMs?: number; maxLatencyMs?: number } {
  switch (range) {
    case '<1s': return { maxLatencyMs: 1000 };
    case '1-3s': return { minLatencyMs: 1000, maxLatencyMs: 3000 };
    case '3-5s': return { minLatencyMs: 3000, maxLatencyMs: 5000 };
    case '>5s': return { minLatencyMs: 5000 };
    default: return {};
  }
}

function costToParams(range: CostRange): { minCostUsd?: number; maxCostUsd?: number } {
  switch (range) {
    case '<0.01': return { maxCostUsd: 0.01 };
    case '0.01-0.10': return { minCostUsd: 0.01, maxCostUsd: 0.10 };
    case '>0.10': return { minCostUsd: 0.10 };
    default: return {};
  }
}

export function TracesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Filters — read initial status from URL (e.g., from "View all errors" link)
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [search, setSearch] = useState('');
  const [agentName, setAgentName] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [latencyRange, setLatencyRange] = useState<LatencyRange>('');
  const [costRange, setCostRange] = useState<CostRange>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hasActiveFilter =
    Boolean(statusFilter) ||
    Boolean(search) ||
    Boolean(agentName) ||
    Boolean(modelFilter) ||
    Boolean(latencyRange) ||
    Boolean(costRange) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  function clearFilters(): void {
    setStatusFilter('');
    setSearch('');
    setAgentName('');
    setModelFilter('');
    setLatencyRange('');
    setCostRange('');
    setDateFrom('');
    setDateTo('');
  }

  // Stats
  const statsQuery = useQuery<TraceStats>({
    queryKey: ['trace-stats'],
    queryFn: fetchTraceStats,
    staleTime: 30_000,
  });

  const latencyParams = latencyToParams(latencyRange);
  const costParams = costToParams(costRange);

  // Paginated traces
  const tracesQuery = useInfiniteQuery({
    queryKey: [
      'traces',
      statusFilter,
      search,
      agentName,
      modelFilter,
      latencyRange,
      costRange,
      dateFrom,
      dateTo,
    ],
    queryFn: ({ pageParam }) =>
      fetchTraces({
        cursor: pageParam,
        status: statusFilter || undefined,
        agentName: (agentName || search) || undefined,
        model: modelFilter || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        limit: 20,
        ...latencyParams,
        ...costParams,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });

  const allItems: TraceSummary[] = tracesQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const hasMore =
    tracesQuery.data?.pages[tracesQuery.data.pages.length - 1]?.hasMore ?? false;

  const handleLoadMore = useCallback(() => {
    if (!tracesQuery.isFetchingNextPage) {
      void tracesQuery.fetchNextPage();
    }
  }, [tracesQuery]);

  const stats = statsQuery.data;

  return (
    <div className="space-y-4">
      {/* Compact stats bar */}
      <div className="flex flex-wrap items-center gap-6 px-1 text-sm">
        {statsQuery.isLoading ? (
          <span className="text-gray-500 text-xs">Loading stats…</span>
        ) : stats ? (
          <>
            <span className="text-gray-400">
              <span className="text-gray-100 font-medium">{stats.totalTraces.toLocaleString()}</span>
              {' '}total traces
            </span>
            <span className="text-gray-400">
              Error rate:{' '}
              <span className={stats.errorRate > 0.05 ? 'text-red-400 font-medium' : 'text-gray-100 font-medium'}>
                {(stats.errorRate * 100).toFixed(1)}%
              </span>
            </span>
            <span className="text-gray-400">
              Avg cost:{' '}
              <span className="text-gray-100 font-medium">
                ${parseFloat(stats.avgCostUsd).toFixed(4)}
              </span>
            </span>
            <span className="text-gray-400">
              Avg latency:{' '}
              <span className="text-gray-100 font-medium">{stats.avgLatencyMs}ms</span>
            </span>
            {stats.p95LatencyMs > 0 && (
              <span className="text-gray-400">
                p95:{' '}
                <span className="text-gray-100 font-medium">{stats.p95LatencyMs}ms</span>
              </span>
            )}
          </>
        ) : null}
      </div>

      {/* Search bar */}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search agent name, prompts, responses across all traces…"
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>

        <input
          className={`${inputClass} w-40`}
          type="text"
          placeholder="Agent name…"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
        />

        <input
          className={`${inputClass} w-44`}
          type="text"
          placeholder="Model (e.g. gpt-4o)…"
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
        />

        <select
          className={selectClass}
          value={latencyRange}
          onChange={(e) => setLatencyRange(e.target.value as LatencyRange)}
        >
          <option value="">All Latencies</option>
          <option value="<1s">&lt;1s</option>
          <option value="1-3s">1–3s</option>
          <option value="3-5s">3–5s</option>
          <option value=">5s">&gt;5s</option>
        </select>

        <select
          className={selectClass}
          value={costRange}
          onChange={(e) => setCostRange(e.target.value as CostRange)}
        >
          <option value="">All Costs</option>
          <option value="<0.01">&lt;$0.01</option>
          <option value="0.01-0.10">$0.01–$0.10</option>
          <option value=">0.10">&gt;$0.10</option>
        </select>

        <input
          className={inputClass}
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="From date"
        />
        <span className="text-gray-600 text-sm">to</span>
        <input
          className={inputClass}
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="To date"
        />

        {hasActiveFilter && (
          <button
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md text-sm transition-colors"
            onClick={clearFilters}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-gray-400 uppercase text-xs tracking-wider">
            <tr>
              {[
                'Trace ID',
                'Agent',
                'Input Preview',
                'Status',
                'Spans',
                'Tokens',
                'Cost',
                'Latency',
                'Time',
              ].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-900">
            {tracesQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={9} />)
            ) : tracesQuery.isError ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-red-400">
                  Failed to load traces. Please try again.
                </td>
              </tr>
            ) : allItems.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-500">
                    <svg
                      className="w-10 h-10 opacity-40"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-sm">No traces found</p>
                  </div>
                </td>
              </tr>
            ) : (
              allItems.map((trace) => {
                const isError = trace.status === 'error';
                return (
                  <tr
                    key={trace.id}
                    className={`hover:bg-gray-800/50 cursor-pointer transition-colors ${isError ? 'bg-red-950/20' : ''}`}
                    onClick={() => void navigate(`/traces/${trace.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-brand-500 whitespace-nowrap">
                      {trace.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-gray-300 max-w-[160px] truncate">
                      {trace.agentName ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate">
                      {trace.inputPreview ? (
                        <span
                          className={isError ? 'text-red-400' : 'text-gray-400'}
                          title={trace.inputPreview}
                        >
                          {trace.inputPreview}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={trace.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-300">{trace.totalSpans}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">
                      {trace.totalTokens != null ? trace.totalTokens.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">
                      ${parseFloat(trace.totalCostUsd).toFixed(4)}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">
                      {trace.totalLatencyMs !== null ? `${trace.totalLatencyMs}ms` : '—'}
                    </td>
                    <td
                      className="px-4 py-3 text-gray-400 whitespace-nowrap"
                      title={new Date(trace.startedAt).toLocaleString()}
                    >
                      {timeAgo(trace.startedAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <button
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-6 py-2 rounded-md text-sm transition-colors disabled:opacity-50"
            onClick={handleLoadMore}
            disabled={tracesQuery.isFetchingNextPage}
          >
            {tracesQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
