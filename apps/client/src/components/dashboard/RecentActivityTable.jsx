import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const METHOD_STYLES = {
  POST: 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wider text-[#818cf8] border border-[rgba(99,102,241,0.3)]',
  GET: 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wider text-[#34d399] border border-[rgba(16,185,129,0.3)]',
  PUT: 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wider text-[#fbbf24] border border-[rgba(251,191,36,0.3)]',
  DELETE: 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wider text-[#fb7185] border border-[rgba(251,113,133,0.3)]',
  PATCH: 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wider text-[#94a3b8] border border-[rgba(148,163,184,0.2)]',
};

const METHOD_BG = {
  POST: 'rgba(99,102,241,0.08)',
  GET: 'rgba(16,185,129,0.08)',
  PUT: 'rgba(251,191,36,0.08)',
  DELETE: 'rgba(251,113,133,0.08)',
  PATCH: 'rgba(148,163,184,0.06)',
};

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return then.toLocaleDateString();
}

function formatAbsoluteTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString();
}

const RecentActivityTable = ({ activities = [], loading = false }) => {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div
        className="relative p-6 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
        }}
      >
        <div
          className="h-10 w-full rounded mb-3"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }}
        />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-12 w-full rounded mb-2"
            style={{
              background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)',
              backgroundSize: '200% 100%',
              animation: `shimmer 1.5s infinite ${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative p-6 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[--color-text-primary]">Recent Activity</h3>
            <p className="text-xs font-medium text-[--color-text-tertiary] mt-0.5">
              Live feed of API requests
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.15)',
            }}
          >
            <span className="text-3xl">📭</span>
          </div>
          <p className="text-base font-black text-[--color-text-primary] tracking-tight">
            No recent activity recorded
          </p>
          <p className="max-w-sm text-xs font-medium leading-relaxed text-[--color-text-tertiary]">
            Send a request to the API gateway to see live activity here. The table updates in real-time.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="relative p-6 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-glass-border)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(135deg, #22d3ee 0%, #38bdf8 100%)' }} />

      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-[--color-text-primary]">Recent Activity</h3>
          <p className="text-xs font-medium text-[--color-text-tertiary] mt-0.5">
            Live feed of API requests
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/logs')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
          style={{
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.2)',
            color: '#818cf8',
          }}
        >
          View All <ArrowRight size={12} />
        </motion.button>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[360px]">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {['Time', 'Method', 'Model', 'Status', 'Latency'].map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.15em] text-[--color-text-tertiary]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {activities.slice(0, 10).map((activity, index) => {
                const isOk = activity.status < 400;
                return (
                  <motion.tr
                    key={activity.id || index}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group transition-colors cursor-pointer"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap" title={formatAbsoluteTime(activity.timestamp)}>
                      <span className="font-mono text-xs font-bold text-[--color-text-tertiary]">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={METHOD_STYLES[activity.method] || METHOD_STYLES.PATCH}
                        style={{ background: METHOD_BG[activity.method] || METHOD_BG.PATCH }}
                      >
                        {activity.method || 'POST'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      {activity.model && activity.model !== 'unknown' ? (
                        <code
                          className="text-sm font-bold px-2 py-0.5 rounded truncate block max-w-[200px]"
                          style={{
                            background: 'rgba(129,140,248,0.08)',
                            border: '1px solid rgba(129,140,248,0.15)',
                            color: '#a5b4fc',
                          }}
                          title={activity.model}
                        >
                          {activity.model}
                        </code>
                      ) : (
                        <span className="text-xs font-medium text-[--color-text-tertiary]">Unknown</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div
                        className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider"
                        style={
                          isOk
                            ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }
                            : { background: 'rgba(251,113,133,0.1)', border: '1px solid rgba(251,113,133,0.25)', color: '#fb7185' }
                        }
                      >
                        <div
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: isOk ? '#34d399' : '#fb7185',
                            boxShadow: isOk ? '0 0 6px rgba(52,211,153,0.8)' : '0 0 6px rgba(251,113,133,0.8)',
                          }}
                        />
                        {activity.status}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-xs font-bold">
                      {activity.latencyMs != null ? (
                        <span style={{ color: activity.latencyMs > 2000 ? '#fb7185' : activity.latencyMs > 800 ? '#fbbf24' : '#34d399' }}>
                          {activity.latencyMs}ms
                        </span>
                      ) : '—'}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};

export default RecentActivityTable;
