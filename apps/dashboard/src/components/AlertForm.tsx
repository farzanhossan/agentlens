import React, { useState } from 'react';
import type { AlertResponse, AlertType, AlertChannel, CreateAlertPayload } from '../lib/types';

export interface AlertFormProps {
  initial?: AlertResponse;
  onSubmit: (data: CreateAlertPayload) => void;
  onClose: () => void;
  isPending: boolean;
}

const alertTypeLabels: Record<AlertType, string> = {
  error_rate: 'Error Rate',
  cost_spike: 'Cost Spike',
  latency_p95: 'P95 Latency',
  failure: 'Failure Count',
};

const thresholdLabels: Record<AlertType, string> = {
  error_rate: 'Threshold (%)',
  cost_spike: 'Threshold ($)',
  latency_p95: 'Threshold (ms)',
  failure: 'Threshold (count)',
};

const channelLabels: Record<AlertChannel, string> = {
  slack: 'Slack',
  email: 'Email',
  webhook: 'Webhook',
};

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full';

export function AlertForm({ initial, onSubmit, onClose, isPending }: AlertFormProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AlertType>(initial?.type ?? 'error_rate');
  const [threshold, setThreshold] = useState<string>(initial?.threshold ?? '');
  const [channel, setChannel] = useState<AlertChannel>(initial?.channel ?? 'email');
  const [webhookUrl, setWebhookUrl] = useState<string>(
    (initial?.channelConfig['webhookUrl'] as string | undefined) ?? ''
  );
  const [emailTo, setEmailTo] = useState<string>(
    (initial?.channelConfig['to'] as string | undefined) ?? ''
  );
  const [webhookEndpoint, setWebhookEndpoint] = useState<string>(
    (initial?.channelConfig['url'] as string | undefined) ?? ''
  );

  function buildChannelConfig(): Record<string, unknown> {
    if (channel === 'slack') return { webhookUrl };
    if (channel === 'email') return { to: emailTo };
    return { url: webhookEndpoint };
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSubmit({
      name,
      type,
      threshold: parseFloat(threshold),
      channel,
      channelConfig: buildChannelConfig(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-gray-100">
            {initial ? 'Edit Alert' : 'Create Alert'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              className={inputClass}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alert name"
              required
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <select
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value as AlertType)}
            >
              {(Object.keys(alertTypeLabels) as AlertType[]).map((t) => (
                <option key={t} value={t}>
                  {alertTypeLabels[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Threshold */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">{thresholdLabels[type]}</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0"
              required
            />
          </div>

          {/* Channel */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Channel</label>
            <select
              className={inputClass}
              value={channel}
              onChange={(e) => setChannel(e.target.value as AlertChannel)}
            >
              {(Object.keys(channelLabels) as AlertChannel[]).map((c) => (
                <option key={c} value={c}>
                  {channelLabels[c]}
                </option>
              ))}
            </select>
          </div>

          {/* Channel config */}
          {channel === 'slack' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Slack Webhook URL</label>
              <input
                className={inputClass}
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/..."
                required
              />
            </div>
          )}

          {channel === 'email' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email Address</label>
              <input
                className={inputClass}
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          )}

          {channel === 'webhook' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Webhook URL</label>
              <input
                className={inputClass}
                type="url"
                value={webhookEndpoint}
                onChange={(e) => setWebhookEndpoint(e.target.value)}
                placeholder="https://your-endpoint.com/..."
                required
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Saving…' : initial ? 'Update Alert' : 'Create Alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
