import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchTraces, fetchTraceStats } from '../lib/api';
import type { TraceSummary, TraceStats } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SkeletonRow, SkeletonCard } from '../components/Skeleton';

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

function StatCard({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-100">{value}</p>
    </div>
  );
}

export function TracesPage(): React.JSX.Element {
  const navigate = useNavigate();

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [agentName, setAgentName] = useState('');
  const [debouncedAgent, setDebouncedAgent] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedAgent(agentName), 300);
    return (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [agentName]);

  // Stats
  const statsQuery = useQuery<TraceStats>({
    queryKey: ['trace-stats'],
    queryFn: fetchTraceStats,
    staleTime: 30_000,
  });

  // Paginated traces
  const tracesQuery = useInfiniteQuery({
    queryKey: ['traces', statusFilter, debouncedAgent, dateFrom, dateTo],
    queryFn: ({ pageParam }) =>
      fetchTraces({
        cursor: pageParam,
        status: statusFilter || undefined,
        agentName: debouncedAgent || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });

  const allItems: TraceSummary[] = tracesQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const hasMore = tracesQuery.data?.pages[tracesQuery.data.pages.length - 1]?.hasMore ?? false;

  const handleLoadMore = useCallback(() => {
    if (!tracesQuery.isFetchingNextPage) {
      void tracesQuery.fetchNextPage();
    }
  }, [tracesQuery]);

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : statsQuery.data ? (
          <>
            <StatCard label="Total Traces" value={statsQuery.data.totalTraces.toLocaleString()} />
            <StatCard label="Error Rate" value={`${(statsQuery.data.errorRate * 100).toFixed(1)}%`} />
            <StatCard label="Avg Cost" value={`$${parseFloat(statsQuery.data.avgCostUsd).toFixed(4)}`} />
            <StatCard label="Avg Latency" value={`${statsQuery.data.avgLatencyMs}ms`} />
          </>
        ) : null}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={inputClass}
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
          className={`${inputClass} w-48`}
          type="text"
          placeholder="Agent name…"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
        />

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

        {(statusFilter || debouncedAgent || dateFrom || dateTo) && (
          <button
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md text-sm"
            onClick={() => {
              setStatusFilter('');
              setAgentName('');
              setDebouncedAgent('');
              setDateFrom('');
              setDateTo('');
            }}
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
              {['Trace ID', 'Agent', 'Status', 'Spans', 'Cost', 'Latency', 'Started At'].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-900">
            {tracesQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
            ) : tracesQuery.isError ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-red-400">
                  Failed to load traces. Please try again.
                </td>
              </tr>
            ) : allItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-500">
                    <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm">No traces found</p>
                  </div>
                </td>
              </tr>
            ) : (
              allItems.map((trace) => (
                <tr
                  key={trace.id}
                  className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                  onClick={() => void navigate(`/traces/${trace.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-brand-500 whitespace-nowrap">
                    {trace.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-gray-300 max-w-[160px] truncate">
                    {trace.agentName ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={trace.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-300">{trace.totalSpans}</td>
                  <td className="px-4 py-3 font-mono text-gray-300">
                    ${parseFloat(trace.totalCostUsd).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-300">
                    {trace.totalLatencyMs !== null ? `${trace.totalLatencyMs}ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {new Date(trace.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))
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
