import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { CostTimeseries } from '../lib/types';

interface CostLineChartProps {
  data: CostTimeseries[];
}

export function CostLineChart({ data }: CostLineChartProps): React.JSX.Element {
  const chartData = data.map((d) => ({
    date: d.date,
    costUsd: parseFloat(d.costUsd),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#374151' }}
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(4)}`}
          width={70}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
          labelStyle={{ color: '#d1d5db' }}
          itemStyle={{ color: '#4f6ef7' }}
          formatter={(value: unknown) => [`$${(value as number).toFixed(6)}`, 'Cost']}
        />
        <Line
          type="monotone"
          dataKey="costUsd"
          stroke="#4f6ef7"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#4f6ef7' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface CostBarChartProps {
  data: Array<Record<string, unknown>>;
  labelKey: string;
  valueKey: string;
  title: string;
}

export function CostBarChart({ data, labelKey, valueKey }: CostBarChartProps): React.JSX.Element {
  const chartData = data.map((d) => ({
    ...d,
    [valueKey]: typeof d[valueKey] === 'string' ? parseFloat(d[valueKey] as string) : d[valueKey],
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
        <XAxis
          dataKey={labelKey}
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#374151' }}
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(4)}`}
          width={70}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
          labelStyle={{ color: '#d1d5db' }}
          itemStyle={{ color: '#3d5ce4' }}
          formatter={(value: unknown) => [`$${(value as number).toFixed(6)}`, 'Cost']}
        />
        <Bar dataKey={valueKey} fill="#3d5ce4" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
