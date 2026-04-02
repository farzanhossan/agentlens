import React from 'react';
import type { SpanNode } from '../lib/types';
import { StatusDot } from './StatusBadge';

interface FlatSpan {
  span: SpanNode;
  depth: number;
}

function flattenSpans(spans: SpanNode[], depth = 0): FlatSpan[] {
  const result: FlatSpan[] = [];
  for (const span of spans) {
    result.push({ span, depth });
    if (span.children.length > 0) {
      result.push(...flattenSpans(span.children, depth + 1));
    }
  }
  return result;
}

function getSpanEndMs(span: SpanNode): number {
  if (span.endedAt) return new Date(span.endedAt).getTime();
  if (span.latencyMs !== null) return new Date(span.startedAt).getTime() + span.latencyMs;
  return new Date(span.startedAt).getTime();
}

const barColorClasses: Record<string, string> = {
  success: 'bg-brand-600',
  error: 'bg-red-600',
  timeout: 'bg-yellow-600',
};

export interface SpanTimelineProps {
  spans: SpanNode[];
  onSpanClick?: (span: SpanNode) => void;
  selectedSpanId?: string | null;
}

export function SpanTimeline({ spans, onSpanClick, selectedSpanId }: SpanTimelineProps): React.JSX.Element {
  const flat = flattenSpans(spans);

  if (flat.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center">No spans available.</div>
    );
  }

  const allStarts = flat.map((f) => new Date(f.span.startedAt).getTime());
  const allEnds = flat.map((f) => getSpanEndMs(f.span));
  const minTime = Math.min(...allStarts);
  const maxTime = Math.max(...allEnds);
  const totalDuration = maxTime - minTime || 1;

  return (
    <div className="space-y-1 font-mono text-xs select-none">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-gray-800 text-gray-500">
        <div className="w-72 shrink-0">Span</div>
        <div className="flex-1">Timeline</div>
        <div className="w-20 text-right shrink-0">Latency</div>
      </div>

      {flat.map(({ span, depth }) => {
        const startMs = new Date(span.startedAt).getTime();
        const endMs = getSpanEndMs(span);
        const offsetPct = ((startMs - minTime) / totalDuration) * 100;
        const widthPct = Math.max(((endMs - startMs) / totalDuration) * 100, 0.5);

        const barColor = barColorClasses[span.status] ?? 'bg-gray-600';
        const isSelected = selectedSpanId === span.spanId;

        return (
          <div
            key={span.spanId}
            className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer transition-colors ${
              isSelected
                ? 'bg-brand-600/20 ring-1 ring-brand-500'
                : 'hover:bg-gray-800/60'
            }`}
            onClick={() => onSpanClick?.(span)}
          >
            {/* Name column */}
            <div
              className="w-72 shrink-0 flex flex-col overflow-hidden"
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              <div className="flex items-center gap-1.5">
                <StatusDot status={span.status} />
                <span className="truncate text-gray-200">{span.name}</span>
              </div>
              <div className="flex gap-2 ml-4 text-[10px] text-gray-500">
                {span.model && <span>{span.model}</span>}
                {(span.inputTokens !== null || span.outputTokens !== null) && (
                  <span>{(span.inputTokens ?? 0) + (span.outputTokens ?? 0)} tok</span>
                )}
                {span.costUsd && <span>${parseFloat(span.costUsd).toFixed(4)}</span>}
              </div>
            </div>

            {/* Timeline bar */}
            <div className="flex-1 relative h-5">
              <div
                className={`absolute top-1 h-3 rounded ${barColor} opacity-90`}
                style={{ left: `${offsetPct}%`, width: `${widthPct}%`, minWidth: '2px' }}
              />
            </div>

            {/* Latency */}
            <div className="w-20 text-right shrink-0 text-gray-400">
              {span.latencyMs !== null ? `${span.latencyMs}ms` : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
