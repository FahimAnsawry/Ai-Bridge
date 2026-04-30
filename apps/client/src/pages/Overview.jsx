import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Box,
  Zap,
  AlertCircle,
  RefreshCw,
  Server,
  TrendingUp,
  Shield,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { fetchStatus, fetchLogs, fetchProviderHealth } from '../api';
import PageHeader from '../components/dashboard/PageHeader';
import KPICard from '../components/dashboard/KPICard';
import UsageTrendChart from '../components/dashboard/UsageTrendChart';
import ModelDistribution from '../components/dashboard/ModelDistribution';
import ProviderHealthPanel from '../components/dashboard/ProviderHealthPanel';
import { SkeletonKpi, SkeletonChart, EmptyState, ErrorState } from '../components/dashboard/StateBanner';

const GRADIENTS = {
  blue:    'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
  rose:    'linear-gradient(135deg, #fb7185 0%, #f43f5e 100%)',
  emerald: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  violet:  'linear-gradient(135deg, #a855f7 0%, #818cf8 100%)',
  cyan:    'linear-gradient(135deg, #22d3ee 0%, #38bdf8 100%)',
  neon:    'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #22d3ee 100%)',
  amber:   'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
};

const GLOWS = {
  blue:    '0 0 24px rgba(99,102,241,0.2)',
  rose:    '0 0 24px rgba(251,113,133,0.2)',
  emerald: '0 0 24px rgba(16,185,129,0.2)',
  violet:  '0 0 24px rgba(168,85,247,0.2)',
  cyan:    '0 0 24px rgba(34,211,238,0.2)',
};

const Overview = ({ user }) => {
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [usageTrendData, setUsageTrendData] = useState([]);
  const [modelDistributionData, setModelDistributionData] = useState([]);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [providerHealth, setProviderHealth] = useState([]);
  const [isHealthLoading, setIsHealthLoading] = useState(true);
  const intervalRef = useRef(null);
  const logsIntervalRef = useRef(null);
  const healthIntervalRef = useRef(null);
  const endpoint = 'http://localhost:3000/v1';

  const loadData = useCallback(async () => {
    try {
      const statusData = await fetchStatus();
      setStatus(statusData);

      const logsRaw = await fetchLogs({ limit: 20 });
      const logsData = Array.isArray(logsRaw) ? logsRaw : logsRaw?.logs || [];
      setLogs(logsData);

      if (statusData) {
        setUsageTrendData([]);
        const modelMap = {};
        logsData.forEach(log => {
          const model = log.model || 'Unknown';
          modelMap[model] = (modelMap[model] || 0) + 1;
        });
        const total = Object.values(modelMap).reduce((a, b) => a + b, 0) || 1;
        setModelDistributionData(
          Object.entries(modelMap)
            .map(([name, requests], idx) => ({
              name,
              requests,
              percentage: (requests / total) * 100,
              color: [GRADIENTS.blue, GRADIENTS.emerald, GRADIENTS.violet, GRADIENTS.rose, GRADIENTS.cyan, GRADIENTS.amber][idx % 6].match(/#[a-f0-9]{6}/i)?.[0] || GRADIENTS.blue,
            }))
        );
      }

      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsInitialLoad(false);
    }
  }, []);

  const loadProviderHealth = useCallback(async () => {
    try {
      const health = await fetchProviderHealth();
      setProviderHealth(health.providers || []);
    } catch (e) {
      console.error('Failed to load provider health:', e.message);
      setProviderHealth([]);
    } finally {
      setIsHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      await loadData();
      await loadProviderHealth();
      if (!cancelled) setIsInitialLoad(false);
    };
    fetch();
    intervalRef.current = setInterval(fetch, 10_000);
    logsIntervalRef.current = setInterval(async () => {
      try {
        const logsData = await fetchLogs({ limit: 20 });
        if (!cancelled) setLogs(logsData || []);
      } catch (e) {
        console.error('Failed to fetch logs:', e.message);
      }
    }, 30_000);
    healthIntervalRef.current = setInterval(async () => {
      try {
        const health = await fetchProviderHealth();
        if (!cancelled) setProviderHealth(health.providers || []);
      } catch (e) {
        console.error('Failed to fetch provider health:', e.message);
      }
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      clearInterval(logsIntervalRef.current);
      clearInterval(healthIntervalRef.current);
    };
  }, [loadData, loadProviderHealth]);

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadData(), loadProviderHealth()]);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const handleHealthRefresh = async () => {
    await loadProviderHealth();
  };

  if (isInitialLoad) {
    return (
      <div className="flex flex-col gap-5 pb-10">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="h-16 w-48 rounded-2xl"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }}
        />
        <SkeletonKpi />
        <SkeletonChart />
        <SkeletonChart />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex flex-col gap-5 pb-10">
        <div className="h-32" />
        <ErrorState message={error} onRetry={handleRefresh} />
      </div>
    );
  }

  const hasData = status && (
    status.totalRequests > 0 ||
    status.activeModels > 0 ||
    logs.length > 0
  );

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* ── PAGE HEADER ──────────────────────────────────────────────────── */}
      <div className="shrink-0">
        <PageHeader
          isConnected={!error}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          endpoint={endpoint}
          onCopy={handleCopy}
          copied={copiedEndpoint}
        />
      </div>

      {/* ── SUMMARY STRIP ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="shrink-0 flex items-center rounded-2xl overflow-hidden divide-x"
        style={{
          background: 'linear-gradient(135deg, var(--color-bg-panel) 0%, var(--color-bg-muted-strong) 100%)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          divideColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ '--tw-divide-opacity': 1, borderColor: 'rgba(255,255,255,0.06)' }} className="flex w-full divide-x divide-[rgba(255,255,255,0.06)] overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-2.5 px-4 py-2 shrink-0">
            <span style={{ background: GRADIENTS.blue, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <Activity size={14} />
            </span>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] leading-none mb-1 text-[--color-text-tertiary]">Total Requests</span>
              <span className="text-sm font-black leading-none" style={{ background: GRADIENTS.blue, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {status?.totalRequests?.toLocaleString() ?? '0'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 shrink-0">
            <span style={{ background: GRADIENTS.rose, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <Zap size={14} />
            </span>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] leading-none mb-1 text-[--color-text-tertiary]">Tokens</span>
              <span className="text-sm font-black leading-none" style={{ background: GRADIENTS.rose, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {status?.totalTokens != null ? `${(status.totalTokens / 1000000).toFixed(2)}M` : '0'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 shrink-0">
            <span style={{ background: GRADIENTS.violet, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <Box size={14} />
            </span>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] leading-none mb-1 text-[--color-text-tertiary]">Active Models</span>
              <span className="text-sm font-black leading-none" style={{ background: GRADIENTS.violet, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {status?.activeModels ?? '0'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 shrink-0">
            <span style={{ background: status?.errorRate > 0 ? GRADIENTS.rose : GRADIENTS.emerald, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <AlertCircle size={14} />
            </span>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] leading-none mb-1 text-white">Error Rate</span>
              <span className="text-sm font-black leading-none text-white">
                {status?.errorRate != null ? `${status.errorRate}%` : '0%'}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── PROVIDER HEALTH STRIP ──────────────────────────────────────────── */}
      <ProviderHealthPanel
        providers={providerHealth}
        loading={isHealthLoading}
        isRefreshing={isRefreshing}
        onRefresh={handleHealthRefresh}
      />

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-4">
        {error ? (
          <div className="h-full overflow-y-auto pr-2">
            <ErrorState message={error} onRetry={handleRefresh} />
          </div>
        ) : !hasData ? (
          <div className="h-full overflow-y-auto pr-2">
            <EmptyState
              title="No data yet — start proxying requests"
              description="Your dashboard will populate with live metrics once you begin sending requests through the AI Proxy Gateway."
              ctaText="Configure Your First Model"
              onCta={() => window.location.href = '/settings'}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-4 lg:grid-rows-12 gap-4">
            {/* KPI Cards Condensed */}
            <div className="lg:col-span-1 lg:row-span-12 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
              <KPICard
                title="Total Requests"
                value={status?.totalRequests?.toLocaleString() ?? '0'}
                icon={<Activity size={16} />}
                gradient={GRADIENTS.blue}
                glowColor={GLOWS.blue}
                delay={0}
              />
              <KPICard
                title="Token Consumption"
                value={status?.totalTokens != null ? `${(status.totalTokens / 1000000).toFixed(2)}M` : '0'}
                icon={<Zap size={16} />}
                gradient={GRADIENTS.emerald}
                glowColor={GLOWS.emerald}
                delay={0.1}
              />

            </div>

            {/* Charts Area */}
            <div className="lg:col-span-3 lg:row-span-12 flex flex-col gap-4 min-h-0 overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
                <div className="lg:col-span-2">
                  <UsageTrendChart data={usageTrendData} logs={logs} loading={false} />
                </div>
                <div>
                  <ModelDistribution data={modelDistributionData} loading={false} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Overview;
