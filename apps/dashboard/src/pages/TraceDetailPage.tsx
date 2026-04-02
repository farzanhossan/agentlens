import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTraceDetail } from '../lib/api';
import type { SpanNode } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SpanTimeline } from '../components/SpanTimeline';
import { SpanInspector } from '../components/SpanInspector';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import { useTraceSocket } from '../hooks/useTraceSocket';

function mergeSpanIntoTree(spans: SpanNode[], newSpan: SpanNode): SpanNode[] {
  function insertInto(nodes: SpanNode[]): { nodes: SpanNode[]; inserted: boolean } {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.spanId === newSpan.parentSpanId) {
        const updated = { ...node, children: [...node.children, newSpan] };
        const newNodes = [...nodes];
        newNodes[i] = updated;
        return { nodes: newNodes, inserted: true };
      }
      const result = insertInto(node.children);
      if (result.inserted) {
        const updated = { ...node, children: result.nodes };
        const newNodes = [...nodes];
        newNodes[i] = updated;
        return { nodes: newNodes, inserted: true };
      }
    }
    return { nodes, inserted: false };
  }

  const { nodes, inserted } = insertInto(spans);
  if (!inserted) {
    return [...spans, newSpan];
  }
  return nodes;
}

function findSpanById(spans: SpanNode[], id: string): SpanNode | null {
  for (const span of spans) {
    if (span.spanId === id) return span;
    const found = findSpanById(span.children, id);
    if (found) return found;
  }
  return null;
}

interface TokenCount {
  input: number;
  output: number;
}

function countTokens(spans: SpanNode[]): TokenCount {
  let input = 0;
  let output = 0;
  for (const span of spans) {
    input += span.inputTokens ?? 0;
    output += span.outputTokens ?? 0;
    const childCounts = countTokens(span.children);
    input += childCounts.input;
    output += childCounts.output;
  }
  return { input, output };
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="text-xl font-semibold text-gray-100">{children}</div>
    </div>
  );
}

export function TraceDetailPage(): React.JSX.Element {
  const { traceId } = useParams<{ traceId: string }>();
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const traceQuery = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetchTraceDetail(traceId!),
    enabled: !!traceId,
    refetchInterval: (query) => {
      return query.state.data?.status === 'running' ? 5_000 : false;
    },
  });

  const isRunning = traceQuery.data?.status === 'running';
  const { liveSpans } = useTraceSocket(traceId ?? '', isRunning);

  const mergedSpans = useMemo(() => {
    if (!traceQuery.data) return [];
    let spans = [...traceQuery.data.spans];
    for (const live of liveSpans) {
      spans = mergeSpanIntoTree(spans, live);
    }
    return spans;
  }, [traceQuery.data, liveSpans]);

  const currentSelectedSpan = useMemo(() => {
    if (!selectedSpanId) return null;
    return findSpanById(mergedSpans, selectedSpanId);
  }, [mergedSpans, selectedSpanId]);

  function handleSpanClick(span: SpanNode): void {
    setSelectedSpanId(span.spanId);
  }

  if (traceQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-4 bg-gray-800 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <SkeletonText lines={8} />
        </div>
      </div>
    );
  }

  if (traceQuery.isError) {
    return (
      <div className="text-center py-16">
        <p className="text-red-400 text-sm">Failed to load trace. Please try again.</p>
        <Link to="/traces" className="text-brand-500 hover:underline text-sm mt-3 inline-block">
          ← Back to Traces
        </Link>
      </div>
    );
  }

  const trace = traceQuery.data;
  if (!trace) return <></>;

  const tokenCounts = countTokens(mergedSpans);
  const totalTokens = tokenCounts.input + tokenCounts.output;

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        <Link to="/traces" className="text-brand-500 hover:underline">
          Traces
        </Link>
        <span className="text-gray-600">/</span>
        <span className="text-gray-300 font-mono">{trace.id.slice(0, 8)}…</span>
        {isRunning && (
          <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-blue-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* 5 Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
        <SummaryCard label="Status">
          <StatusBadge status={trace.status} />
        </SummaryCard>
        <SummaryCard label="Total Spans">
          {trace.totalSpans + liveSpans.length}
        </SummaryCard>
        <SummaryCard label="Total Tokens">
          <span>{totalTokens > 0 ? totalTokens.toLocaleString() : '—'}</span>
          {totalTokens > 0 && (
            <div className="text-xs font-normal text-gray-500 mt-0.5">
              {tokenCounts.input.toLocaleString()} in / {tokenCounts.output.toLocaleString()} out
            </div>
          )}
        </SummaryCard>
        <SummaryCard label="Total Cost">
          ${parseFloat(trace.totalCostUsd).toFixed(6)}
        </SummaryCard>
        <SummaryCard label="Total Latency">
          {trace.totalLatencyMs !== null ? `${trace.totalLatencyMs}ms` : '—'}
        </SummaryCard>
      </div>

      {/* Agent / started info */}
      <div className="flex gap-6 text-sm text-gray-400 shrink-0">
        {trace.agentName && (
          <span>Agent: <span className="text-gray-200">{trace.agentName}</span></span>
        )}
        <span>Started: <span className="text-gray-200">{new Date(trace.startedAt).toLocaleString()}</span></span>
      </div>

      {/* Split panel: SpanTimeline (left) + SpanInspector (right) */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-0 border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 border-r border-gray-800 overflow-auto">
          <div className="p-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Span Timeline</h2>
            <SpanTimeline
              spans={mergedSpans}
              onSpanClick={handleSpanClick}
              selectedSpanId={selectedSpanId}
            />
          </div>
        </div>
        <div className="bg-gray-950 overflow-auto">
          <SpanInspector span={currentSelectedSpan ?? null} />
        </div>
      </div>
    </div>
  );
}
