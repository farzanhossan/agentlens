import React from 'react';

type Status = 'running' | 'success' | 'error' | 'timeout';

const badgeClasses: Record<string, string> = {
  running: 'bg-blue-900/50 text-blue-300 ring-1 ring-blue-700',
  success: 'bg-green-900/50 text-green-300 ring-1 ring-green-700',
  error: 'bg-red-900/50 text-red-300 ring-1 ring-red-700',
  timeout: 'bg-yellow-900/50 text-yellow-300 ring-1 ring-yellow-700',
};

const dotClasses: Record<string, string> = {
  running: 'bg-blue-400',
  success: 'bg-green-400',
  error: 'bg-red-400',
  timeout: 'bg-yellow-400',
};

export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const classes = badgeClasses[status] ?? 'bg-gray-800 text-gray-400 ring-1 ring-gray-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${classes}`}>
      {status}
    </span>
  );
}

export function StatusDot({ status }: { status: string }): React.JSX.Element {
  const classes = dotClasses[status as Status] ?? 'bg-gray-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${classes}`} />;
}
