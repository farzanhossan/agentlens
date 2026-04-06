import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAlerts, createAlert, updateAlert, deleteAlert } from '../lib/api';
import type { AlertResponse, AlertType, AlertChannel, CreateAlertPayload } from '../lib/types';
import { AlertForm } from '../components/AlertForm';
import { SkeletonCard } from '../components/Skeleton';

const alertTypeLabels: Record<AlertType, string> = {
  error_rate: 'Error Rate',
  cost_spike: 'Cost Spike',
  latency_p95: 'P95 Latency',
  failure: 'Failure Count',
};

const alertTypeUnits: Record<AlertType, string> = {
  error_rate: '%',
  cost_spike: '$',
  latency_p95: 'ms',
  failure: '',
};

const channelLabels: Record<AlertChannel, string> = {
  slack: 'Slack',
  email: 'Email',
  webhook: 'Webhook',
};

const channelIconColors: Record<AlertChannel, string> = {
  slack: 'text-purple-400',
  email: 'text-blue-400',
  webhook: 'text-green-400',
};

function AlertCard({
  alert,
  onToggle,
  onEdit,
  onDelete,
  isTogglingId,
  isDeletingId,
}: {
  alert: AlertResponse;
  onToggle: (id: string, current: boolean) => void;
  onEdit: (alert: AlertResponse) => void;
  onDelete: (id: string) => void;
  isTogglingId: string | null;
  isDeletingId: string | null;
}): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-gray-100 truncate">{alert.name}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 shrink-0">
            {alertTypeLabels[alert.type]}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>
            Threshold:{' '}
            <span className="text-gray-200 font-mono">
              {alertTypeUnits[alert.type] === '$' ? '$' : ''}
              {alert.threshold}
              {alertTypeUnits[alert.type] !== '$' ? alertTypeUnits[alert.type] : ''}
            </span>
          </span>
          <span className={channelIconColors[alert.channel]}>
            {channelLabels[alert.channel]}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Created {new Date(alert.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Toggle */}
        <button
          onClick={() => onToggle(alert.id, alert.isActive)}
          disabled={isTogglingId === alert.id}
          aria-label={alert.isActive ? 'Deactivate alert' : 'Activate alert'}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50 ${
            alert.isActive ? 'bg-brand-600' : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
              alert.isActive ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </button>

        {/* Edit */}
        <button
          onClick={() => onEdit(alert)}
          aria-label="Edit alert"
          className="text-gray-600 hover:text-brand-400 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          onClick={() => onDelete(alert.id)}
          disabled={isDeletingId === alert.id}
          aria-label="Delete alert"
          className="text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function AlertsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertResponse | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateAlertPayload) => createAlert(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      setShowForm(false);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateAlertPayload }) =>
      updateAlert(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      setEditingAlert(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateAlert(id, { isActive }),
    onMutate: ({ id }) => setTogglingId(id),
    onSettled: () => {
      setTogglingId(null);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAlert(id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => {
      setDeletingId(null);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  function handleToggle(id: string, current: boolean): void {
    toggleMutation.mutate({ id, isActive: !current });
  }

  function handleDelete(id: string): void {
    if (window.confirm('Delete this alert? This action cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-100">Alerts</h1>
        <button
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          onClick={() => setShowForm(true)}
        >
          + Create Alert
        </button>
      </div>

      {/* Error state for alerts query */}
      {alertsQuery.isError && (
        <p className="text-red-400 text-sm">Failed to load alerts.</p>
      )}

      {/* Loading */}
      {alertsQuery.isLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!alertsQuery.isLoading && !alertsQuery.isError && alertsQuery.data?.length === 0 && (
        <div className="text-center py-20 border border-dashed border-gray-800 rounded-xl">
          <svg className="w-10 h-10 text-gray-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="text-gray-500 text-sm">No alerts configured.</p>
          <p className="text-gray-600 text-xs mt-1">Click "Create Alert" to add your first alert.</p>
        </div>
      )}

      {/* Alert cards */}
      {!alertsQuery.isLoading && alertsQuery.data && alertsQuery.data.length > 0 && (
        <div className="grid gap-3">
          {alertsQuery.data.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onToggle={handleToggle}
              onEdit={(a) => setEditingAlert(a)}
              onDelete={handleDelete}
              isTogglingId={togglingId}
              isDeletingId={deletingId}
            />
          ))}
        </div>
      )}

      {/* Create alert form modal */}
      {showForm && (
        <AlertForm
          onSubmit={(data) => createMutation.mutate(data)}
          onClose={() => setShowForm(false)}
          isPending={createMutation.isPending}
        />
      )}

      {/* Edit alert form modal */}
      {editingAlert && (
        <AlertForm
          initial={editingAlert}
          onSubmit={(data) =>
            editMutation.mutate({ id: editingAlert.id, payload: data })
          }
          onClose={() => setEditingAlert(null)}
          isPending={editMutation.isPending}
        />
      )}
    </div>
  );
}
