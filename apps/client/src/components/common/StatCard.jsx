import React from 'react';
import { motion } from 'framer-motion';

const StatCard = ({ title, value, icon, description, trend, delay = 0, gradient = 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)', glow = 'rgba(99,102,241,0.3)' }) => {
  const positiveTrend = typeof trend === 'number' ? trend <= 0 : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="group relative overflow-hidden rounded-[--radius-lg] p-6 cursor-default"
      style={{
        background: 'linear-gradient(135deg, rgba(13,17,23,0.98) 0%, rgba(18,14,35,0.98) 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'border-color 0.3s, box-shadow 0.3s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)';
        e.currentTarget.style.boxShadow = `0 0 32px -8px ${glow}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Background orb */}
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-20 pointer-events-none"
        style={{ background: gradient }}
      />

      {/* Top gradient bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: gradient }}
      />

      <div className="relative flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[--color-text-tertiary]">{title}</p>
          <h3
            className="text-3xl font-black tracking-tight"
            style={{
              background: gradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {value}
          </h3>
        </div>

        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300"
          style={{
            background: gradient.replace(/linear-gradient\(135deg,\s*/, 'linear-gradient(135deg, ').replace(/\)$/, ', opacity 0.12)'),
            backgroundColor: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span
            style={{
              background: gradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {icon}
          </span>
        </div>
      </div>

      {(description || trend != null) && (
        <div className="mt-5 flex items-center gap-3">
          {trend != null && (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full"
              style={
                positiveTrend
                  ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)' }
                  : { background: 'rgba(251,113,133,0.12)', color: '#fb7185', border: '1px solid rgba(251,113,133,0.2)' }
              }
            >
              {positiveTrend ? '↓' : '↑'} {Math.abs(trend)}%
            </span>
          )}
          {description && (
            <span className="text-sm font-medium text-[--color-text-tertiary]">
              {description}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default StatCard;
