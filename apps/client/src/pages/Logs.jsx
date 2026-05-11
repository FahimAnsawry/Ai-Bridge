import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { io } from 'socket.io-client';
import LogTable from '../components/common/LogTable';
import LiveConsole from '../components/common/LiveConsole';
import ConfirmationModal from '../components/common/ConfirmationModal';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Trash2,
  Search,
  Wifi,
  WifiOff,
  Table,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { fetchLogs, clearLogs as apiClearLogs } from '../api';
import { getTokenTotal } from '../utils/tokenUsage';

const PANEL_STYLE = {
  background: 'var(--color-bg-panel)',
  border: '1px solid var(--color-glass-border)',
};

const PAGE_SIZES = [25, 50, 100, 200];

const Logs = ({ user }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [viewMode, setViewMode] = useState('table');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const socketRef = useRef(null);

  const loadLogs = useCallback(async () => {
    try {
      const data = await fetchLogs({ limit: 200 });
      // Support both array response and object { logs: [], total: 0 }
      setLogs(Array.isArray(data) ? data : data?.logs || []);
    } catch (e) {
      console.error('Failed to fetch logs:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      setIsConnecting(false);
      if (user?._id) {
        socket.emit('join', user._id);
      }
    });
    socket.on('connect_error', () => {
      setIsConnecting(false);
    });
    socket.on('disconnect',   ()      => setConnected(false));
    socket.on('new_log',      (entry) => setLogs((prev) => [entry, ...prev].slice(0, 500)));
    socket.on('logs_cleared', ()      => setLogs([]));
    return () => socket.disconnect();
  }, [user]);

  const handleClear = async () => {
    await apiClearLogs().catch(console.error);
    setLogs([]);
  };

  const handleExport = () => {
    const headers = 'Time,Method,Path,Model,Provider,Status,LatencyMs,Tokens,Streaming\n';
    const rows = logs.map((log) => [
      log.timestamp, log.method, log.path, log.model, log.provider || '',
      log.status, log.latencyMs, getTokenTotal(log), log.streaming,
    ].join(','));
    const blob = new Blob([headers + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `proxy-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => (
    search
      ? logs.filter((log) => {
        const q = search.toLowerCase();
        return log.path?.toLowerCase().includes(q) || log.model?.toLowerCase().includes(q) ||
               String(log.status).includes(q) || log.method?.toLowerCase().includes(q);
      })
      : logs
  ), [logs, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filtered.length);
  const paginatedLogs = useMemo(() => (
    filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  ), [filtered, pageSize, safePage]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const goToPage = (nextPage) => {
    setPage(Math.min(Math.max(1, nextPage), pageCount));
  };

  const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.45, ease: [0.23, 1, 0.32, 1] } }) };

  if (isConnecting) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-4 border-[--color-accent-blue] border-t-transparent rounded-full"
        />
        <p className="text-sm font-bold uppercase tracking-widest text-[--color-text-tertiary] animate-pulse">
          Establishing Live Stream...
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col gap-6 mx-auto w-full max-w-6xl"
    >
      <ConfirmationModal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirm={handleClear}
        title="Clear Request Logs"
        message="Are you sure you want to permanently clear all request activity logs? This action cannot be undone."
      />
      {/* Header */}
      <motion.header
        custom={0} variants={fadeUp} initial="hidden" animate="visible"
        className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5"
      >
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-[--color-text-tertiary]">Live Stream</p>
          <h1
            className="text-3xl font-black tracking-tight text-[--color-text-primary]"
          >
            Request Activity
          </h1>
          <p className="mt-2 text-sm font-medium text-[--color-text-secondary]">
            Real-time monitoring of all API traffic through the proxy instance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setViewMode(v => v === 'table' ? 'console' : 'table')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-secondary)' }}
          >
            {viewMode === 'table' ? <TerminalIcon size={14} /> : <Table size={14} />} 
            {viewMode === 'table' ? 'Console View' : 'Table View'}
          </button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setIsClearModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,113,133,0.1)'; e.currentTarget.style.borderColor = 'rgba(251,113,133,0.3)'; e.currentTarget.style.color = '#fb7185'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
          >
            <Trash2 size={14} /> Clear
          </motion.button>
        </div>
      </motion.header>

      {/* Filter bar */}
      <motion.section
        custom={1} variants={fadeUp} initial="hidden" animate="visible"
        className="rounded-[--radius-lg] p-5 relative overflow-hidden"
        style={PANEL_STYLE}
      >
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[--radius-lg]" style={{ background: 'var(--gradient-neon)', opacity: 0.35 }} />
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[--color-text-tertiary]" />
            <input
              type="text"
              className="w-full min-h-[2.75rem] pl-10 pr-4 rounded-xl text-sm font-medium outline-none transition-all"
              style={{
                background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)',
                color: 'var(--color-text-primary)',
              }}
              placeholder="Search by model, path, method or status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--color-border-strong)'; }}
            />
          </div>

          {viewMode === 'console' && (
            <label className="flex items-center gap-2 cursor-pointer text-xs font-black uppercase text-[--color-text-tertiary]">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              Auto-Scroll
            </label>
          )}

          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest"
            style={
              connected
                ? { background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }
                : { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-border)', color: 'var(--color-danger)' }
            }
          >
            {connected ? <Wifi size={12} className="animate-pulse" /> : <WifiOff size={12} />}
            {connected ? 'Live connected' : 'System Offline'}
          </div>

          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest"
            style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-tertiary)' }}
          >
            {filtered.length} entries
          </div>

          <label className="relative ml-auto">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="min-h-[2.5rem] appearance-none rounded-xl pl-4 pr-10 text-xs font-black uppercase tracking-widest outline-none transition-all"
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-strong)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size} / page</option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-tertiary]" />
          </label>
        </div>
      </motion.section>

      {/* Content Area */}
      <motion.section
        custom={2} variants={fadeUp} initial="hidden" animate="visible"
        className="rounded-[--radius-lg] overflow-hidden relative"
        style={PANEL_STYLE}
      >
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[--radius-lg]" style={{ background: 'var(--gradient-neon)', opacity: 0.35 }} />
        {viewMode === 'table' ? (
            <LogTable logs={paginatedLogs} loading={loading} />
        ) : (
            <LiveConsole logs={paginatedLogs} autoScroll={autoScroll} />
        )}
      </motion.section>

      {!loading && filtered.length > 0 && (
        <motion.nav
          custom={3} variants={fadeUp} initial="hidden" animate="visible"
          className="flex flex-col gap-3 rounded-[--radius-lg] p-4 sm:flex-row sm:items-center sm:justify-between"
          style={PANEL_STYLE}
          aria-label="Logs pagination"
        >
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-[--color-text-tertiary]">
            Showing <span className="text-[--color-text-secondary]">{pageStart.toLocaleString()}</span>
            {' '}to <span className="text-[--color-text-secondary]">{pageEnd.toLocaleString()}</span>
            {' '}of <span className="text-[--color-text-secondary]">{filtered.length.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-2">
            {[
              { label: 'First page', icon: ChevronsLeft, disabled: safePage === 1, onClick: () => goToPage(1) },
              { label: 'Previous page', icon: ChevronLeft, disabled: safePage === 1, onClick: () => goToPage(safePage - 1) },
            ].map(({ label, icon: Icon, disabled, onClick }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                disabled={disabled}
                onClick={onClick}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-35"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
              >
                <Icon size={16} />
              </button>
            ))}

            <div
              className="inline-flex h-10 min-w-[7.5rem] items-center justify-center rounded-xl px-4 text-xs font-black uppercase tracking-widest"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)', color: '#a5b4fc' }}
            >
              {safePage} / {pageCount}
            </div>

            {[
              { label: 'Next page', icon: ChevronRight, disabled: safePage === pageCount, onClick: () => goToPage(safePage + 1) },
              { label: 'Last page', icon: ChevronsRight, disabled: safePage === pageCount, onClick: () => goToPage(pageCount) },
            ].map(({ label, icon: Icon, disabled, onClick }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                disabled={disabled}
                onClick={onClick}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-35"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </motion.nav>
      )}
    </motion.div>
  );
};

export default Logs;
