import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { fetchStatus, fetchLogs } from '../api';
import PageHeader from '../components/dashboard/PageHeader';
import UsageTrendChart from '../components/dashboard/UsageTrendChart';
import ModelDistribution from '../components/dashboard/ModelDistribution';
import { SkeletonKpi, SkeletonChart, EmptyState, ErrorState } from '../components/dashboard/StateBanner';
import AccessKeyDisplay from '../components/common/AccessKeyDisplay';

const GRADIENTS = {
  blue:    'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
  rose:    'linear-gradient(135deg, #fb7185 0%, #f43f5e 100%)',
  emerald: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  violet:  'linear-gradient(135deg, #a855f7 0%, #818cf8 100%)',
  cyan:    'linear-gradient(135deg, #22d3ee 0%, #38bdf8 100%)',
  neon:    'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #22d3ee 100%)',
  amber:   'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
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
  const intervalRef = useRef(null);
  const logsIntervalRef = useRef(null);
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

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      await loadData();
      if (!cancelled) setIsInitialLoad(false);
    };
    fetch();
    intervalRef.current = setInterval(fetch, 10_000);
    logsIntervalRef.current = setInterval(async () => {
      try {
        const logsRaw = await fetchLogs({ limit: 20 });
        const logsData = Array.isArray(logsRaw) ? logsRaw : logsRaw?.logs || [];
        if (!cancelled) setLogs(logsData);
      } catch (e) {
        console.error('Failed to fetch logs:', e.message);
      }
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      clearInterval(logsIntervalRef.current);
    };
  }, [loadData]);

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setTimeout(() => setIsRefreshing(false), 600);
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

      <div className="shrink-0">
        <AccessKeyDisplay accessKey={user?.accessKey} />
      </div>

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
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 min-h-0">
              <UsageTrendChart data={usageTrendData} logs={logs} loading={false} />
            </div>
            <div className="min-h-0">
              <ModelDistribution data={modelDistributionData} loading={false} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Overview;
