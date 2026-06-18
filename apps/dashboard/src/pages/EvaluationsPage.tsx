import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchF1, fetchMisclassifications } from '../lib/api';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import type { F1GroupBy } from '../lib/types';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

function getPresetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: formatDate(from), to: formatDate(to) };
}

/** Format a 0..1 metric as a percentage with one decimal, or `--` when no data. */
function pct(value: number, hasData: boolean): string {
  if (!hasData) return '--';
  return `${(value * 100).toFixed(1)}%`;
}

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

const presets = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const groupByOptions: Array<{ label: string; value: F1GroupBy }> = [
  { label: 'Label', value: 'label' },
  { label: 'Agent', value: 'agent' },
  { label: 'Model', value: 'model' },
  { label: 'Task', value: 'task' },
];

interface SummaryCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}

function SummaryCard({ label, value, sub }: SummaryCardProps): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-semibold text-gray-100 truncate">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export function EvaluationsPage(): React.JSX.Element {
  const defaultRange = getPresetRange(30);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [activePreset, setActivePreset] = useState<number | null>(30);
  const [task, setTask] = useState('');
  const [split, setSplit] = useState('');
  const [agentName, setAgentName] = useState('');
  const [model, setModel] = useState('');
  const [groupBy, setGroupBy] = useState<F1GroupBy>('label');

  function applyPreset(days: number): void {
    const range = getPresetRange(days);
    setFrom(range.from);
    setTo(range.to);
    setActivePreset(days);
  }

  const filters = {
    from,
    to,
    task: task || undefined,
    split: split || undefined,
    agentName: agentName || undefined,
    model: model || undefined,
  };

  const f1Query = useQuery({
    queryKey: ['eval-f1', from, to, task, split, agentName, model, groupBy],
    queryFn: () => fetchF1({ ...filters, groupBy }),
    enabled: !!from && !!to,
  });

  const misclassQuery = useQuery({
    queryKey: ['eval-misclass', from, to, task, split, agentName, model],
    queryFn: () => fetchMisclassifications({ ...filters, limit: 50 }),
    enabled: !!from && !!to,
  });

  const summary = f1Query.data?.summary;
  const hasData = (summary?.evaluated ?? 0) > 0;
  const breakdown = f1Query.data?.breakdown ?? [];
  const misclass = misclassQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-800 rounded-md p-0.5">
          {presets.map((preset) => (
            <button
              key={preset.days}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                activePreset === preset.days
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-400 hover:text-gray-100'
              }`}
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <input
          className={inputClass}
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setActivePreset(null); }}
          aria-label="From date"
        />
        <span className="text-gray-600 text-sm">to</span>
        <input
          className={inputClass}
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); setActivePreset(null); }}
          aria-label="To date"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={inputClass}
          type="text"
          placeholder="Task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          aria-label="Task filter"
        />
        <input
          className={inputClass}
          type="text"
          placeholder="Split"
          value={split}
          onChange={(e) => setSplit(e.target.value)}
          aria-label="Split filter"
        />
        <input
          className={inputClass}
          type="text"
          placeholder="Agent"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          aria-label="Agent filter"
        />
        <input
          className={inputClass}
          type="text"
          placeholder="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Model filter"
        />
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Group by</span>
          <select
            className={inputClass}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as F1GroupBy)}
            aria-label="Group by"
          >
            {groupByOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error state */}
      {f1Query.isError && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-sm text-red-300">
          Failed to load evaluation metrics. Please try again.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {f1Query.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <SummaryCard label="F1" value={pct(summary?.f1 ?? 0, hasData)} />
            <SummaryCard label="Precision" value={pct(summary?.precision ?? 0, hasData)} />
            <SummaryCard label="Recall" value={pct(summary?.recall ?? 0, hasData)} />
            <SummaryCard label="Accuracy" value={pct(summary?.accuracy ?? 0, hasData)} />
            <SummaryCard
              label="Evaluated"
              value={summary?.evaluated ?? 0}
              sub={hasData ? `${summary?.correct ?? 0} correct` : undefined}
            />
          </>
        )}
      </div>

      {/* Breakdown table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Breakdown by {groupBy}
        </h2>
        {f1Query.isLoading ? (
          <div className="h-48 flex items-center justify-center">
            <SkeletonText lines={5} />
          </div>
        ) : breakdown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="py-2 pr-4 font-medium">Key</th>
                  <th className="py-2 px-4 font-medium text-right">F1</th>
                  <th className="py-2 px-4 font-medium text-right">Precision</th>
                  <th className="py-2 px-4 font-medium text-right">Recall</th>
                  <th className="py-2 px-4 font-medium text-right">Accuracy</th>
                  <th className="py-2 px-4 font-medium text-right">Support</th>
                  <th className="py-2 px-4 font-medium text-right">TP</th>
                  <th className="py-2 px-4 font-medium text-right">FP</th>
                  <th className="py-2 pl-4 font-medium text-right">FN</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => {
                  const rowHasData = row.evaluated > 0;
                  return (
                    <tr key={row.key} className="border-b border-gray-800/50 text-gray-300">
                      <td className="py-2 pr-4 font-mono text-gray-100 truncate max-w-[200px]">{row.key}</td>
                      <td className="py-2 px-4 text-right">{pct(row.f1, rowHasData)}</td>
                      <td className="py-2 px-4 text-right">{pct(row.precision, rowHasData)}</td>
                      <td className="py-2 px-4 text-right">{pct(row.recall, rowHasData)}</td>
                      <td className="py-2 px-4 text-right">{pct(row.accuracy, rowHasData)}</td>
                      <td className="py-2 px-4 text-right">{row.support}</td>
                      <td className="py-2 px-4 text-right text-green-400">{row.truePositive}</td>
                      <td className="py-2 px-4 text-right text-yellow-400">{row.falsePositive}</td>
                      <td className="py-2 pl-4 text-right text-red-400">{row.falseNegative}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
            No evaluation data for this period. Attach <code className="mx-1 text-gray-400">metadata.agentlens.eval.expected</code> and <code className="mx-1 text-gray-400">predicted</code> to spans.
          </div>
        )}
      </div>

      {/* Misclassifications table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Misclassifications
          {misclassQuery.data && misclassQuery.data.total > 0 && (
            <span className="ml-2 text-gray-600 normal-case">({misclassQuery.data.total} total)</span>
          )}
        </h2>
        {misclassQuery.isLoading ? (
          <div className="h-48 flex items-center justify-center">
            <SkeletonText lines={5} />
          </div>
        ) : misclass.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 px-4 font-medium">Trace</th>
                  <th className="py-2 px-4 font-medium">Agent</th>
                  <th className="py-2 px-4 font-medium">Model</th>
                  <th className="py-2 px-4 font-medium">Expected</th>
                  <th className="py-2 px-4 font-medium">Predicted</th>
                  <th className="py-2 pl-4 font-medium">Input</th>
                </tr>
              </thead>
              <tbody>
                {misclass.map((row) => (
                  <tr key={row.spanId} className="border-b border-gray-800/50 text-gray-300">
                    <td className="py-2 pr-4 whitespace-nowrap text-gray-400">
                      {new Date(row.startedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-4">
                      <Link
                        to={`/traces/${row.traceId}`}
                        className="text-brand-400 hover:text-brand-300 font-mono"
                      >
                        {row.traceId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2 px-4 truncate max-w-[120px]">{row.agentName ?? '—'}</td>
                    <td className="py-2 px-4 font-mono text-purple-400 truncate max-w-[140px]">{row.model ?? '—'}</td>
                    <td className="py-2 px-4 font-mono text-green-400">{row.expected}</td>
                    <td className="py-2 px-4 font-mono text-red-400">{row.predicted}</td>
                    <td className="py-2 pl-4 text-gray-500 truncate max-w-[240px]">{row.inputPreview ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
            No misclassifications for this period
          </div>
        )}
      </div>
    </div>
  );
}
