import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Activity } from 'lucide-react';

const RANGES = ['24h', '7d', '30d'];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div
        className="p-3 rounded-lg text-sm"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <p className="font-mono text-xs text-[--color-text-tertiary] mb-2">{label}</p>
        {payload.map((entry, index) => {
          const formattedValue = entry.name === 'Tokens'
            ? `${(entry.value / 1000000).toFixed(2)}M`
            : entry.value.toLocaleString();
          return (
            <p key={index} className="font-bold" style={{ color: entry.color }}>
              {entry.name}: {formattedValue}
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

function generateChartData(logs = [], range) {
  const now = Date.now();
  const rangeMs = range === '24h' ? 24 * 60 * 60 * 1000 : range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const startTime = now - rangeMs;

  const bucketCount = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const bucketMs = rangeMs / bucketCount;

  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    time: new Date(startTime + i * bucketMs).toLocaleString(range === '24h' ? 'en' : 'en', {
      hour: range === '24h' ? '2-digit' : undefined,
      minute: range === '24h' ? '2-digit' : undefined,
      day: range !== '24h' ? 'numeric' : undefined,
      month: 'short',
    }),
    requests: 0,
    tokens: 0,
  }));

  logs.forEach(log => {
    const logTime = new Date(log.timestamp).getTime();
    if (logTime >= startTime) {
      const idx = Math.min(Math.floor((logTime - startTime) / bucketMs), bucketCount - 1);
      if (idx >= 0) {
        buckets[idx].requests += 1;
        buckets[idx].tokens += (log.promptTokens || 0) + (log.completionTokens || 0);
      }
    }
  });

  return buckets;
}

function generateMockData(logs = [], range) {
  const chartData = generateChartData(logs, range);
  const totalRequests = chartData.reduce((sum, b) => sum + b.requests, 0);
  const totalTokens = chartData.reduce((sum, b) => sum + b.tokens, 0);

  if (totalRequests === 0 && totalTokens === 0) {
    return [];
  }

  return chartData;
}

const UsageTrendChart = ({ data = [], logs = [], loading = false }) => {
  const [range, setRange] = useState('24h');

  const GRADIENTS = {
    indigo: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
    emerald: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  };

  const chartData = useMemo(() => {
    const logsData = logs.length > 0 ? logs : data;
    return generateMockData(logsData, range);
  }, [logs, data, range]);

  useEffect(() => {
    if (data.length === 0 && logs.length === 0) return;
  }, [data, logs]);

  if (loading) {
    return (
      <div
        className="relative p-5 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
          height: 330,
        }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="relative p-5 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-glass-border)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: GRADIENTS.indigo }} />

      <div className="flex items-center justify-between mb-3.5">
        <div>
          <h3 className="text-base font-bold text-[--color-text-primary]">Usage Trends</h3>
          <p className="text-xs font-medium text-[--color-text-tertiary] mt-0.5">
            Request volume and token consumption over time
          </p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
              style={
                range === r
                  ? {
                      background: 'rgba(99,102,241,0.12)',
                      border: '1px solid rgba(99,102,241,0.3)',
                      color: '#818cf8',
                    }
                  : {
                      background: 'transparent',
                      border: '1px solid transparent',
                      color: 'var(--color-text-tertiary)',
                    }
              }
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.15)',
            }}
          >
            <Activity size={24} style={{ color: '#6366f1' }} />
          </div>
          <p className="text-sm font-medium text-[--color-text-tertiary]">
            No historical usage data available yet. This will populate as requests are processed.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradientRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradientTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="time"
              stroke="var(--color-text-tertiary)"
              tick={{ fontSize: 11 }}
            />
            <YAxis
              stroke="var(--color-text-tertiary)"
              tick={{ fontSize: 11 }}
              tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val.toLocaleString()}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="requests"
              name="Requests"
              stroke="#6366f1"
              fill="url(#gradientRequests)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="tokens"
              name="Tokens"
              stroke="#10b981"
              fill="url(#gradientTokens)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </motion.div>
  );
};

export default UsageTrendChart;
