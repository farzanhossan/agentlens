import React from 'react';

export function SkeletonRow({ cols }: { cols: number }): React.JSX.Element {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-800 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard(): React.JSX.Element {
  return (
    <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="h-3 bg-gray-800 rounded w-1/3 mb-3" />
      <div className="h-7 bg-gray-800 rounded w-1/2 mb-2" />
      <div className="h-3 bg-gray-800 rounded w-2/3" />
    </div>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }): React.JSX.Element {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 bg-gray-800 rounded"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}
