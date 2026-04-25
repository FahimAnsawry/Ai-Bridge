import React from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from 'recharts';

const KPICard = ({ title, value, icon, trend, trendLabel, sparklineData, gradient, glowColor, delay = 0, loading }) => {
  const positiveTrend = typeof trend === 'number' ? trend >= 0 : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ scale: 1.02, y: -4, transition: { duration: 0.2 } }}
      className="relative flex flex-col justify-between p-5 rounded-2xl overflow-hidden cursor-default"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-glass-border)',
        transition: 'border-color 0.3s, box-shadow 0.3s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
        e.currentTarget.style.boxShadow = glowColor || 'none';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-glass-border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div
        className="absolute -top-6 -right-6 w-16 h-16 rounded-full blur-xl opacity-30 pointer-events-none"
        style={{ background: gradient }}
      />

      <div className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: gradient }} />

      <div className="flex items-center justify-between mb-3 relative z-10">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[--color-text-tertiary]">{title}</p>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{
            background: `${gradient.replace(')', ', 0.15)').replace('linear-gradient', 'linear-gradient')}`,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span style={{ background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {icon}
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-3 relative z-10">
        <p className="text-3xl font-black text-[--color-text-primary]">
          {loading ? '—' : value}
        </p>
        {!loading && trend != null && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full"
            style={
              positiveTrend
                ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)' }
                : { background: 'rgba(251,113,133,0.12)', color: '#fb7185', border: '1px solid rgba(251,113,133,0.2)' }
            }
          >
            {positiveTrend ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>

      {!loading && trendLabel && (
        <p className="mt-1 text-xs font-medium text-[--color-text-tertiary] relative z-10">{trendLabel}</p>
      )}

      {!loading && sparklineData && sparklineData.length > 0 && (
        <div className="mt-3 h-10 w-full relative z-10" style={{ minHeight: 40 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData}>
              <defs>
                <linearGradient id={`gradient-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke="#6366f1"
                fill={`url(#gradient-${title.replace(/\s/g, '')})`}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
};

export default KPICard;
