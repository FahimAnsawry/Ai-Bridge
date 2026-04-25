import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Copy,
  Check,
  RefreshCw,
  Globe,
} from 'lucide-react';

const GRADIENTS = {
  blue: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
  rose: 'linear-gradient(135deg, #fb7185 0%, #f43f5e 100%)',
  emerald: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  violet: 'linear-gradient(135deg, #a855f7 0%, #818cf8 100%)',
  cyan: 'linear-gradient(135deg, #22d3ee 0%, #38bdf8 100%)',
  neon: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #22d3ee 100%)',
  amber: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
};

const LiveClock = () => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <span
      className="text-xs font-black mono px-4 py-2 rounded-full border flex items-center gap-2"
      style={{
        background: 'rgba(99,102,241,0.06)',
        borderColor: 'rgba(99,102,241,0.25)',
        color: '#818cf8',
        boxShadow: '0 0 12px rgba(99,102,241,0.1)',
      }}
    >
      <div className="w-1.5 h-1.5 rounded-full bg-[#818cf8] animate-pulse" />
      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
};

const PageHeader = ({ isConnected, onRefresh, endpoint, onCopy, copied, isRefreshing }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
    >
      <div>
        <h1
          className="text-3xl font-black tracking-tight"
          style={{
            background: GRADIENTS.neon,
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            animation: 'shimmer 5s linear infinite',
          }}
        >
          Overview
        </h1>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[--color-text-tertiary] mt-1.5">
          AI Proxy Gateway · Dashboard
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-black uppercase tracking-widest border"
          style={
            isConnected
              ? {
                  background: 'rgba(16,185,129,0.08)',
                  borderColor: 'rgba(16,185,129,0.3)',
                  color: '#10b981',
                  boxShadow: '0 0 16px rgba(16,185,129,0.2)',
                }
              : {
                  background: 'rgba(251,113,133,0.08)',
                  borderColor: 'rgba(251,113,133,0.3)',
                  color: '#fb7185',
                  boxShadow: '0 0 16px rgba(251,113,133,0.2)',
                }
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={isConnected ? 'animate-pulse' : ''}
          >
            <path
              d="M12 2L14.5 9L22 10L16 15L18 22L12 18L6 22L8 15L2 10L9.5 9L12 2Z"
              fill={isConnected ? '#10b981' : '#fb7185'}
              stroke={isConnected ? '#34d399' : '#f87171'}
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
          </svg>
          {isConnected ? 'Server Online' : 'Server Offline'}
        </div>

        <LiveClock />

        <motion.button
          whileHover={{ rotate: 180, scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.35 }}
          onClick={() => onRefresh?.()}
          disabled={isRefreshing}
          title="Refresh"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[--color-glass-border] bg-[--color-bg-elevated] text-[--color-text-tertiary] transition-all"
          style={{ boxShadow: '0 0 0 0 rgba(99,102,241,0)' }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)';
            e.currentTarget.style.boxShadow = '0 0 16px rgba(99,102,241,0.25)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-glass-border)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <RefreshCw
            size={15}
            className={isRefreshing ? 'animate-spin' : ''}
            style={{ color: isRefreshing ? '#6366f1' : 'var(--color-text-tertiary)' }}
          />
        </motion.button>

        {endpoint && (
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold"
            style={{
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border-strong)',
              color: '#818cf8',
            }}
          >
            <Globe size={13} />
            <code className="font-mono truncate max-w-[160px]">{endpoint}</code>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => onCopy(endpoint)}
              className="ml-1 p-1 rounded"
              style={{ color: copied ? '#34d399' : 'var(--color-text-tertiary)' }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </motion.button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default PageHeader;
