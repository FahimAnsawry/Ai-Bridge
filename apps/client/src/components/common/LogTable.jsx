import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const BASE_BADGE = 'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-widest border';

const METHOD_STYLES = {
  POST: `${BASE_BADGE} text-[#818cf8] border-[rgba(99,102,241,0.3)]`,
  GET: `${BASE_BADGE} text-[#34d399] border-[rgba(16,185,129,0.3)]`,
  DELETE: `${BASE_BADGE} text-[#fb7185] border-[rgba(251,113,133,0.3)]`,
  PUT: `${BASE_BADGE} text-[#fbbf24] border-[rgba(251,191,36,0.3)]`,
  PATCH: `${BASE_BADGE} text-[#94a3b8] border-[rgba(148,163,184,0.2)]`,
};

const METHOD_BG = {
  POST: 'rgba(99,102,241,0.08)',
  GET: 'rgba(16,185,129,0.08)',
  DELETE: 'rgba(251,113,133,0.08)',
  PUT: 'rgba(251,191,36,0.08)',
  PATCH: 'rgba(148,163,184,0.06)',
};

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const LogTable = ({ logs = [], loading = false }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [logs.length]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div
          className="h-8 w-8 rounded-full border-2 animate-spin"
          style={{ borderColor: 'rgba(99,102,241,0.2)', borderTopColor: '#6366f1', boxShadow: '0 0 16px rgba(99,102,241,0.4)' }}
        />
        <p className="text-sm font-bold text-[--color-text-tertiary] tracking-widest uppercase text-xs">Streaming logs...</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-4xl"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}
        >
          📭
        </div>
        <p className="text-base font-black text-[--color-text-primary] tracking-tight">No activity recorded</p>
        <p className="max-w-xs text-xs font-medium leading-relaxed text-[--color-text-tertiary]">
          Send a request to the gateway to populate this operational stream.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto overflow-y-auto max-h-[600px]" ref={scrollRef}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {['Time', 'Endpoint', 'Model', 'Provider', 'Status', 'Latency', 'Tokens', 'Type'].map((col) => (
              <th
                key={col}
                className="px-4 py-3.5 text-left text-xs font-black uppercase tracking-[0.2em] text-[--color-text-tertiary]"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {logs.map((log) => {
              const isOk = log.status < 400;
              const tokens = (log.promptTokens || 0) + (log.completionTokens || 0);

              return (
                <motion.tr
                  key={log.id || log._id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="group transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Time */}
                  <td className="px-4 py-3.5 whitespace-nowrap font-mono text-[11px] font-bold text-[--color-text-tertiary]">
                    {formatTime(log.timestamp)}
                  </td>

                  {/* Endpoint */}
                  <td className="px-4 py-3.5">
                    <div className="flex min-w-[14rem] flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={METHOD_STYLES[log.method] || METHOD_STYLES.PATCH}
                          style={{ background: METHOD_BG[log.method] || METHOD_BG.PATCH }}
                        >
                          {log.method}
                        </span>
                        {log.streaming && (
                          <span
                            className={BASE_BADGE}
                            style={{ background: 'rgba(168,85,247,0.08)', color: '#c084fc', borderColor: 'rgba(168,85,247,0.25)' }}
                          >
                            Stream
                          </span>
                        )}
                      </div>
                      <span className="break-all text-[11px] font-bold text-[--color-text-secondary] opacity-70">{log.path}</span>
                    </div>
                  </td>

                  {/* Model */}
                  <td className="px-4 py-3.5">
                    {log.model && log.model !== 'unknown' ? (
                      <code
                        className="break-all text-sm font-bold px-2 py-0.5 rounded"
                        style={{
                          background: 'rgba(129,140,248,0.08)',
                          border: '1px solid rgba(129,140,248,0.15)',
                          color: '#a5b4fc',
                        }}
                      >
                        {log.model}
                      </code>
                    ) : (
                      <span className="text-xs font-medium text-[--color-text-tertiary]">Unknown</span>
                    )}
                  </td>

                  {/* Provider */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {log.provider ? (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{
                          background: 'rgba(34,211,238,0.08)',
                          border: '1px solid rgba(34,211,238,0.2)',
                          color: '#22d3ee',
                        }}
                      >
                        {log.provider}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-[--color-text-tertiary]">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <div
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest"
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
                      {log.status}
                    </div>
                  </td>

                  {/* Latency */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-xs font-bold text-[--color-text-secondary]">
                    {log.latencyMs != null ? (
                      <span style={{ color: log.latencyMs > 2000 ? '#fb7185' : log.latencyMs > 800 ? '#fbbf24' : '#34d399' }}>
                        {log.latencyMs}ms
                      </span>
                    ) : '—'}
                  </td>

                  {/* Tokens */}
                  <td className="px-4 py-3.5 text-xs font-bold text-[--color-text-secondary]">
                    {tokens > 0 ? (
                      <span style={{ color: '#818cf8' }}>{tokens.toLocaleString()}</span>
                    ) : '—'}
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3.5">
                    {log.streaming ? (
                      <span
                        className="text-xs font-black uppercase tracking-widest"
                        style={{ color: '#818cf8', textShadow: '0 0 8px rgba(129,140,248,0.5)' }}
                      >
                        EventStream
                      </span>
                    ) : (
                      <span className="text-xs font-black uppercase tracking-widest text-[--color-text-tertiary]">
                        Buffered
                      </span>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
};

export default LogTable;
