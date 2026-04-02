import React, { useState } from 'react';
import type { CostByModel } from '../lib/types';

type SortKey = 'model' | 'callCount' | 'avgTokensPerCall' | 'avgCostPerCall' | 'avgLatencyMs' | 'costUsd';
type SortDir = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
}

const COLUMNS: Column[] = [
  { key: 'model', label: 'Model' },
  { key: 'callCount', label: 'Calls' },
  { key: 'avgTokensPerCall', label: 'Avg Tokens' },
  { key: 'avgCostPerCall', label: 'Avg Cost' },
  { key: 'avgLatencyMs', label: 'Avg Latency' },
  { key: 'costUsd', label: 'Total Cost' },
];

function getValue(row: CostByModel, key: SortKey): string | number {
  switch (key) {
    case 'model': return row.model;
    case 'callCount': return row.callCount;
    case 'avgTokensPerCall': return row.avgTokensPerCall;
    case 'avgCostPerCall': return row.avgCostPerCall;
    case 'avgLatencyMs': return row.avgLatencyMs;
    case 'costUsd': return parseFloat(row.costUsd);
  }
}

export function ModelEfficiencyTable({ data }: { data: CostByModel[] }): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('costUsd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleHeaderClick(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = getValue(a, sortKey);
    const bv = getValue(b, sortKey);
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const an = av as number;
    const bn = bv as number;
    return sortDir === 'asc' ? an - bn : bn - an;
  });

  function SortIndicator({ col }: { col: SortKey }): React.JSX.Element | null {
    if (col !== sortKey) return <span className="text-gray-700 ml-1">↕</span>;
    return <span className="text-brand-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-300 transition-colors whitespace-nowrap"
                onClick={() => handleHeaderClick(col.key)}
              >
                {col.label}
                <SortIndicator col={col.key} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {sorted.map((row) => (
            <tr key={row.model} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-4 py-3 font-mono text-purple-400 text-xs truncate max-w-[160px]">
                {row.model}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {row.callCount.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {Math.round(row.avgTokensPerCall).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-gray-300">
                ${row.avgCostPerCall.toFixed(4)}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {(row.avgLatencyMs / 1000).toFixed(2)}s
              </td>
              <td className="px-4 py-3 text-gray-100 font-semibold">
                ${parseFloat(row.costUsd).toFixed(4)}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-600 text-sm">
                No data for this period
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
