import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchOverview } from '../lib/api';
import type { OverviewData } from '../lib/types';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import { timeAgo } from '../lib/timeago';

function StatCard({
  label,
  value,
  subtitle,
  delta,
  deltaLabel,
  accent,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  delta?: number;
  deltaLabel?: string;
  accent?: 'red' | 'blue';
}): React.JSX.Element {
  const accentClass = accent === 'red' ? 'text-red-400' : accent === 'blue' ? 'text-blue-400' : '';
  const deltaColor = delta !== undefined && delta > 0 ? 'text-red-400' : 'text-green-400';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accentClass || 'text-gray-100'}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      {delta !== undefined && deltaLabel && (
        <p className={`text-xs mt-1 ${deltaColor}`}>{deltaLabel}</p>
      )}
    </div>
  );
}

export function OverviewPage(): React.JSX.Element {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['overview'],
    queryFn: () => fetchOverview(24),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid md:grid-cols-5 gap-4">
          <div className="md:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5 h-80">
            <SkeletonText lines={6} />
          </div>
          <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5 h-80">
            <SkeletonText lines={5} />
          </div>
        </div>
      </div>
    );
  }

  const requestDelta = data.totalRequestsPrev > 0
    ? ((data.totalRequests - data.totalRequestsPrev) / data.totalRequestsPrev * 100).toFixed(0)
    : null;
  const errorRate = data.totalRequests > 0
    ? (data.errorCount / data.totalRequests * 100).toFixed(1)
    : '0.0';
  const errorDelta = data.errorCountPrev > 0
    ? ((data.errorCount - data.errorCountPrev) / data.errorCountPrev * 100).toFixed(0)
    : null;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="Total Requests"
          value={data.totalRequests.toLocaleString()}
          delta={requestDelta ? parseFloat(requestDelta) : undefined}
          deltaLabel={requestDelta ? `${parseFloat(requestDelta) > 0 ? '+' : ''}${requestDelta}% vs yesterday` : undefined}
        />
        <StatCard
          label="Error Rate"
          value={`${errorRate}%`}
          accent={parseFloat(errorRate) > 5 ? 'red' : undefined}
          delta={errorDelta ? parseFloat(errorDelta) : undefined}
          deltaLabel={errorDelta ? `${parseFloat(errorDelta) > 0 ? '+' : ''}${errorDelta}% vs yesterday` : undefined}
        />
        <StatCard
          label="Today's Cost"
          value={`$${data.totalCostUsd.toFixed(2)}`}
          subtitle={`$${data.monthCostUsd.toFixed(2)} this month`}
        />
        <StatCard
          label="Avg Latency"
          value={`${(data.avgLatencyMs / 1000).toFixed(1)}s`}
          subtitle={`P95: ${(data.p95LatencyMs / 1000).toFixed(1)}s`}
        />
        <StatCard
          label="Active Traces"
          value={data.activeTraces}
          accent="blue"
        />
      </div>

      {/* Middle row */}
      <div className="grid md:grid-cols-5 gap-4">
        {/* Request volume chart */}
        <div className="md:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Request Volume (24h)
          </h2>
          {data.hourlyVolume.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.hourlyVolume} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  tickFormatter={(v: string) => new Date(v).getHours() + 'h'}
                />
                <YAxis
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#d1d5db' }}
                  labelFormatter={(v: string) => new Date(v).toLocaleTimeString()}
                />
                <Bar dataKey="total" fill="#3d5ce4" radius={[2, 2, 0, 0]} maxBarSize={24} name="Requests" />
                <Bar dataKey="errors" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={24} name="Errors" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
              No request data
            </div>
          )}
        </div>

        {/* Error Clusters (ES-powered) */}
        {data.errorClusters && data.errorClusters.length > 0 && (
          <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Error Patterns
            </h2>
            <div className="space-y-3">
              {data.errorClusters.map((cluster) => (
                <div
                  key={cluster.pattern}
                  className="bg-gray-800/50 border border-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-800 transition-colors"
                  onClick={() => void navigate(`/traces/${cluster.traceIds[0]}`)}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-red-400 truncate flex-1">{cluster.pattern}</p>
                    <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-red-900/50 text-red-300 rounded-full whitespace-nowrap">
                      {cluster.count}x
                    </span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    {cluster.models.length > 0 && <span>{cluster.models.join(', ')}</span>}
                    <span>{timeAgo(cluster.lastSeen)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent errors */}
        <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Recent Errors
          </h2>
          {data.recentErrors.length > 0 ? (
            <div className="space-y-3">
              {data.recentErrors.map((err) => (
                <div
                  key={err.traceId}
                  className="bg-gray-800/50 border border-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-800 transition-colors"
                  onClick={() => void navigate(`/traces/${err.traceId}`)}
                >
                  <p className="text-sm text-red-400 truncate">{err.errorMessage}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    {err.agentName && <span>{err.agentName}</span>}
                    {err.model && <span>{err.model}</span>}
                    <span>{timeAgo(err.startedAt)}</span>
                  </div>
                </div>
              ))}
              <button
                className="text-xs text-brand-500 hover:underline"
                onClick={() => void navigate('/traces?status=error')}
              >
                View all errors →
              </button>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
              No recent errors
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        {[
          { to: '/live', label: 'Live Feed', icon: '/' },
          { to: '/traces/compare', label: 'Compare Traces' },
          { to: '/cost', label: 'Cost Analysis' },
          { to: '/alerts', label: 'Manage Alerts' },
          { to: '/alerts/history', label: 'Alert History' },
        ].map((link) => (
          <button
            key={link.to}
            onClick={() => void navigate(link.to)}
            className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-100 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          >
            {link.label} →
          </button>
        ))}
      </div>

      {/* Bottom row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Model usage */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Model Usage
          </h2>
          {data.modelUsage.length > 0 ? (
            <div className="space-y-3">
              {data.modelUsage.map((m) => {
                const maxCalls = Math.max(...data.modelUsage.map((x) => x.calls));
                const pct = maxCalls > 0 ? (m.calls / maxCalls) * 100 : 0;
                return (
                  <div key={m.model}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-200 font-mono">{m.model}</span>
                      <span className="text-gray-500">
                        {m.calls.toLocaleString()} calls · ${m.costUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full">
                      <div
                        className="h-full bg-brand-600 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-600 text-sm">
              No model data
            </div>
          )}
        </div>

        {/* Top agents table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Top Agents
          </h2>
          {data.topAgents.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left pb-2">Agent</th>
                  <th className="text-right pb-2">Calls</th>
                  <th className="text-right pb-2">Errors</th>
                  <th className="text-right pb-2">Avg Latency</th>
                  <th className="text-right pb-2">Cost</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {data.topAgents.map((a) => (
                  <tr key={a.agentName} className="border-t border-gray-800">
                    <td className="py-2 font-mono text-gray-200 truncate max-w-[140px]">{a.agentName}</td>
                    <td className="py-2 text-right">{a.calls.toLocaleString()}</td>
                    <td className="py-2 text-right text-red-400">{a.errors}</td>
                    <td className="py-2 text-right">{(a.avgLatencyMs / 1000).toFixed(1)}s</td>
                    <td className="py-2 text-right">${a.costUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-600 text-sm">
              No agent data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
