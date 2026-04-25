import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Box } from 'lucide-react';

const RADIAN = Math.PI / 180;

const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight="bold"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const entry = payload[0].payload;
    return (
      <div
        className="p-3 rounded-lg text-sm"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <p className="font-bold text-[--color-text-primary]">{entry.name}</p>
        <p className="text-xs text-[--color-text-tertiary] mt-1">
          {entry.requests.toLocaleString()} requests
        </p>
      </div>
    );
  }
  return null;
};

const COLORS = ['#6366f1', '#10b981', '#a855f7', '#fb7185', '#22d3ee', '#fbbf24', '#818cf8', '#34d399'];

const ModelDistribution = ({ data = [], loading = false }) => {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [activeIndex, setActiveIndex] = useState(null);

  if (loading) {
    return (
      <div
      className="relative p-6 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
          height: 380,
        }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="relative p-6 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-glass-border)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' }} />

      <div className="mb-4">
        <h3 className="text-base font-bold text-[--color-text-primary]">Model Distribution</h3>
        <p className="text-xs font-medium text-[--color-text-tertiary] mt-0.5">
          Traffic split across deployed models
        </p>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'rgba(168,85,247,0.06)',
              border: '1px solid rgba(168,85,247,0.15)',
            }}
          >
            <Box size={24} style={{ color: '#a855f7' }} />
          </div>
          <p className="text-sm font-medium text-[--color-text-tertiary]">
            No model distribution data available yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="flex-1 w-full" style={{ minHeight: 220 }}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={95}
                  paddingAngle={2}
                  dataKey="requests"
                  onMouseEnter={(_, index) => { setHoveredIndex(index); setActiveIndex(index); }}
                  onMouseLeave={() => { setHoveredIndex(null); setActiveIndex(null); }}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color || COLORS[index % COLORS.length]}
                      stroke="var(--color-bg-panel)"
                      strokeWidth={2}
                      opacity={hoveredIndex !== null && hoveredIndex !== index ? 0.5 : 1}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap justify-center gap-2 w-full">
            {data.map((entry, index) => (
              <div
                key={entry.name}
                className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg cursor-pointer transition-all"
                style={{
                  background: hoveredIndex === index ? 'rgba(255,255,255,0.04)' : 'transparent',
                }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{
                      background: entry.color || COLORS[index % COLORS.length],
                      boxShadow: `0 0 8px ${entry.color || COLORS[index % COLORS.length]}40`,
                    }}
                  />
                  <span className="text-xs font-bold text-[--color-text-secondary]">
                    {entry.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-[--color-text-primary]">
                    {entry.percentage?.toFixed(1) ?? '0.0'}%
                  </span>
                  <span className="text-xs font-medium text-[--color-text-tertiary]">
                    ({entry.requests.toLocaleString()})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default ModelDistribution;
