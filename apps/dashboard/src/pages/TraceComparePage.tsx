import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTraceDetail } from '../lib/api';
import type { TraceDetail, SpanNode } from '../lib/types';

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full font-mono';

function StatCard({
  label,
  left,
  right,
  format,
}: {
  label: string;
  left: string | number | null;
  right: string | number | null;
  format?: (v: string | number | null) => string;
}): React.JSX.Element {
  const fmt = format ?? ((v: string | number | null): string => (v != null ? String(v) : '—'));
  const l = fmt(left);
  const r = fmt(right);
  const different = l !== r;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-2">{label}</p>
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-gray-200 flex-1">{l}</span>
        <span className="text-gray-600">vs</span>
        <span
          className={`text-sm font-mono flex-1 text-right ${
            different ? 'text-yellow-400' : 'text-gray-200'
          }`}
        >
          {r}
        </span>
      </div>
    </div>
  );
}

function SpanCompareTable({
  leftSpans,
  rightSpans,
}: {
  leftSpans: SpanNode[];
  rightSpans: SpanNode[];
}): React.JSX.Element {
  const leftFlat = flattenSpans(leftSpans);
  const rightFlat = flattenSpans(rightSpans);

  // Match by span name
  const allNames = [
    ...new Set([...leftFlat.map((s) => s.name), ...rightFlat.map((s) => s.name)]),
  ];
  const leftMap = new Map(leftFlat.map((s) => [s.name, s]));
  const rightMap = new Map(rightFlat.map((s) => [s.name, s]));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-700 bg-gray-900/80 text-xs text-gray-500 uppercase tracking-wider">
        <span className="w-40 shrink-0">Span</span>
        <span className="flex-1 text-center">Trace A</span>
        <span className="flex-1 text-center">Trace B</span>
      </div>
      {allNames.map((name) => {
        const l = leftMap.get(name);
        const r = rightMap.get(name);
        const latencyDiff =
          l?.latencyMs != null && r?.latencyMs != null
            ? r.latencyMs - l.latencyMs
            : null;
        return (
          <div
            key={name}
            className="flex items-center gap-4 px-5 py-2 border-b border-gray-800 hover:bg-gray-800/40 text-sm"
          >
            <span className="w-40 shrink-0 font-mono text-xs text-brand-400 truncate">
              {name}
            </span>
            {/* Trace A */}
            <div className="flex-1 flex items-center gap-3 justify-center">
              {l ? (
                <>
                  <StatusBadge status={l.status} />
                  <span className="font-mono text-xs text-gray-400">
                    {l.latencyMs != null ? `${(l.latencyMs / 1000).toFixed(2)}s` : '—'}
                  </span>
                  <span className="font-mono text-xs text-gray-400">
                    {l.costUsd != null ? `$${parseFloat(l.costUsd).toFixed(4)}` : '—'}
                  </span>
                  <span className="text-xs text-gray-500">
                    {((l.inputTokens ?? 0) + (l.outputTokens ?? 0)).toLocaleString()} tok
                  </span>
                </>
              ) : (
                <span className="text-xs text-gray-600">missing</span>
              )}
            </div>
            {/* Trace B */}
            <div className="flex-1 flex items-center gap-3 justify-center">
              {r ? (
                <>
                  <StatusBadge status={r.status} />
                  <span className="font-mono text-xs text-gray-400">
                    {r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(2)}s` : '—'}
                  </span>
                  <span className="font-mono text-xs text-gray-400">
                    {r.costUsd != null ? `$${parseFloat(r.costUsd).toFixed(4)}` : '—'}
                  </span>
                  <span className="text-xs text-gray-500">
                    {((r.inputTokens ?? 0) + (r.outputTokens ?? 0)).toLocaleString()} tok
                  </span>
                  {latencyDiff != null && latencyDiff !== 0 && (
                    <span
                      className={`text-xs font-mono ${
                        latencyDiff > 0 ? 'text-red-400' : 'text-green-400'
                      }`}
                    >
                      {latencyDiff > 0 ? '+' : ''}
                      {(latencyDiff / 1000).toFixed(2)}s
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-gray-600">missing</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const isError = status === 'error';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
        isError ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
      }`}
    >
      {status}
    </span>
  );
}

function flattenSpans(spans: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];
  function walk(nodes: SpanNode[]): void {
    for (const node of nodes) {
      result.push(node);
      if (node.children?.length) walk(node.children);
    }
  }
  walk(spans);
  return result;
}

function totalCost(trace: TraceDetail): number {
  return parseFloat(trace.totalCostUsd) || 0;
}

function totalTokens(trace: TraceDetail): number {
  const flat = flattenSpans(trace.spans);
  return flat.reduce(
    (sum, s) => sum + (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
    0,
  );
}

export function TraceComparePage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [traceAId, setTraceAId] = useState(searchParams.get('a') ?? '');
  const [traceBId, setTraceBId] = useState(searchParams.get('b') ?? '');
  const [submitted, setSubmitted] = useState(
    !!(searchParams.get('a') && searchParams.get('b')),
  );

  const traceA = useQuery({
    queryKey: ['trace', traceAId],
    queryFn: () => fetchTraceDetail(traceAId),
    enabled: submitted && !!traceAId,
  });

  const traceB = useQuery({
    queryKey: ['trace', traceBId],
    queryFn: () => fetchTraceDetail(traceBId),
    enabled: submitted && !!traceBId,
  });

  function handleCompare(e: React.FormEvent): void {
    e.preventDefault();
    if (!traceAId || !traceBId) return;
    setSearchParams({ a: traceAId, b: traceBId });
    setSubmitted(true);
  }

  const loading = traceA.isLoading || traceB.isLoading;
  const hasData = traceA.data && traceB.data;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-100">Compare Traces</h1>

      {/* Input form */}
      <form onSubmit={handleCompare} className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">Trace A (ID)</label>
          <input
            className={inputClass}
            value={traceAId}
            onChange={(e) => setTraceAId(e.target.value)}
            placeholder="paste trace ID..."
            required
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">Trace B (ID)</label>
          <input
            className={inputClass}
            value={traceBId}
            onChange={(e) => setTraceBId(e.target.value)}
            placeholder="paste trace ID..."
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-brand-600 hover:bg-brand-700 text-white px-5 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          {loading ? 'Loading...' : 'Compare'}
        </button>
      </form>

      {(traceA.isError || traceB.isError) && (
        <p className="text-red-400 text-sm">
          Failed to load one or both traces. Please check the IDs.
        </p>
      )}

      {/* Summary comparison */}
      {hasData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Status"
              left={traceA.data.status}
              right={traceB.data.status}
            />
            <StatCard
              label="Total Latency"
              left={traceA.data.totalLatencyMs}
              right={traceB.data.totalLatencyMs}
              format={(v) =>
                v != null ? `${(Number(v) / 1000).toFixed(2)}s` : '—'
              }
            />
            <StatCard
              label="Total Cost"
              left={totalCost(traceA.data)}
              right={totalCost(traceB.data)}
              format={(v) => (v != null ? `$${Number(v).toFixed(4)}` : '—')}
            />
            <StatCard
              label="Total Tokens"
              left={totalTokens(traceA.data)}
              right={totalTokens(traceB.data)}
              format={(v) =>
                v != null ? Number(v).toLocaleString() : '—'
              }
            />
          </div>

          {/* Span-by-span comparison */}
          <h2 className="text-sm font-semibold text-gray-300 mt-4">
            Span-by-Span Comparison
          </h2>
          <SpanCompareTable
            leftSpans={traceA.data.spans}
            rightSpans={traceB.data.spans}
          />
        </>
      )}
    </div>
  );
}
