import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Layers } from 'lucide-react';

const GRADIENTS = {
  neon: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #22d3ee 100%)',
  blue: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
  rose: 'linear-gradient(135deg, #fb7185 0%, #f43f5e 100%)',
};

const ShimmerSkeleton = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <motion.div
        key={i}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: i * 0.1 }}
        className="relative p-5 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div
            className="h-3 w-20 rounded"
            style={{
              background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
            }}
          />
          <div
            className="h-8 w-8 rounded-lg"
            style={{
              background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
            }}
          />
        </div>
        <div
          className="h-8 w-28 rounded"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }}
        />
        <div
          className="mt-4 h-10 w-full rounded"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }}
        />
      </motion.div>
    ))}
  </div>
);

export const SkeletonKpi = ShimmerSkeleton;

export const SkeletonChart = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="relative p-6 rounded-[--radius-md] overflow-hidden"
    style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid var(--color-glass-border)',
      height: 380,
    }}
  >
    <div
      className="absolute inset-0"
      style={{
        background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
      }}
    />
  </motion.div>
);

export const SkeletonTable = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="relative p-6 rounded-[--radius-md] overflow-hidden"
    style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid var(--color-glass-border)',
    }}
  >
    {Array.from({ length: 5 }).map((_, i) => (
      <div
        key={i}
        className="mt-3 h-10 w-full rounded"
        style={{
          background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)',
          backgroundSize: '200% 100%',
          animation: `shimmer 1.5s infinite ${i * 0.15}s`,
        }}
      />
    ))}
  </motion.div>
);

export const EmptyState = ({ title, description, ctaText, onCta }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="flex flex-col items-center justify-center py-20 text-center gap-4 rounded-[--radius-md]"
    style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid var(--color-glass-border)',
    }}
  >
    <div
      className="relative w-20 h-20 rounded-3xl flex items-center justify-center"
      style={{
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.15)',
      }}
    >
      <Layers size={32} style={{ color: '#6366f1' }} />
      <div
        className="absolute -inset-2 rounded-3xl opacity-30 blur-xl"
        style={{ background: GRADIENTS.neon }}
      />
    </div>
    <h3 className="text-xl font-black text-[--color-text-primary] tracking-tight">{title}</h3>
    <p className="max-w-md text-sm font-medium leading-relaxed text-[--color-text-tertiary]">
      {description}
    </p>
    {ctaText && onCta && (
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={onCta}
        className="mt-2 px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest text-white"
        style={{
          background: GRADIENTS.blue,
          boxShadow: '0 0 20px rgba(99,102,241,0.3)',
        }}
      >
        {ctaText}
      </motion.button>
    )}
  </motion.div>
);

export const ErrorState = ({ message, onRetry }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    className="flex items-center justify-between gap-4 px-6 py-5 rounded-[--radius-md] relative overflow-hidden"
    style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid var(--color-danger-border)',
    }}
  >
    <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: GRADIENTS.rose }} />
    <div className="flex items-center gap-4">
      <div
        className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: 'rgba(251,113,133,0.1)',
          border: '1px solid rgba(251,113,133,0.25)',
        }}
      >
        <AlertCircle size={18} style={{ color: '#fb7185' }} />
      </div>
      <div>
        <p className="text-base font-bold text-[--color-text-primary]">Failed to load dashboard</p>
        <p className="text-xs font-medium text-[--color-danger] mt-0.5">{message}</p>
      </div>
    </div>
    {onRetry && (
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={onRetry}
        className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest shrink-0"
        style={{
          background: 'rgba(251,113,133,0.08)',
          border: '1px solid rgba(251,113,133,0.25)',
          color: '#fb7185',
        }}
      >
        Reload Dashboard
      </motion.button>
    )}
  </motion.div>
);
