import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCostSummary, fetchCostTimeseries, fetchCostByModel, fetchCostByAgent } from '../lib/api';
import { CostLineChart, CostBarChart } from '../components/CostChart';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';

function formatDate(d: Date): string {
  return (d.toISOString().split('T')[0] ?? '');
}

function getPresetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: formatDate(from), to: formatDate(to) };
}

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

function SummaryCard({ label, value }: { label: string; value: string | null | undefined }): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-semibold text-gray-100 truncate">{value ?? '—'}</p>
    </div>
  );
}

const presets = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function CostPage(): React.JSX.Element {
  const defaultRange = getPresetRange(30);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [activePreset, setActivePreset] = useState<number | null>(30);

  function applyPreset(days: number): void {
    const range = getPresetRange(days);
    setFrom(range.from);
    setTo(range.to);
    setActivePreset(days);
  }

  const rangeParams = { from, to };

  const summaryQuery = useQuery({
    queryKey: ['cost-summary', from, to],
    queryFn: () => fetchCostSummary(rangeParams),
    enabled: !!from && !!to,
  });

  const timeseriesQuery = useQuery({
    queryKey: ['cost-timeseries', from, to],
    queryFn: () => fetchCostTimeseries(rangeParams),
    enabled: !!from && !!to,
  });

  const byModelQuery = useQuery({
    queryKey: ['cost-by-model', from, to],
    queryFn: () => fetchCostByModel(rangeParams),
    enabled: !!from && !!to,
  });

  const byAgentQuery = useQuery({
    queryKey: ['cost-by-agent', from, to],
    queryFn: () => fetchCostByAgent(rangeParams),
    enabled: !!from && !!to,
  });

  return (
    <div className="space-y-6">
      {/* Date range controls */}
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : summaryQuery.data ? (
          <>
            <SummaryCard
              label="Total Cost"
              value={`$${parseFloat(summaryQuery.data.totalCostUsd).toFixed(4)}`}
            />
            <SummaryCard
              label="Avg per Trace"
              value={`$${parseFloat(summaryQuery.data.avgCostPerTrace).toFixed(6)}`}
            />
            <SummaryCard
              label="Top Model"
              value={summaryQuery.data.mostExpensiveModel}
            />
            <SummaryCard
              label="Top Agent"
              value={summaryQuery.data.mostExpensiveAgent}
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500">—</p>
            </div>
          ))
        )}
      </div>

      {/* Line chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Daily Cost
        </h2>
        {timeseriesQuery.isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <SkeletonText lines={4} />
          </div>
        ) : timeseriesQuery.data && timeseriesQuery.data.length > 0 ? (
          <CostLineChart data={timeseriesQuery.data} />
        ) : (
          <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
            No data for this period
          </div>
        )}
      </div>

      {/* Bar charts row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* By model */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Cost by Model
          </h2>
          {byModelQuery.isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <SkeletonText lines={4} />
            </div>
          ) : byModelQuery.data && byModelQuery.data.length > 0 ? (
            <CostBarChart
              data={byModelQuery.data as unknown as Array<Record<string, unknown>>}
              labelKey="model"
              valueKey="costUsd"
              title="Cost by Model"
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
              No data for this period
            </div>
          )}
        </div>

        {/* By agent */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Cost by Agent
          </h2>
          {byAgentQuery.isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <SkeletonText lines={4} />
            </div>
          ) : byAgentQuery.data && byAgentQuery.data.length > 0 ? (
            <CostBarChart
              data={byAgentQuery.data as unknown as Array<Record<string, unknown>>}
              labelKey="agentName"
              valueKey="costUsd"
              title="Cost by Agent"
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
              No data for this period
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
