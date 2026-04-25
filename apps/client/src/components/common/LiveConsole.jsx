import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const LiveConsole = ({ logs, autoScroll = true }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div 
      ref={scrollRef}
      className="font-mono text-[12px] p-4 overflow-y-auto max-h-[600px] rounded-[--radius-lg] relative"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-glass-border)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[--radius-lg] opacity-50" style={{ background: 'var(--gradient-neon)' }} />
      <div className="flex flex-col gap-0.5 mt-1">
        {logs.map((log) => (
          <motion.div
            key={log.id || log._id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3 px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <span className="text-[--color-text-tertiary] shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
            <span className={`font-bold shrink-0 w-16 ${log.status < 400 ? 'text-[--color-success]' : 'text-[--color-danger]'}`}>
              {log.status}
            </span>
            <span className="text-[--color-accent-indigo] font-medium shrink-0 w-12">{log.method}</span>
            <span className="text-amber-500/80 truncate shrink-0 w-32">{log.model || 'N/A'}</span>
            <span className="text-cyan-500/80 truncate shrink-0 w-24">{log.provider || '—'}</span>
            <span className="text-[--color-text-secondary] truncate flex-1">{log.path}</span>
            <span className="text-[--color-text-tertiary] shrink-0">{log.latencyMs}ms</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default LiveConsole;
