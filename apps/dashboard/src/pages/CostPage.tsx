import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchCostSummary, fetchCostTimeseries, fetchCostByModel, fetchCostByAgent } from '../lib/api';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import { ModelEfficiencyTable } from '../components/ModelEfficiencyTable';
import { downloadCsv } from '../lib/export-csv';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

function getPresetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: formatDate(from), to: formatDate(to) };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

const AGENT_BAR_COLORS = [
  'bg-brand-600',
  'bg-purple-500',
  'bg-purple-400',
  'bg-purple-300',
  'bg-purple-200',
];

const presets = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
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
      <p className="text-xl font-semibold text-gray-100 truncate">{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

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

  // Compute delta vs previous period
  const summary = summaryQuery.data;
  const totalCost = summary ? parseFloat(summary.totalCostUsd) : null;
  const prevCost = summary?.prevPeriodCostUsd ?? 0;
  const delta = totalCost != null && prevCost > 0 ? totalCost - prevCost : null;
  const deltaPercent = delta != null && prevCost > 0 ? (delta / prevCost) * 100 : null;

  // Agent progress bars
  const agentData = byAgentQuery.data ?? [];
  const totalAgentCost = agentData.reduce((sum, a) => sum + parseFloat(a.costUsd), 0);

  // Timeseries chart data
  const chartData = (timeseriesQuery.data ?? []).map((d) => ({
    date: d.date,
    cost: parseFloat(d.costUsd),
  }));

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
        <div className="flex-1" />
        <button
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50"
          disabled={!byModelQuery.data?.length}
          onClick={() => {
            const models = byModelQuery.data ?? [];
            downloadCsv(
              models.map((m) => ({
                model: m.model,
                calls: m.callCount,
                avgTokens: m.avgTokensPerCall,
                avgCost: m.avgCostPerCall,
                avgLatencyMs: m.avgLatencyMs,
                totalCost: m.costUsd,
              })),
              `agentlens-cost-${from}-${to}.csv`,
            );
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : summary ? (
          <>
            {/* Total Cost with delta */}
            <SummaryCard
              label="Total Cost"
              value={`$${totalCost!.toFixed(4)}`}
              sub={
                deltaPercent != null ? (
                  <span className={deltaPercent >= 0 ? 'text-red-400' : 'text-green-400'}>
                    {deltaPercent >= 0 ? '+' : ''}{deltaPercent.toFixed(1)}% vs prev period
                  </span>
                ) : undefined
              }
            />
            {/* Total Tokens with in/out breakdown */}
            <SummaryCard
              label="Total Tokens"
              value={formatTokens(summary.totalInputTokens + summary.totalOutputTokens)}
              sub={`${formatTokens(summary.totalInputTokens)} in / ${formatTokens(summary.totalOutputTokens)} out`}
            />
            {/* Top Model */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Top Model</p>
              <p className="text-xl font-semibold text-purple-400 font-mono truncate">
                {summary.mostExpensiveModel ?? '—'}
              </p>
            </div>
            {/* Top Agent */}
            <SummaryCard
              label="Top Agent"
              value={summary.mostExpensiveAgent ?? '—'}
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

      {/* Monthly budget progress */}
      {summary?.monthlyBudgetUsd != null && summary.monthlyBudgetUsd > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Monthly Budget
            </h2>
            <span className="text-sm text-gray-300">
              ${(summary.monthCostUsd ?? 0).toFixed(2)} / ${summary.monthlyBudgetUsd.toFixed(2)}
            </span>
          </div>
          {(() => {
            const pct = Math.min(((summary.monthCostUsd ?? 0) / summary.monthlyBudgetUsd!) * 100, 100);
            const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-brand-600';
            return (
              <div className="relative">
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-full transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-500">
                  <span>{pct.toFixed(0)}% used</span>
                  <span>${((summary.monthlyBudgetUsd ?? 0) - (summary.monthCostUsd ?? 0)).toFixed(2)} remaining</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Daily Cost Trend bar chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Daily Cost Trend
        </h2>
        {timeseriesQuery.isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <SkeletonText lines={4} />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#6B7280', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tick={{ fill: '#6B7280', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                width={64}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#9CA3AF' }}
                itemStyle={{ color: '#E5E7EB' }}
                formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']}
              />
              <Bar dataKey="cost" fill="#4F46E5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
            No data for this period
          </div>
        )}
      </div>

      {/* Bottom row: Model Efficiency Table + Cost by Agent */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Model Efficiency Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Model Efficiency
          </h2>
          {byModelQuery.isLoading ? (
            <div className="h-48 flex items-center justify-center">
              <SkeletonText lines={5} />
            </div>
          ) : (byModelQuery.data && byModelQuery.data.length > 0) ? (
            <ModelEfficiencyTable data={byModelQuery.data} />
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
              No data for this period
            </div>
          )}
        </div>

        {/* Cost by Agent */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Cost by Agent
          </h2>
          {byAgentQuery.isLoading ? (
            <div className="h-48 flex items-center justify-center">
              <SkeletonText lines={5} />
            </div>
          ) : agentData.length > 0 ? (
            <div className="space-y-3">
              {agentData.map((agent, i) => {
                const cost = parseFloat(agent.costUsd);
                const pct = totalAgentCost > 0 ? (cost / totalAgentCost) * 100 : 0;
                const barColor = AGENT_BAR_COLORS[i % AGENT_BAR_COLORS.length] ?? 'bg-brand-600';
                return (
                  <div key={agent.agentName}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-gray-300 truncate max-w-[60%]">
                        {agent.agentName}
                      </span>
                      <span className="text-sm text-gray-400">
                        ${cost.toFixed(4)} &middot; {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className={`${barColor} h-2 rounded-full transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
              No data for this period
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
