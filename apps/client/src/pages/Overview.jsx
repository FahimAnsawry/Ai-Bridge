import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, CalendarDays, Clock3, Database, Gauge, Radio, Send, Server, SquarePen } from 'lucide-react';
import { fetchStatus, fetchModelDistribution } from '../api';
import { queryKeys } from '../api/queryKeys';
import PageHeader from '../components/dashboard/PageHeader';
import ModelDistribution from '../components/dashboard/ModelDistribution';
import { ErrorState } from '../components/dashboard/StateBanner';
import { getTokenTotal } from '../utils/tokenUsage';
import OverviewSkeleton from '../components/dashboard/OverviewSkeleton';
import { useLiveLogs } from '../context/LiveLogsContext';

const ACTIVITY_LOG_LIMIT = 10;
// Vibrant gradient card themes matching the screenshot
const CARD_THEMES = [
  { gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', glow: 'rgba(99,102,241,0.4)',  iconBg: 'rgba(99,102,241,0.2)',  border: 'rgba(99,102,241,0.3)'  },
  { gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)', glow: 'rgba(59,130,246,0.4)',  iconBg: 'rgba(59,130,246,0.2)',  border: 'rgba(59,130,246,0.3)'  },
  { gradient: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)', glow: 'rgba(6,182,212,0.4)',   iconBg: 'rgba(6,182,212,0.2)',   border: 'rgba(6,182,212,0.3)'   },
  { gradient: 'linear-gradient(135deg, #10b981 0%, #22c55e 100%)', glow: 'rgba(16,185,129,0.4)',  iconBg: 'rgba(16,185,129,0.2)',  border: 'rgba(16,185,129,0.3)'  },
  { gradient: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)', glow: 'rgba(245,158,11,0.4)',  iconBg: 'rgba(245,158,11,0.2)',  border: 'rgba(245,158,11,0.3)'  },
  { gradient: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)', glow: 'rgba(236,72,153,0.4)',  iconBg: 'rgba(236,72,153,0.2)',  border: 'rgba(236,72,153,0.3)'  },
  { gradient: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', glow: 'rgba(59,130,246,0.4)',  iconBg: 'rgba(59,130,246,0.2)',  border: 'rgba(59,130,246,0.3)'  },
  { gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', glow: 'rgba(16,185,129,0.4)',  iconBg: 'rgba(16,185,129,0.2)',  border: 'rgba(16,185,129,0.3)'  },
];

function formatCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return new Intl.NumberFormat('en', {
    notation: n >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: n >= 10000 ? 1 : 0,
  }).format(n);
}

function isToday(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatLatency(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return '--';
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}s`;
  return `${Math.round(v)}ms`;
}

const MODEL_DISTRIBUTION_COLORS = ['#6366f1','#10b981','#a855f7','#fb7185','#22d3ee','#fbbf24'];

function normalizeModelDistribution(dist = []) {
  const total = dist.reduce((a, b) => a + b.requests, 0) || 1;
  return dist.map(({ name, requests }, idx) => ({
    name,
    requests,
    percentage: (requests / total) * 100,
    color: MODEL_DISTRIBUTION_COLORS[idx % MODEL_DISTRIBUTION_COLORS.length],
  }));
}

const StatCard = ({ title, value, icon: Icon, subtitle, theme, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.45, delay, ease: [0.23, 1, 0.32, 1] }}
    className="relative h-[96px] overflow-hidden rounded-2xl p-4 cursor-default sm:h-[104px] sm:p-5"
    style={{ background: theme.gradient, boxShadow: `0 8px 32px ${theme.glow}` }}
  >
    {/* inner shine */}
    <div className="absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%)' }} />

    <div className="relative z-10 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2 text-white/70">{title}</p>
        <p className="text-2xl font-black truncate leading-none text-white">{value}</p>
        {subtitle && <p className="mt-1.5 text-xs font-medium truncate text-white/60">{subtitle}</p>}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
        <Icon size={18} className="text-white" />
      </div>
    </div>
  </motion.div>
);

const ActivityFeed = ({ logs = [], loading = false }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay: 0.3 }}
    className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl px-5 py-4 sm:px-6 sm:py-5"
    style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
      backdropFilter: 'blur(22px)',
      border: '1px solid rgba(255,255,255,0.22)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
    }}
  >
    <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 55%)' }} />

    <div className="relative z-10 flex shrink-0 items-center justify-between gap-3">
      <h3 className="text-[13px] font-black uppercase tracking-[0.02em]" style={{ color: '#FFFFFF' }}>Request Activity</h3>
      <span
        className="inline-flex items-center gap-2 text-[13px] font-bold uppercase"
        style={{ color: 'rgba(255,255,255,0.78)' }}
      >
        <Radio size={16} strokeWidth={1.7} /> Live
      </span>
    </div>
    <div className="relative z-10 mt-4 shrink-0 border-t" style={{ borderColor: 'rgba(255,255,255,0.18)' }} />

    {loading ? (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="grid grid-cols-[32px_30px_minmax(0,1fr)] items-start gap-3 py-2">
            <div className="h-7 w-7 rounded-lg bg-white/10 animate-pulse" />
            <div className="h-6 w-6 rounded-lg bg-white/10 animate-pulse" />
            <div className="min-w-0 space-y-2">
              <div className="h-4 w-4/5 rounded bg-white/10 animate-pulse" />
              <div className="h-3 w-3/5 rounded bg-white/10 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    ) : logs.length === 0 ? (
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}>
          <Radio size={20} style={{ color: 'rgba(255,255,255,0.78)' }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.74)' }}>No requests yet</p>
      </div>
    ) : (
      <div className="custom-scrollbar relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
          {logs.map((log) => {
            const status = Number(log.status);
            const isStatusOk = status === 200;
            const statusTone = isStatusOk
              ? {
                  color: '#34d399',
                }
              : {
                  color: '#fb7185',
                };
            const tokens = getTokenTotal(log);
            const provider = log.provider || 'AgentRouter';
            return (
              <div
                key={log.id || log._id || `${log.timestamp}-${log.model}`}
                className="grid grid-cols-[32px_30px_minmax(0,1fr)] items-start gap-3 py-4"
              >
                <div className="pt-0.5" style={{ color: 'rgba(255,255,255,0.76)' }}>
                  <SquarePen size={25} strokeWidth={1.55} />
                </div>
                <div className="pt-1" style={{ color: 'rgba(255,255,255,0.68)' }}>
                  <Radio size={19} strokeWidth={1.55} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold leading-tight" style={{ color: '#FFFFFF' }}>
                    {log.method || 'POST'} {log.model || 'Unknown'} | {provider}
                  </p>
                  <p className="mt-1 text-[13px] font-medium leading-tight" style={{ color: 'rgba(255,255,255,0.72)' }}>
                    {formatLatency(log.latencyMs)} / {tokens > 0 ? `${formatCompact(tokens)} tokens` : '-- tokens'} |{' '}
                    <span className="font-black" style={{ color: statusTone.color }}>
                      {Number.isFinite(status) ? status : '--'}
                    </span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
  </motion.div>
);

const Overview = ({ user }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { logs: liveLogs, connectionStatus } = useLiveLogs();
  const statusQuery = useQuery({
    queryKey: queryKeys.status(),
    queryFn: fetchStatus,
    refetchInterval: 10_000,
    staleTime: 5_000,
    placeholderData: (previousData) => previousData,
  });
  const modelDistributionQuery = useQuery({
    queryKey: queryKeys.modelDistribution(),
    queryFn: fetchModelDistribution,
    select: normalizeModelDistribution,
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
  });

  const status = statusQuery.data || null;
  const logs = useMemo(() => liveLogs.slice(0, ACTIVITY_LOG_LIMIT), [liveLogs]);
  const logsLoading = connectionStatus === 'connecting';
  const modelDistributionData = modelDistributionQuery.data || [];
  const fetchError = statusQuery.error?.message || null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      statusQuery.refetch(),
      modelDistributionQuery.refetch(),
    ]);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const kpis = useMemo(() => {
    const now = Date.now();
    const recentLogs = logs.filter(l => { const t = new Date(l.timestamp).getTime(); return Number.isFinite(t) && t >= now - 60_000; });
    const latencies = logs.map(l => Number(l.latencyMs)).filter(v => Number.isFinite(v) && v > 0);
    const fallbackAvg = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
    const todayLogs = logs.filter(l => isToday(l.timestamp));
    const totalRequests = Number.isFinite(Number(status?.totalRequests)) ? Number(status.totalRequests) : logs.length;
    const todayRequests = Number.isFinite(Number(status?.todayRequests)) ? Number(status.todayRequests) : totalRequests;
    const totalTokens = Number.isFinite(Number(status?.totalTokens)) ? Number(status.totalTokens) : logs.reduce((s, l) => s + getTokenTotal(l), 0);
    const todayTokens = Number.isFinite(Number(status?.todayTokens)) ? Number(status.todayTokens) : todayLogs.reduce((s, l) => s + getTokenTotal(l), 0);
    const statusAvg = Number(status?.avgLatencyMs ?? status?.avgLatency);
    const avgLatency = Number.isFinite(statusAvg) && statusAvg > 0 ? statusAvg : fallbackAvg;
    const sorted = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const latest = sorted[0];
    const errorCount = logs.filter(l => Number(l.status) >= 400).length;
    const errorRate = logs.length > 0 ? ((errorCount / logs.length) * 100).toFixed(1) : '0.0';

    return [
      { title: 'Total Requests',   value: formatCompact(totalRequests),  icon: Database,      subtitle: 'All tracked requests',       theme: CARD_THEMES[0] },
      { title: 'Today Requests',   value: formatCompact(todayRequests),  icon: Send,          subtitle: 'Local calendar day',         theme: CARD_THEMES[1] },
      { title: "Today's Tokens",   value: formatCompact(todayTokens),    icon: CalendarDays,  subtitle: 'Tokens used today',          theme: CARD_THEMES[2] },
      { title: 'Total Tokens',     value: formatCompact(totalTokens),    icon: Activity,      subtitle: 'All tracked usage',          theme: CARD_THEMES[3] },
      { title: 'Requests / Min',   value: formatCompact(recentLogs.length), icon: Gauge,      subtitle: 'RPM to upstream API',        theme: CARD_THEMES[6] },
      { title: 'Avg Latency',      value: formatLatency(avgLatency),     icon: Clock3,        subtitle: 'Average upstream latency',   theme: CARD_THEMES[5] },
      { title: 'Active Model',     value: latest?.model || '--',         icon: Server,        subtitle: `via ${latest?.provider || '--'}`, theme: CARD_THEMES[6] },
      { title: 'Error Rate',       value: `${errorRate}%`,               icon: AlertTriangle, subtitle: `${errorCount} of ${logs.length} requests`, theme: { gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', glow: 'rgba(239,68,68,0.4)', iconBg: 'rgba(239,68,68,0.2)', border: 'rgba(239,68,68,0.3)' } },
    ];
  }, [logs, status]);

  const isInitialLoading = statusQuery.isPending && !statusQuery.data;

  if (isInitialLoading) {
    return <OverviewSkeleton />;
  }

  if (fetchError && !status) {
    return (
      <div className="flex flex-col gap-5 pb-10">
        <div className="h-32" />
        <ErrorState message={fetchError} onRetry={handleRefresh} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <div className="shrink-0">
        <PageHeader isConnected={!fetchError} onRefresh={handleRefresh} isRefreshing={isRefreshing} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {fetchError ? (
          <ErrorState message={fetchError} onRetry={handleRefresh} />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-5">
            {/* KPI grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {kpis.map((kpi, i) => (
                <StatCard key={kpi.title} {...kpi} delay={i * 0.05} />
              ))}
            </div>

            {/* Charts row */}
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="min-h-0 min-w-0">
                <ModelDistribution data={modelDistributionData} loading={false} />
              </div>
              <div className="min-h-0 min-w-0">
                <ActivityFeed logs={logs} loading={logsLoading} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Overview;
