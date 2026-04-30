import React from 'react';
import { motion } from 'framer-motion';
import { Globe, Wifi, WifiOff, HelpCircle, AlertTriangle, Clock, Loader2 } from 'lucide-react';

const STATUS_CONFIG = {
  online: {
    icon: Wifi,
    label: 'Online',
    textColor: '#34d399',
    dotColor: '#10b981',
    bgColor: 'rgba(16,185,129,0.08)',
    borderColor: 'rgba(16,185,129,0.15)',
  },
  error: {
    icon: WifiOff,
    label: 'Error',
    textColor: '#fb7185',
    dotColor: '#f43f5e',
    bgColor: 'rgba(251,113,133,0.08)',
    borderColor: 'rgba(251,113,133,0.15)',
  },
  unauthorized: {
    icon: AlertTriangle,
    label: 'Invalid Key',
    textColor: '#fbbf24',
    dotColor: '#f59e0b',
    bgColor: 'rgba(251,191,36,0.08)',
    borderColor: 'rgba(251,191,36,0.15)',
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    textColor: '#94a3b8',
    dotColor: '#64748b',
    bgColor: 'rgba(100,116,139,0.08)',
    borderColor: 'rgba(100,116,139,0.12)',
  },
};

function SkeletonRow() {
  return (
    <div
      className="h-8 w-40 rounded-lg animate-pulse"
      style={{ background: 'rgba(255,255,255,0.04)' }}
    />
  );
}

const ProviderHealthPanel = ({
  providers = [],
  loading = false,
  isRefreshing = false,
  onRefresh,
}) => {
  const provider = providers[0] || null;
  const cfg = provider ? (STATUS_CONFIG[provider.status] || STATUS_CONFIG.unknown) : STATUS_CONFIG.unknown;
  const Icon = cfg.icon;

  if (loading) {
    return (
      <div className="shrink-0 flex items-center rounded-2xl overflow-hidden px-4 py-2 gap-3"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-border-strong)',
        }}
      >
        <Globe size={13} className="text-[--color-text-tertiary] shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[--color-text-tertiary] whitespace-nowrap">
          Active Provider
        </span>
        <SkeletonRow />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.05 }}
      className="shrink-0 flex items-center rounded-2xl overflow-hidden px-4 py-2 gap-3"
      style={{
        background: 'var(--color-bg-panel)',
        border: `1px solid ${cfg.borderColor}`,
        boxShadow: provider?.status === 'online'
          ? '0 0 20px rgba(16,185,129,0.05)'
          : provider?.status === 'error' || provider?.status === 'unauthorized'
          ? '0 0 20px rgba(251,113,133,0.05)'
          : 'none',
      }}
    >
      {/* Globe icon */}
      <Globe size={13} style={{ color: cfg.textColor }} className="shrink-0" />

      {/* Label */}
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[--color-text-tertiary] whitespace-nowrap">
        Active Provider
      </span>

      {/* Divider */}
      <div className="h-4 w-px bg-white/8 shrink-0" />

      {/* Provider name + status badge */}
      {provider ? (
        <div className="flex items-center gap-2">
          {/* Animated pulse dot */}
          <span className="relative flex h-2 w-2 shrink-0">
            {provider.status === 'online' ? (
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: cfg.dotColor }}
              />
            ) : null}
            <span
              className="relative inline-flex rounded-full h-2 w-2 shrink-0"
              style={{ background: cfg.dotColor }}
            />
          </span>

          <span className="text-xs font-bold text-white truncate max-w-[120px]">
            {provider.name}
          </span>

          <span
            className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0"
            style={{
              background: cfg.bgColor,
              color: cfg.textColor,
              border: `1px solid ${cfg.borderColor}`,
            }}
          >
            {cfg.label}
          </span>

          {provider.latencyMs != null && provider.status === 'online' && (
            <span className="text-[10px] font-mono text-[--color-text-tertiary] shrink-0">
              {provider.latencyMs}ms
            </span>
          )}

          {provider.hasApiKey === false && provider.status !== 'online' && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0"
              style={{
                background: 'rgba(251,191,36,0.08)',
                color: '#fbbf24',
                border: '1px solid rgba(251,191,36,0.15)',
              }}
              title="Add API key in Settings to enable health checks"
            >
              No Key
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[--color-text-tertiary]">
          <HelpCircle size={12} />
          <span className="text-xs font-medium">No active provider</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Refresh button */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          title="Refresh provider health"
          className="shrink-0 p-1.5 rounded-lg text-[--color-text-tertiary] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          {isRefreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Clock size={12} />
          )}
        </button>
      )}
    </motion.div>
  );
};

export default ProviderHealthPanel;