import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTraceDetail } from '../lib/api';
import type { SpanNode } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SpanTimeline } from '../components/SpanTimeline';
import { SpanDetailPanel } from '../components/SpanDetailPanel';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import { useTraceSocket } from '../hooks/useTraceSocket';

function mergeSpanIntoTree(spans: SpanNode[], newSpan: SpanNode): SpanNode[] {
  // Try to find parent and append as child
  function insertInto(nodes: SpanNode[]): { nodes: SpanNode[]; inserted: boolean } {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
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
    // No parent found, add at root level
    return [...spans, newSpan];
  }
  return nodes;
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
  const [selectedSpan, setSelectedSpan] = useState<SpanNode | null>(null);

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

  // Merge live spans into the tree
  const mergedSpans = useMemo(() => {
    if (!traceQuery.data) return [];
    let spans = [...traceQuery.data.spans];
    for (const live of liveSpans) {
      spans = mergeSpanIntoTree(spans, live);
    }
    return spans;
  }, [traceQuery.data, liveSpans]);

  // Find selected span by ID in merged tree
  const findSpanById = (spans: SpanNode[], id: string): SpanNode | null => {
    for (const span of spans) {
      if (span.spanId === id) return span;
      const found = findSpanById(span.children, id);
      if (found) return found;
    }
    return null;
  };

  function handleSpanClick(span: SpanNode): void {
    setSelectedSpanId(span.spanId);
    setSelectedSpan(span);
  }

  function handlePanelClose(): void {
    setSelectedSpanId(null);
    setSelectedSpan(null);
  }

  // Keep selected span in sync with merged spans
  const currentSelectedSpan = selectedSpanId
    ? (findSpanById(mergedSpans, selectedSpanId) ?? selectedSpan)
    : null;

  if (traceQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-4 bg-gray-800 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
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

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Status">
          <StatusBadge status={trace.status} />
        </SummaryCard>
        <SummaryCard label="Total Spans">{trace.totalSpans + liveSpans.length}</SummaryCard>
        <SummaryCard label="Total Cost">
          ${parseFloat(trace.totalCostUsd).toFixed(6)}
        </SummaryCard>
        <SummaryCard label="Total Latency">
          {trace.totalLatencyMs !== null ? `${trace.totalLatencyMs}ms` : '—'}
        </SummaryCard>
      </div>

      {/* Agent / started info */}
      <div className="flex gap-6 text-sm text-gray-400">
        {trace.agentName && (
          <span>Agent: <span className="text-gray-200">{trace.agentName}</span></span>
        )}
        <span>Started: <span className="text-gray-200">{new Date(trace.startedAt).toLocaleString()}</span></span>
      </div>

      {/* Span timeline */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Span Timeline</h2>
        <SpanTimeline
          spans={mergedSpans}
          onSpanClick={handleSpanClick}
          selectedSpanId={selectedSpanId}
        />
      </div>

      {/* Span detail slide-in panel */}
      <SpanDetailPanel span={currentSelectedSpan} onClose={handlePanelClose} />
    </div>
  );
}
