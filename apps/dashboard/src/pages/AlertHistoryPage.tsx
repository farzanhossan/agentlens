import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAlertHistory } from '../lib/api';
import type { AlertFiring } from '../lib/types';
import { SkeletonCard } from '../components/Skeleton';
import { downloadCsv } from '../lib/export-csv';

const alertTypeLabels: Record<string, string> = {
  error_rate: 'Error Rate',
  cost_spike: 'Cost Spike',
  latency_p95: 'P95 Latency',
  failure: 'Failure Count',
};

const channelLabels: Record<string, string> = {
  slack: 'Slack',
  email: 'Email',
  webhook: 'Webhook',
};

const statusColors: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
};

function FiringRow({ firing }: { firing: AlertFiring }): React.JSX.Element {
  const firedDate = new Date(firing.firedAt);
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
      {/* Timestamp */}
      <div className="w-40 shrink-0">
        <p className="text-sm text-gray-200">{firedDate.toLocaleDateString()}</p>
        <p className="text-xs text-gray-500">{firedDate.toLocaleTimeString()}</p>
      </div>

      {/* Alert name + type */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-100 truncate">{firing.alertName}</p>
        <p className="text-xs text-gray-500">{alertTypeLabels[firing.alertType] ?? firing.alertType}</p>
      </div>

      {/* Value vs threshold */}
      <div className="w-36 shrink-0 text-right">
        <p className="text-sm font-mono text-gray-200">
          {parseFloat(firing.currentValue).toFixed(4)}
        </p>
        <p className="text-xs text-gray-500">
          threshold: {parseFloat(firing.threshold).toFixed(4)}
        </p>
      </div>

      {/* Channel */}
      <span className="text-xs text-gray-400 w-16 shrink-0 text-center">
        {channelLabels[firing.channel] ?? firing.channel}
      </span>

      {/* Delivery status */}
      <span
        className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
          statusColors[firing.deliveryStatus] ?? 'bg-gray-700 text-gray-400'
        }`}
      >
        {firing.deliveryStatus}
      </span>
    </div>
  );
}

export function AlertHistoryPage(): React.JSX.Element {
  const historyQuery = useQuery({
    queryKey: ['alert-history'],
    queryFn: () => fetchAlertHistory(100, 0),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-100">Alert History</h1>
        <button
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50"
          disabled={!historyQuery.data?.length}
          onClick={() => {
            downloadCsv(
              (historyQuery.data ?? []).map((f) => ({
                firedAt: f.firedAt,
                alertName: f.alertName,
                alertType: f.alertType,
                currentValue: f.currentValue,
                threshold: f.threshold,
                channel: f.channel,
                deliveryStatus: f.deliveryStatus,
              })),
              'agentlens-alert-history.csv',
            );
          }}
        >
          Export CSV
        </button>
      </div>

      {historyQuery.isError && (
        <p className="text-red-400 text-sm">Failed to load alert history.</p>
      )}

      {historyQuery.isLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!historyQuery.isLoading && !historyQuery.isError && historyQuery.data?.length === 0 && (
        <div className="text-center py-20 border border-dashed border-gray-800 rounded-xl">
          <svg className="w-10 h-10 text-gray-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-gray-500 text-sm">No alerts have fired yet.</p>
        </div>
      )}

      {!historyQuery.isLoading && historyQuery.data && historyQuery.data.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-700 bg-gray-900/80 text-xs text-gray-500 uppercase tracking-wider">
            <span className="w-40 shrink-0">Fired At</span>
            <span className="flex-1">Alert</span>
            <span className="w-36 shrink-0 text-right">Value</span>
            <span className="w-16 shrink-0 text-center">Channel</span>
            <span className="w-16 shrink-0 text-center">Status</span>
          </div>
          {historyQuery.data.map((firing) => (
            <FiringRow key={firing.id} firing={firing} />
          ))}
        </div>
      )}
    </div>
  );
}
