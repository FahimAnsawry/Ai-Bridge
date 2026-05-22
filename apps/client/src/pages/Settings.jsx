import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Globe, ChevronDown, ChevronUp, ExternalLink, GitBranch, XCircle, Loader2, Copy, LogOut, Route, ArrowUp, ArrowDown, Check, Eye, EyeOff, KeyRound, Link2, Sparkles, Compass, Cpu, Zap, Network, Edit, Brain, Wand2, Orbit, Bot, Atom, Database, Layers, Terminal, Server, Activity, Workflow, Infinity } from 'lucide-react';
import {
  fetchConfig,
  saveConfig,
  fetchCopilotAuthStatus,
  startCopilotDeviceFlow,
  pollCopilotDeviceFlow,
  logoutCopilot,
} from '../api';
import { queryKeys } from '../api/queryKeys';
import { useToast } from '../context/ToastContext';
import SettingsSkeleton from '../components/settings/SettingsSkeleton';

const DEFAULT_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2-Codex' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4-6' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4-7' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4-6' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'Deepseek-ai/Deepseek-v4-pro' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B' },
  { id: 'gemini-3.1-pro', name: 'gemini-3.1-pro' },
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'glm-5.1', name: 'GLM 5.1' },
  { id: 'grok-code-fast-1', name: 'Grok Code Fast 1' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7' },
  { id: 'qwen3.5-397b-a17b', name: 'qwen3.5-397b-a17b' },
  { id: 'qwen3.5-122b-a10b', name: 'Qwen3.5 122B' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus' },
  { id: 'qwen3.6-plus-thinking', name: 'Qwen3.6 Plus Thinking' },
  { id: 'qwen3.6-max-preview', name: 'Qwen3.6 Max Preview' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
  { id: 'gpt-5.5', name: 'GPT-5.5' }
];

const GLASS_STYLE = {
  background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
  backdropFilter: 'blur(22px)',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
};

const SETTINGS_CARD_THEMES = {
  activeModel: {
    background: 'linear-gradient(135deg, #172554 0%, #312e81 52%, #1e1b4b 100%)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 48px rgba(15,23,42,0.45)',
  },
  todayTokens: {
    background: 'linear-gradient(135deg, #064e3b 0%, #115e59 48%, #164e63 100%)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 48px rgba(6,78,59,0.4)',
  },
  addProvider: {
    background: 'linear-gradient(145deg, #08111f 0%, #172554 48%, #0c4a6e 100%)',
    border: '1px solid rgba(125,211,252,0.34)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 24px 64px rgba(2,6,23,0.58), 0 0 42px rgba(56,189,248,0.16)',
  },
  editProvider: {
    background: 'linear-gradient(145deg, #06141f 0%, #0f2f36 46%, #111827 100%)',
    border: '1px solid rgba(167,243,208,0.28)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 24px 64px rgba(2,6,23,0.58), 0 0 42px rgba(20,184,166,0.14)',
  },
};

const SOFT_PANEL = 'rounded-2xl border border-white/20 bg-slate-950/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]';
const SETTINGS_LABEL = 'text-[10px] font-extrabold uppercase tracking-[0.2em] text-white';
const FIELD_CLASS = 'w-full rounded-xl border border-white/25 bg-slate-950/45 px-3.5 py-3 text-sm font-semibold text-white placeholder:text-white/68 outline-none [color-scheme:dark] focus:border-white/55 focus:bg-slate-950/60 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:py-2.5 sm:text-xs';
const KEY_PREVIEW_CLASS = 'min-h-10 flex-1 rounded-xl border border-white/30 bg-slate-950/60 px-4 py-2.5 font-mono text-xs font-extrabold tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]';
const ICON_BUTTON = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-slate-950/35 text-white/85 hover:bg-slate-950/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10';
const REMOVE_KEY_BUTTON = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-300/35 bg-rose-950/35 text-rose-100 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer';
const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/30 bg-slate-950/35 px-4 py-3 text-[11px] font-extrabold uppercase tracking-wider text-white hover:bg-slate-950/50 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 sm:py-2.5';
const SECONDARY_BUTTON = 'rounded-xl border border-white/25 bg-slate-950/30 px-4 py-2.5 text-xs font-extrabold text-white/85 hover:bg-slate-950/45 hover:text-white';
const ROUTES_BUTTON = 'inline-flex items-center gap-1.5 rounded-full border border-cyan-200/45 bg-cyan-300/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-50 shadow-[0_0_18px_-8px_rgba(34,211,238,0.95)] hover:border-cyan-100/70 hover:bg-cyan-300/25 hover:text-white hover:shadow-[0_0_24px_-7px_rgba(45,212,191,1)] transition-all';
const FALLBACK_SELECT = 'w-full appearance-none rounded-xl border border-cyan-200/40 bg-cyan-950/55 px-3.5 py-2.5 pr-9 text-[10px] font-extrabold uppercase tracking-[0.12em] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(8,47,73,0.22)] [color-scheme:dark] hover:border-cyan-100/60 hover:bg-cyan-900/60 focus:border-cyan-100 focus:bg-cyan-950/70 focus:outline-none';
const FALLBACK_OPTION = 'bg-cyan-950 text-cyan-50';

// ── GitHub Copilot Auth Card ───────────────────────────────────────────────────
function CopilotAuthCard({
  setIsModalOpen,
}) {
  const statusQuery = useQuery({
    queryKey: queryKeys.copilotAuthStatus(),
    queryFn: fetchCopilotAuthStatus,
    staleTime: 15_000,
  });

  const status = statusQuery.data;
  const loading = statusQuery.isPending;
  const isConnected = status?.hasToken;
  const isAuthed = status?.authenticated;

  if (loading) return (
    <div className="relative overflow-hidden rounded-2xl p-5 flex items-center gap-3 text-white/82 text-xs" style={GLASS_STYLE}>
      <Loader2 size={14} className="animate-spin" /> Loading Copilot status...
    </div>
  );

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40 p-4 transition-all duration-300 hover:border-white/20 hover:bg-slate-950/50 hover:shadow-[0_8px_30px_rgba(99,102,241,0.04)]">
      <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 60%)' }} />
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 shadow-[0_0_8px_rgba(99,102,241,0.08)] mt-0.5">
            <GitBranch size={15} className={isConnected ? 'text-indigo-300' : 'text-white/70'} />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-xs font-bold text-white tracking-tight">GitHub Copilot</h3>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                isConnected 
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.08)]' 
                  : isAuthed 
                    ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' 
                    : 'bg-white/5 text-white/50 border border-white/10'
              }`}>
                {isConnected ? 'Connected' : isAuthed ? 'Authorized' : 'Not Connected'}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className={`inline-flex items-center gap-1.5 rounded-xl border ${
              isConnected 
                ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/50' 
                : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
            } text-[10px] font-bold uppercase tracking-wider px-4 py-2 transition-all cursor-pointer`}
          >
            {isConnected ? <Edit size={12} /> : <GitBranch size={12} />}
            {isConnected ? 'Manage Connection' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopilotModal({
  isOpen,
  setIsOpen,
  onConnected,
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [flowState, setFlowState] = useState(null);   // active device flow info
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef(null);
  
  const statusQuery = useQuery({
    queryKey: queryKeys.copilotAuthStatus(),
    queryFn: fetchCopilotAuthStatus,
    staleTime: 15_000,
  });
  
  const startFlowMutation = useMutation({ mutationFn: startCopilotDeviceFlow });
  const pollFlowMutation = useMutation({ mutationFn: pollCopilotDeviceFlow });
  const logoutMutation = useMutation({
    mutationFn: logoutCopilot,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.copilotAuthStatus() }),
  });

  useEffect(() => {
    return () => clearTimeout(pollTimer.current);
  }, []);

  const stopPolling = () => {
    clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setPolling(false);
  };

  const finalizeConnected = async () => {
    await onConnected?.();
    showToast('GitHub Copilot connected!', 'success');
    await queryClient.invalidateQueries({ queryKey: queryKeys.copilotAuthStatus() });
  };

  const handleDevicePollResult = async (poll, fallbackIntervalSeconds) => {
    if (!poll) return fallbackIntervalSeconds;

    if (poll.status === 'success') {
      stopPolling();
      setFlowState(null);
      await finalizeConnected();
      return null;
    }

    if (poll.status === 'token_error') {
      stopPolling();
      setFlowState(null);
      showToast(`Copilot token error: ${poll.error || 'GitHub authorization succeeded, but Copilot token exchange failed.'}`, 'error');
      queryClient.invalidateQueries({ queryKey: queryKeys.copilotAuthStatus() });
      return null;
    }

    if (poll.status === 'expired') {
      stopPolling();
      setFlowState(null);
      showToast('Device code expired. Please try again.', 'error');
      return null;
    }

    if (poll.success === false && poll.error) {
      stopPolling();
      setFlowState(null);
      showToast(`Auth error: ${poll.error}`, 'error');
      return null;
    }

    if (poll.success === true && !poll.status) {
      stopPolling();
      setFlowState(null);
      await finalizeConnected();
      return null;
    }

    if (poll.status === 'slow_down') {
      return poll.interval || fallbackIntervalSeconds + 5;
    }

    return fallbackIntervalSeconds;
  };

  const schedulePoll = (intervalSeconds = 5) => {
    clearTimeout(pollTimer.current);
    setPolling(true);
    pollTimer.current = setTimeout(async () => {
      const poll = await pollFlowMutation.mutateAsync().catch(() => null);
      const nextInterval = await handleDevicePollResult(poll, intervalSeconds);
      if (nextInterval) schedulePoll(nextInterval);
    }, intervalSeconds * 1000);
  };

  const startFlow = async () => {
    try {
      const res = await startFlowMutation.mutateAsync();
      if (!res.success) throw new Error(res.error || 'Failed to start Device Flow');
      setFlowState(res);
      window.open(res.verificationUri, '_blank', 'noopener');
      schedulePoll(res.interval || 5);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    stopPolling();
    setFlowState(null);
    showToast('Copilot disconnected.', 'success');
  };

  const copyCode = () => {
    if (!flowState?.userCode) return;
    navigator.clipboard.writeText(flowState.userCode);
    showToast('Code copied!', 'success');
  };

  const status = statusQuery.data;
  const submitting = startFlowMutation.isPending;
  const isConnected = status?.hasToken;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          transition={{ duration: 0.15, ease: 'easeOut' }} 
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsOpen(false);
              if (flowState) { stopPolling(); setFlowState(null); }
            }
          }}
        >
          <motion.div 
            initial={{ scale: 0.97, opacity: 0, y: 8 }} 
            animate={{ scale: 1, opacity: 1, y: 0 }} 
            exit={{ scale: 0.97, opacity: 0, y: 4 }} 
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} 
            className="relative w-full max-w-md overflow-hidden rounded-2xl p-6 space-y-6 max-h-[90vh] flex flex-col" 
            style={{
              background: 'linear-gradient(145deg, #090622 0%, #17153a 48%, #1f1a4a 100%)',
              border: '1px solid rgba(129,140,248,0.25)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 24px 64px rgba(2,6,23,0.58), 0 0 42px rgba(99,102,241,0.14)',
            }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(255,255,255,0.03) 35%, rgba(255,255,255,0) 65%)' }} />
            
            <div className="relative z-10 flex items-center justify-between gap-4 shrink-0 border-b border-white/15 pb-4">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-indigo-200">GitHub Copilot</p>
                <h2 className="mt-1 text-xl font-extrabold text-white">Connection Settings</h2>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setIsOpen(false);
                  if (flowState) { stopPolling(); setFlowState(null); }
                }} 
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-slate-950/35 text-white/80 hover:bg-slate-950/55 hover:text-white cursor-pointer"
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="relative z-10 space-y-4 overflow-y-auto custom-scrollbar pr-1 flex-1 min-h-0">
              {/* Connected state */}
              {isConnected && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/30 p-4 space-y-3">
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-wider">
                        Automatic token refresh active
                      </span>
                    </div>
                    {status?.tokenExpiry && (
                      <p className="text-[10px] text-white/50 font-medium">
                        Expires: {new Date(status.tokenExpiry).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await handleLogout();
                        setIsOpen(false);
                      }}
                      className="flex items-center justify-center gap-2 w-full py-3 border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 hover:border-rose-500/40 text-[10px] text-rose-300 font-extrabold uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                    >
                      <LogOut size={12} /> Disconnect Account
                    </button>
                  </div>
                </div>
              )}

              {/* Not connected state */}
              {!isConnected && !flowState && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4 space-y-4">
                  <p className="text-[11px] text-white/70 leading-relaxed">
                    To connect your GitHub Copilot subscription, click the button below. This will initiate the GitHub Device Flow. You will be provided with a verification code to authorize the application on GitHub.
                  </p>
                  <button
                    type="button"
                    id="copilot-device-flow-btn"
                    onClick={startFlow}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 w-full py-3 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-500/50 text-[10px] font-extrabold uppercase tracking-wider text-indigo-200 rounded-xl cursor-pointer disabled:opacity-50 transition-all"
                  >
                    {submitting ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
                    Connect Account
                  </button>
                </div>
              )}

              {/* Active Device Flow polling state */}
              {flowState && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-indigo-500/20 bg-slate-950/40 p-4 space-y-4">
                    <div className="flex items-center gap-2 text-indigo-300 text-[11px] font-bold uppercase tracking-wider">
                      <Loader2 size={12} className="animate-spin text-cyan-300" />
                      Waiting for Authorization
                    </div>
                    <div className="space-y-2">
                      <p className="text-[9px] text-white/55 uppercase tracking-widest font-extrabold">Verification Code</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 font-mono text-xl font-extrabold text-white tracking-[0.25em] text-center shadow-[inset_0_1px_5px_rgba(0,0,0,0.3)]">
                          {flowState.userCode}
                        </div>
                        <button 
                          type="button" 
                          onClick={copyCode} 
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
                          title="Copy code"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                    
                    <a
                      href={flowState.verificationUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 border border-indigo-500/30 bg-indigo-500/10 text-indigo-200 text-[10px] font-extrabold uppercase tracking-wider rounded-xl hover:bg-indigo-500/20 hover:text-white transition-all shadow-[0_2px_10px_-4px_rgba(99,102,241,0.2)]"
                    >
                      <ExternalLink size={12} />
                      Open GitHub Auth Portal
                    </a>
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => { stopPolling(); setFlowState(null); }}
                      className="text-[10px] text-white/55 hover:text-white/80 font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      Cancel Connection
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const uid = () => Math.random().toString(36).slice(2, 10);

const mapConfigToForm = (cfg = {}, accessKey = '') => ({
  local_api_key: cfg.local_api_key || accessKey || '',
  active_provider_id: cfg.active_provider_id || '',
  model_routing: cfg.model_routing && typeof cfg.model_routing === 'object' && !Array.isArray(cfg.model_routing) ? cfg.model_routing : {},
  providers: cfg.providers || [],
  port: cfg.port || 3000,
  token_optimization_enabled: cfg.token_optimization_enabled === true,
  prompt_budget_tokens: cfg.prompt_budget_tokens || 0,
  token_summarization_enabled: cfg.token_summarization_enabled === true,
  response_cache_enabled: cfg.response_cache_enabled === true,
  response_cache_ttl_seconds: cfg.response_cache_ttl_seconds || 30,
});

const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const getProviderBadge = (name) => {
  const lowercaseName = (name || '').toLowerCase();
  
  if (lowercaseName.includes('openai')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-emerald-500/12 to-teal-500/12 border-emerald-500/20">
        <Brain size={15} className="text-emerald-300/80" />
      </div>
    );
  }
  if (lowercaseName.includes('anthropic') || lowercaseName.includes('claude')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-amber-500/12 to-orange-500/12 border-amber-500/20">
        <Wand2 size={15} className="text-amber-300/80" />
      </div>
    );
  }
  if (lowercaseName.includes('gemini') || lowercaseName.includes('google')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-blue-500/12 to-cyan-500/12 border-blue-500/20">
        <Orbit size={15} className="text-blue-300/80" />
      </div>
    );
  }
  if (lowercaseName.includes('deepseek')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-cyan-500/12 to-blue-500/12 border-cyan-500/20">
        <Compass size={15} className="text-cyan-300/80" />
      </div>
    );
  }
  if (lowercaseName.includes('groq')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-orange-500/12 to-red-500/12 border-orange-500/20">
        <Zap size={15} className="text-orange-300/80" />
      </div>
    );
  }
  if (lowercaseName.includes('openrouter')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-purple-500/12 to-pink-500/12 border-purple-500/20">
        <Network size={15} className="text-purple-300/80" />
      </div>
    );
  }
  if (lowercaseName.includes('github') || lowercaseName.includes('copilot')) {
    return (
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br from-slate-500/12 to-slate-700/12 border-slate-500/20">
        <Bot size={15} className="text-slate-300/80" />
      </div>
    );
  }

  // Futuristic presets for custom/other providers
  const customPresets = [
    {
      gradient: 'from-fuchsia-500/12 to-purple-500/12 border-fuchsia-500/20',
      icon: <Atom size={15} className="text-fuchsia-300/80" />
    },
    {
      gradient: 'from-cyan-500/12 to-blue-500/12 border-cyan-500/20',
      icon: <Database size={15} className="text-cyan-300/80" />
    },
    {
      gradient: 'from-pink-500/12 to-rose-500/12 border-pink-500/20',
      icon: <Layers size={15} className="text-pink-300/80" />
    },
    {
      gradient: 'from-emerald-500/12 to-green-500/12 border-emerald-500/20',
      icon: <Terminal size={15} className="text-emerald-300/80" />
    },
    {
      gradient: 'from-rose-500/12 to-red-500/12 border-rose-500/20',
      icon: <Server size={15} className="text-rose-300/80" />
    },
    {
      gradient: 'from-teal-500/12 to-emerald-500/12 border-teal-500/20',
      icon: <Activity size={15} className="text-teal-300/80" />
    },
    {
      gradient: 'from-indigo-500/12 to-blue-500/12 border-indigo-500/20',
      icon: <Workflow size={15} className="text-indigo-300/80" />
    },
    {
      gradient: 'from-violet-500/12 to-purple-500/12 border-violet-500/20',
      icon: <Infinity size={15} className="text-violet-300/80" />
    }
  ];

  const index = hashCode(name || 'custom') % customPresets.length;
  const preset = customPresets[index];

  return (
    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br ${preset.gradient}`}>
      {preset.icon}
    </div>
  );
};

// Memoized ProviderCard component to prevent unnecessary re-renders
const ProviderCard = React.memo(({ provider, onEdit, onRoute, onRemove }) => {
  return (
    <div className="group relative rounded-sm border border-white/15 bg-slate-950/40 p-4 transition-colors duration-200 hover:border-white/35 hover:bg-slate-950/55 flex flex-col gap-3.5">
      <div className="relative flex items-center gap-2.5">
        <div className="relative shrink-0">
          {getProviderBadge(provider.name)}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h4 className="font-bold text-white tracking-tight text-sm truncate leading-tight">{provider.name || 'Unnamed Provider'}</h4>
          <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" title="Active" />
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(provider.id); }}
          className="shrink-0 font-mono text-[12px] font-extrabold leading-none text-rose-300/70 hover:text-rose-200 transition-colors cursor-pointer sm:opacity-0 sm:group-hover:opacity-100"
          title="Remove Provider"
        >
          [&times;]
        </button>
      </div>

      <div className="relative mt-auto grid grid-cols-2 overflow-hidden rounded-sm border border-white/20">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(provider.id); }}
          className="inline-flex h-9 items-center justify-center gap-1.5 border-r border-white/20 bg-slate-950/35 font-mono text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/85 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          <Edit size={11} className="text-white/55" />
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRoute(provider.id); }}
          className="inline-flex h-9 items-center justify-center gap-1.5 bg-cyan-950/30 font-mono text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-100 hover:bg-cyan-900/45 hover:text-white transition-colors cursor-pointer"
        >
          <Route size={11} className="text-cyan-300" />
          Routes
        </button>
      </div>
    </div>
  );
});

ProviderCard.displayName = 'ProviderCard';

const Input = ({ label, type = 'text', className = '', ...props }) => {
  const [show, setShow] = React.useState(false);
  const isPassword = type === 'password';
  return (
    <div className="space-y-2">
      {label && <label className={SETTINGS_LABEL}>{label}</label>}
      <div className="relative group">
        <input {...props} type={isPassword ? (show ? 'text' : 'password') : type} className={`${FIELD_CLASS} cursor-text pr-10 font-mono ${className}`} />
        {isPassword && (
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 z-10 text-white/45 hover:text-white">
            {show ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        )}
      </div>
    </div>
  );
};

const Card = ({ children, className = '', style = GLASS_STYLE }) => (
  <div className={`relative overflow-hidden rounded-2xl p-6 ${className}`} style={style}>
    <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 55%)' }} />
    <div className="relative z-10 flex h-full min-h-0 flex-col">
    {children}
    </div>
  </div>
);

const ApiConfigCard = ({ baseUrl, accessKey, onCopy }) => {
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const hasAccessKey = Boolean(accessKey);

  const copyValue = (field, value) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    onCopy?.(`${field === 'baseUrl' ? 'Base URL' : 'Access key'} copied.`);
    setTimeout(() => setCopiedField(null), 1800);
  };

  return (
    <Card className="flex flex-col min-h-0 lg:h-full p-4 sm:p-5 lg:p-6 lg:overflow-hidden h-auto" style={SETTINGS_CARD_THEMES.todayTokens}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-4 -right-4 h-36 w-36 opacity-50"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1.2px)',
          backgroundSize: '10px 10px',
          WebkitMaskImage: 'radial-gradient(circle at top right, rgba(0,0,0,0.9), transparent 70%)',
          maskImage: 'radial-gradient(circle at top right, rgba(0,0,0,0.9), transparent 70%)',
        }}
      />

      <header className="shrink-0 flex items-start justify-between gap-4 border-b border-white/15 pb-4 sm:pb-5">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-emerald-200/85">
            01 · Local Gateway
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
            <KeyRound className="text-emerald-200/90" size={20} />
            Gateway Credentials
          </h2>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.2em] ${
            hasAccessKey
              ? 'text-emerald-100 bg-emerald-500/12 border-emerald-200/40'
              : 'text-amber-100 bg-amber-500/12 border-amber-200/40'
          }`}
        >
          {hasAccessKey ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/70" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-200" />
              </span>
              Live
            </>
          ) : (
            <>
              <span className="inline-block h-1.5 w-1.5 rounded-full border border-amber-200/80" />
              Awaiting Key
            </>
          )}
        </span>
      </header>

      <div className="mt-4 flex-1 min-h-0 lg:overflow-y-auto custom-scrollbar space-y-3 sm:mt-5 sm:space-y-4 sm:pr-1">
        <section className={`${SOFT_PANEL} relative p-3.5 sm:p-4`}>
          <span className="absolute right-3 top-3 font-mono text-[10px] font-bold tracking-[0.18em] text-white/35">
            01
          </span>
          <div className="flex items-center gap-2 pr-7">
            <span className={SETTINGS_LABEL}>Base URL</span>
            <span className="hidden sm:inline-flex items-center rounded-full border border-emerald-200/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/90">
              POST · /v1/messages
            </span>
          </div>
          <div className="mt-1 mb-3 h-px w-full border-b border-dashed border-white/12" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1 rounded-xl border border-white/25 bg-slate-950/55 px-3 py-2.5 font-mono text-[11px] font-semibold leading-5 text-white break-all sm:text-xs">
              <Link2 size={12} className="absolute left-3 top-3 text-emerald-200/60" />
              <span className="block pl-5">{baseUrl}</span>
            </div>
            <button
              type="button"
              onClick={() => copyValue('baseUrl', baseUrl)}
              className={`${ICON_BUTTON} w-full sm:w-11`}
              title="Copy base URL"
            >
              {copiedField === 'baseUrl' ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </section>

        <section className={`${SOFT_PANEL} relative p-3.5 sm:p-4`}>
          <span className="absolute right-3 top-3 font-mono text-[10px] font-bold tracking-[0.18em] text-white/35">
            02
          </span>
          <div className="flex items-center gap-2 pr-7">
            <span className={SETTINGS_LABEL}>Access Key</span>
          </div>
          <div className="mt-1 mb-3 h-px w-full border-b border-dashed border-white/12" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className={`relative min-w-0 flex-1 rounded-xl border border-white/25 bg-slate-950/55 px-3 py-2.5 font-mono text-[11px] leading-5 break-all sm:text-xs ${hasAccessKey ? 'font-semibold text-white' : 'font-semibold text-white/70'}`}>
              <KeyRound size={12} className="absolute left-3 top-3 text-cyan-200/60" />
              <span className="block pl-5">
                {hasAccessKey ? (isKeyVisible ? accessKey : '••••••••••••••••••••••••') : 'No access key available'}
              </span>
            </div>
            <div className="flex gap-2 sm:contents">
              <button
                type="button"
                onClick={() => setIsKeyVisible((value) => !value)}
                disabled={!hasAccessKey}
                className={`${ICON_BUTTON} flex-1 sm:flex-none sm:w-11`}
                title={isKeyVisible ? 'Hide access key' : 'Show access key'}
              >
                {isKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button
                type="button"
                onClick={() => copyValue('accessKey', accessKey)}
                disabled={!hasAccessKey}
                className={`${ICON_BUTTON} flex-1 sm:flex-none sm:w-11`}
                title="Copy access key"
              >
                {copiedField === 'accessKey' ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </div>
          {!hasAccessKey && (
            <p className="mt-2 text-[10px] font-medium leading-snug text-amber-200/85">
              Generate an access key from the dashboard before using the local gateway.
            </p>
          )}
        </section>
      </div>
    </Card>
  );
};

const Settings = ({ user: initialUser, onModalVisibilityChange }) => {
  const [form, setForm] = useState({
    local_api_key: '',
    active_provider_id: '',
    model_routing: {},
    providers: [],
    port: 3000,
    token_optimization_enabled: false,
    prompt_budget_tokens: 0,
    token_summarization_enabled: false,
    response_cache_enabled: false,
    response_cache_ttl_seconds: 30,
  });
  const [expandedIds, setExpandedIds] = useState({});
  const [editingProviderId, setEditingProviderId] = useState(null);
  const [activeRouteProviderId, setActiveRouteProviderId] = useState(null);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const modelDropdownRef = useRef(null);
  const hasHydratedConfig = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' });
  const providerListRef = useRef(null);
  const [providerScrollState, setProviderScrollState] = useState({ top: false, bottom: false });
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: queryKeys.config(),
    queryFn: fetchConfig,
    staleTime: 60_000,
  });
  const saveConfigMutation = useMutation({
    mutationFn: saveConfig,
    onSuccess: (data, updates) => {
      queryClient.setQueryData(queryKeys.config(), (current = {}) => ({
        ...current,
        ...updates,
        ...(data && typeof data === 'object' ? data : {}),
      }));
    },
  });

  const isFreeModelProviderRecord = (provider) => {
    const value = `${provider?.id || ''} ${provider?.name || ''} ${provider?.baseUrl || ''}`.toLowerCase();
    return value.includes('freemodel') || value.includes('freemodel.dev');
  };

  const isFreeModelPlaceholderKey = (key) => String(key || '').trim().toLowerCase() === 'freemodel';

  const getProviderKeys = (provider) => {
    if (Array.isArray(provider?.apiKeys) && provider.apiKeys.length > 0) return provider.apiKeys;
    return provider?.apiKey ? [provider.apiKey] : [];
  };

  const validateProvidersForSave = (providers) => {
    const freeModel = (providers || []).find(isFreeModelProviderRecord);
    if (!freeModel) return '';

    const keys = getProviderKeys(freeModel).map((key) => String(key || '').trim()).filter(Boolean);
    if (keys.length === 0) {
      return 'FreeModel needs a real API key before requests can be sent. Get one at freemodel.dev → API Keys.';
    }
    if (keys.some(isFreeModelPlaceholderKey)) {
      return 'FreeModel API key cannot be the placeholder "freemodel". Paste a real key.';
    }
    return '';
  };

  const persistConfigChange = async (updates, options = {}) => {
    const providersToValidate = updates.providers || (updates.replace_providers ? [] : null);
    const validationError = providersToValidate ? validateProvidersForSave(providersToValidate) : '';
    if (validationError) {
      setSaveStatus({ state: 'error', message: validationError });
      showToast(validationError, 'error');
      return false;
    }

    setSaveStatus({ state: 'saving', message: 'Saving changes...' });
    try {
      await saveConfigMutation.mutateAsync(updates);
      setSaveStatus({ state: 'saved', message: 'Saved' });
      if (options.successMessage) showToast(options.successMessage, 'success');
      return true;
    } catch (err) {
      const message = err.message || 'Failed to save settings.';
      setSaveStatus({ state: 'error', message });
      showToast(message, 'error');
      return false;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const updateProviderScrollState = () => {
    const el = providerListRef.current;
    if (!el) return;
    const hasOverflow = el.scrollHeight > el.clientHeight + 1;
    setProviderScrollState({
      top: hasOverflow && el.scrollTop > 4,
      bottom: hasOverflow && el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    });
  };

  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS);

  useEffect(() => {
    if (!configQuery.data || hasHydratedConfig.current) return;
    hasHydratedConfig.current = true;
    setForm(mapConfigToForm(configQuery.data, initialUser?.accessKey));
    setAvailableModels(DEFAULT_MODELS);
    setExpandedIds({});
  }, [configQuery.data, initialUser?.accessKey]);

  useEffect(() => {
    // Only update scroll state when provider count changes, not on every state change
    requestAnimationFrame(updateProviderScrollState);
  }, [form.providers.length]);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await persistConfigChange(form, { successMessage: 'Settings saved.' });
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isCopilotModalOpen, setIsCopilotModalOpen] = React.useState(false);
  const [newProviderForm, setNewProviderForm] = React.useState({ name: '', baseUrl: '', apiKey: '' });

  useEffect(() => {
    onModalVisibilityChange?.(Boolean(isAddModalOpen || editingProviderId || activeRouteProviderId || isCopilotModalOpen));
  }, [activeRouteProviderId, editingProviderId, isAddModalOpen, isCopilotModalOpen, onModalVisibilityChange]);

  useEffect(() => () => onModalVisibilityChange?.(false), [onModalVisibilityChange]);

  const normalizeBaseUrl = (value) => String(value || '').replace(/\/+$/, '');
  const getModelRouting = (routing = form.model_routing) => (
    routing && typeof routing === 'object' && !Array.isArray(routing) ? routing : {}
  );
  // All configured providers are available for model routes
  const routeProviders = form.providers;
  const getRouteProviders = (routeValue) => {
    if (typeof routeValue === 'string') {
      const target = routeValue.trim();
      return target ? [{ target, priority: 1 }] : [];
    }

    if (!routeValue || typeof routeValue !== 'object' || !Array.isArray(routeValue.providers)) return [];

    return routeValue.providers
      .map((entry, index) => {
        if (typeof entry === 'string') {
          const target = entry.trim();
          return target ? { target, priority: index + 1, index } : null;
        }

        if (!entry || typeof entry !== 'object') return null;
        const target = String(entry.target || entry.providerId || entry.baseUrl || '').trim();
        if (!target) return null;
        const parsedPriority = Number(entry.priority);
        return {
          target,
          priority: Number.isFinite(parsedPriority) && parsedPriority > 0 ? parsedPriority : index + 1,
          index,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .map(({ target }, index) => ({ target, priority: index + 1 }));
  };
  const routeTargetsForValue = (routeValue) => getRouteProviders(routeValue).map((entry) => entry.target);
  const serializeRouteProviders = (providers) => {
    const seen = new Set();
    const clean = (providers || [])
      .map((entry) => String(entry.target || '').trim())
      .filter((target) => {
        if (!target || seen.has(target)) return false;
        seen.add(target);
        return true;
      });

    if (clean.length === 0) return null;
    if (clean.length === 1) return clean[0];
    return { providers: clean.map((target, index) => ({ target, priority: index + 1 })) };
  };
  const routeIncludesProvider = (routeValue, providerId) => routeTargetsForValue(routeValue).includes(providerId);
  const getProviderForRouteTarget = (target) => {
    const found = routeProviders.find(
      (provider) => provider.id === target || (provider.baseUrl && normalizeBaseUrl(provider.baseUrl) === normalizeBaseUrl(target)) || provider.name === target
    );
    if (found) return found;
    return { id: target, name: target, baseUrl: '', apiKey: '', isActive: false };
  };
  const saveModelRouting = (routing) => {
    const cleanRouting = Object.entries(routing).reduce((acc, [model, routeValue]) => {
      const key = String(model || '').trim();
      const route = serializeRouteProviders(getRouteProviders(routeValue));
      if (key && route) acc[key] = route;
      return acc;
    }, {});

    setForm(prev => ({ ...prev, model_routing: cleanRouting }));
    void persistConfigChange({ model_routing: cleanRouting });
  };
  const updateModelRouteProvider = (model, providerId) => {
    saveModelRouting({ ...getModelRouting(), [model]: providerId });
  };
  const updateModelRouteProviders = (model, providers) => {
    const route = serializeRouteProviders(providers);
    if (!route) return removeModelRoute(model);
    saveModelRouting({ ...getModelRouting(), [model]: route });
  };
  const addFallbackProvider = (model, providerId) => {
    const providers = getRouteProviders(getModelRouting()[model]);
    if (providers.some((entry) => entry.target === providerId)) {
      showToast('That provider is already in this route.', 'error');
      return;
    }
    updateModelRouteProviders(model, [...providers, { target: providerId }]);
  };
  const removeRouteProvider = (model, target) => {
    updateModelRouteProviders(model, getRouteProviders(getModelRouting()[model]).filter((entry) => entry.target !== target));
  };
  const moveRouteProvider = (model, target, direction) => {
    const providers = getRouteProviders(getModelRouting()[model]);
    const index = providers.findIndex((entry) => entry.target === target);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= providers.length) return;
    const next = [...providers];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateModelRouteProviders(model, next);
  };
  const updateModelRouteKey = (oldModel, nextModel) => {
    const model = nextModel.trim();
    if (!model || model === oldModel) return model || oldModel;
    const routing = getModelRouting();
    if (routing[model] !== undefined) {
      showToast('A route for that model already exists.', 'error');
      return oldModel;
    }
    const nextRouting = { ...routing };
    nextRouting[model] = nextRouting[oldModel];
    delete nextRouting[oldModel];
    saveModelRouting(nextRouting);
    return model;
  };
  const removeModelRoute = (model) => {
    const nextRouting = { ...getModelRouting() };
    delete nextRouting[model];
    saveModelRouting(nextRouting);
  };

  const handleAddProvider = async () => {
    if (!newProviderForm.name || !newProviderForm.baseUrl || !newProviderForm.apiKey) {
      showToast('All fields are required.', 'error');
      return;
    }
    const id = uid();
    // New providers are created with isActive: true so they're immediately available
    const newP = { id, ...newProviderForm, apiKeys: [newProviderForm.apiKey], isActive: true };
    const next = { ...form, providers: [...form.providers, newP] };
    const saved = await persistConfigChange({ providers: next.providers }, { successMessage: 'Provider saved.' });
    if (!saved) return;
    setForm(next);
    setExpandedIds(prev => ({ ...prev, [id]: true }));
    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setIsAddModalOpen(false);
  };

  const toggleExpand = (id) => setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));

  const updateProvider = (id, field, value) => {
    const providers = form.providers.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      if (field === 'apiKey' && (!p.apiKeys || p.apiKeys.length <= 1)) {
        updated.apiKeys = [value];
      }
      return updated;
    });
    setForm(prev => ({ ...prev, providers }));
    void persistConfigChange({ providers });
  };

  const addProviderApiKey = (id, key) => {
    if (!key) return;
    const provider = form.providers.find(p => p.id === id);
    if (provider && isFreeModelProviderRecord(provider) && isFreeModelPlaceholderKey(key)) {
      showToast('FreeModel API key cannot be the placeholder "freemodel". Paste a real key.', 'error');
      return;
    }
    const providers = form.providers.map(p => {
      if (p.id !== id) return p;
      const apiKeys = Array.isArray(p.apiKeys) ? [...p.apiKeys] : (p.apiKey ? [p.apiKey] : []);
      if (apiKeys.includes(key)) return p;
      const newKeys = [...apiKeys, key];
      return { ...p, apiKeys: newKeys, apiKey: p.apiKey || key };
    });
    setForm(prev => ({ ...prev, providers }));
    void persistConfigChange({ providers }, { successMessage: 'Provider key saved.' });
  };

  const removeProviderApiKey = (id, index) => {
    const providers = form.providers.map(p => {
      if (p.id !== id) return p;
      const apiKeys = Array.isArray(p.apiKeys) ? p.apiKeys.filter((_, i) => i !== index) : [];
      return { ...p, apiKeys, apiKey: apiKeys[0] || '' };
    });
    setForm(prev => ({ ...prev, providers }));
    void persistConfigChange({ providers }, { successMessage: 'Provider key removed.' });
  };

  const removeProvider = (id) => {
    const providers = form.providers.filter(p => p.id !== id);
    setForm(prev => ({ ...prev, providers }));
    void persistConfigChange({ providers, replace_providers: true }, { successMessage: 'Provider removed.' });
  };

  const ensureCopilotProvider = async () => {
    const apiKey = initialUser?.accessKey || form.local_api_key || '';
    if (!apiKey) {
      showToast('Bridge API key is missing. Regenerate your access key first.', 'error');
      return;
    }
    const copilotProvider = {
      id: 'copilot',
      name: 'GitHub Copilot',
      baseUrl: 'http://localhost:3000/copilot/v1',
      apiKey,
      apiKeys: apiKey ? [apiKey] : [],
      isActive: true,
    };
    const existingProviders = (form.providers || []).filter(p => p.id !== 'copilot');
    const next = { ...form, providers: [...existingProviders, copilotProvider] };
    try {
      await persistConfigChange({ providers: next.providers }, { successMessage: 'GitHub Copilot provider saved.' });
      setForm(next);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const isPopularProvider = useCallback((provider) => {
    const name = provider?.name || '';
    const baseUrl = provider?.baseUrl || '';
    return provider?.id === 'copilot' || /github/i.test(name) || /\/copilot\/v1\/?$/i.test(baseUrl);
  }, []);

  // Memoize provider lists to avoid recalculating on every render
  const { popularProviders, copilotProvider, otherPopularProviders, customProviders } = useMemo(() => {
    const popular = form.providers.filter(isPopularProvider);
    const copilot = popular.find(provider => provider.id === 'copilot' || /github/i.test(provider.name || ''));
    const otherPopular = popular.filter(provider => provider.id !== copilot?.id);
    const custom = form.providers.filter(provider => !isPopularProvider(provider));

    return {
      popularProviders: popular,
      copilotProvider: copilot,
      otherPopularProviders: otherPopular,
      customProviders: custom
    };
  }, [form.providers, isPopularProvider]);

  // Memoize route counts for all providers to avoid recalculating on every render
  const routeCountsByProvider = useMemo(() => {
    const routing = getModelRouting();
    const counts = {};
    form.providers.forEach(p => {
      counts[p.id] = Object.values(routing).filter(
        routeValue => routeIncludesProvider(routeValue, p.id)
      ).length;
    });
    return counts;
  }, [form.model_routing, form.providers]);

  const gatewayBaseUrl = 'https://ai-bridge-zag2.onrender.com/v1';
  const currentAccessKey = initialUser?.accessKey || form.local_api_key || '';

  const renderProviderList = (providers, emptyLabel) => {
    if (providers.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-white/25 bg-slate-950/30 px-4 py-6 text-center font-semibold text-white/82">
          <p className="text-xs font-medium">{emptyLabel}</p>
        </div>
      );
    }

    return providers.map(p => (
      <div key={p.id} className={`${SOFT_PANEL} p-4 group`}>
        <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(p.id)}>
          <div className="flex items-center gap-3 font-bold text-white text-[13px]">
            <div className="p-1 rounded-md border border-white/25 bg-slate-950/35 text-white">
              {expandedIds[p.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            <span className="truncate max-w-[120px] sm:max-w-none tracking-tight text-sm">{p.name || 'Unnamed Provider'}</span>
            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider shadow-[0_0_10px_-2px_rgba(16,185,129,0.2)]">Active</span>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); removeProvider(p.id); }} className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer opacity-0 group-hover:opacity-100">
            <Trash2 size={13} />
          </button>
        </div>

        <AnimatePresence>
          {expandedIds[p.id] && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 pt-3 border-t border-white/15 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Input value={p.name} onChange={e => updateProvider(p.id, 'name', e.target.value)} placeholder="Name" />
                </div>
                <Input value={p.baseUrl} onChange={e => updateProvider(p.id, 'baseUrl', e.target.value)} placeholder="Base URL" />
                <div className="sm:col-span-2">
                  <div className="space-y-3">
                    <label className={SETTINGS_LABEL}>API Keys</label>
                    <div className="space-y-2">
                      {(p.apiKeys || (p.apiKey ? [p.apiKey] : [])).map((key, idx) => (
                        <div key={idx} className="flex gap-2">
                          <div className={KEY_PREVIEW_CLASS}>
                            {key.slice(0, 6)}...{key.slice(-6)}
                          </div>
                          <button type="button" onClick={() => removeProviderApiKey(p.id, idx)} className={REMOVE_KEY_BUTTON} title="Remove Key">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <input type="password" placeholder="Add new API key..." className={`${FIELD_CLASS} font-mono`}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProviderApiKey(p.id, e.target.value); e.target.value = ''; } }}
                            onBlur={(e) => { if (e.target.value) { addProviderApiKey(p.id, e.target.value); e.target.value = ''; } }}
                          />
                        </div>
                        <div className="w-9 h-9 flex items-center justify-center text-indigo-500/50"><Plus size={16} /></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    ));
  };

  const renderProviderGrid = useCallback((providers, emptyLabel) => {
    if (providers.length === 0) {
      return (
        <div className="col-span-full relative rounded-sm border border-dashed border-white/25 bg-slate-950/30 px-4 py-10 text-center">
          <p className="font-mono text-[10px] font-extrabold uppercase tracking-[0.24em] text-white/55">{emptyLabel}</p>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.3em] text-white/30">empty schematic</p>
        </div>
      );
    }

    return providers.map(p => {
      const routedCount = routeCountsByProvider[p.id] || 0;
      const keyCount = (p.apiKeys || (p.apiKey ? [p.apiKey] : [])).length;

      return (
        <ProviderCard
          key={p.id}
          provider={p}
          routedCount={routedCount}
          keyCount={keyCount}
          onEdit={setEditingProviderId}
          onRoute={setActiveRouteProviderId}
          onRemove={removeProvider}
        />
      );
    });
  }, [routeCountsByProvider, removeProvider]);

  if (configQuery.isPending) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pt-4 sm:px-6 lg:h-[calc(100vh-160px)] lg:overflow-hidden lg:px-10 lg:py-6">
      <header className="shrink-0 space-y-1 border-b border-white/15 pb-2 sm:space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              className="text-2xl font-black tracking-tight sm:text-4xl"
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #22d3ee 100%)',
                backgroundSize: '200% auto',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'text-gradient-shift 5s linear infinite',
              }}
            >
              System Settings
            </h1>
            <p className="text-xs font-medium text-white/82 sm:text-sm">Configure your gateway, providers, and security.</p>
          </div>
          {saveStatus.state !== 'idle' && (
            <div
              className={`rounded-xl border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] ${
                saveStatus.state === 'error'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : saveStatus.state === 'saving'
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {saveStatus.message}
            </div>
          )}
        </div>
      </header>

      <form onSubmit={handleSave} className="flex-1 flex flex-col gap-4 pb-4 pt-3 min-h-0 pr-0.5 sm:gap-6 sm:pt-4 lg:grid lg:grid-cols-12 lg:gap-8 lg:overflow-hidden lg:pr-0">
                <div className="lg:col-span-6 flex min-h-0 flex-col lg:h-full">
          <Card className="relative flex flex-col min-h-0 p-4 sm:p-5 lg:p-6 h-auto lg:h-full" style={SETTINGS_CARD_THEMES.activeModel}>
            {/* Title block */}
            <div className="relative shrink-0 mb-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-2 min-w-0 font-mono text-[9px] font-extrabold uppercase tracking-[0.28em]">
                  <span className="text-white/55 truncate">CONFIG · PROVIDERS</span>
                </div>
                <span className="shrink-0 rounded-sm border border-white/25 bg-slate-950/35 px-2 py-1 font-mono text-[9px] font-extrabold uppercase tracking-[0.18em] text-white/80">
                  {String(form.providers.length).padStart(2, '0')} configured
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <h2 className="text-2xl sm:text-[26px] font-extrabold text-white tracking-tight leading-none">Providers</h2>
                <p className="hidden sm:block pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">
                  Model proxies &amp; services
                </p>
              </div>
            </div>

            <div className="relative flex-1 flex flex-col min-h-0 lg:overflow-hidden max-lg:flex-none">
              {/* Popular Providers */}
              <div className="shrink-0 space-y-3 pb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-mono text-[10px] font-extrabold uppercase tracking-[0.24em] text-white/65">Popular Providers</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <CopilotAuthCard
                      onConnected={ensureCopilotProvider}
                      isModalOpen={isCopilotModalOpen}
                      setIsModalOpen={setIsCopilotModalOpen}
                    />
                  </div>
                  {otherPopularProviders.length > 0 && renderProviderGrid(otherPopularProviders)}
                </div>
              </div>

              {/* Custom Providers header */}
              <div className="shrink-0 pt-3 border-t border-white/15">
                <div className="flex items-end justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <h3 className="font-mono text-[10px] font-extrabold uppercase tracking-[0.24em] text-white/65">Custom Providers</h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-white/30 bg-slate-950/30 px-3 py-1.5 font-mono text-[10px] font-extrabold uppercase tracking-[0.18em] text-white hover:border-white/60 hover:bg-white/10 transition-all cursor-pointer"
                  >
                    <Plus size={11} className="text-cyan-300/85" /> New
                  </button>
                </div>
              </div>

              {/* Scrollable container displaying custom providers */}
              <div className="relative mt-3 min-h-0 lg:flex-1">
                <div
                  ref={providerListRef}
                  onScroll={updateProviderScrollState}
                  className="max-h-[296px] lg:max-h-none lg:h-full overflow-y-auto overscroll-contain scroll-smooth pr-1 pb-4 custom-scrollbar"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {renderProviderGrid(customProviders, 'No custom provider configured')}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-6 flex min-h-0 flex-col space-y-4 sm:space-y-6 lg:h-full lg:overflow-hidden">
          <ApiConfigCard
            baseUrl={gatewayBaseUrl}
            accessKey={currentAccessKey}
            onCopy={(message) => showToast(message, 'success')}
          />
        </div>
      </form>

      <CopilotModal
        isOpen={isCopilotModalOpen}
        setIsOpen={setIsCopilotModalOpen}
        onConnected={ensureCopilotProvider}
      />

      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: 'easeOut' }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
            <motion.div initial={{ scale: 0.97, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0, y: 4 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} className="relative w-full max-w-md overflow-hidden rounded-2xl p-6 space-y-6 max-h-[90vh] flex flex-col" style={SETTINGS_CARD_THEMES.addProvider}>
              <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(56,189,248,0.20) 0%, rgba(255,255,255,0.05) 34%, rgba(255,255,255,0) 64%)' }} />
              <div className="relative z-10 flex items-center justify-between gap-4 shrink-0 border-b border-white/15 pb-4">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-sky-100">Provider Setup</p>
                  <h2 className="mt-1 text-xl font-extrabold text-white">Add New Provider</h2>
                </div>
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-slate-950/35 text-white/80 hover:bg-slate-950/55 hover:text-white cursor-pointer">
                  <XCircle size={18} />
                </button>
              </div>
              <div className="relative z-10 space-y-4 overflow-y-auto custom-scrollbar pr-1 flex-1 min-h-0">
                <div className="space-y-4 rounded-2xl border border-white/15 bg-slate-950/20 p-4">
                  <div className="space-y-2">
                    <Input label="Name" value={newProviderForm.name} onChange={e => setNewProviderForm({ ...newProviderForm, name: e.target.value })} placeholder="e.g. Local LLaMA" className="break-words" />
                  </div>
                  <div className="space-y-2">
                    <Input label="Base URL" value={newProviderForm.baseUrl} onChange={e => setNewProviderForm({ ...newProviderForm, baseUrl: e.target.value })} placeholder="https://..." className="break-all" />
                  </div>
                  <div className="space-y-2">
                    <Input label="API Key" type="password" value={newProviderForm.apiKey} onChange={e => setNewProviderForm({ ...newProviderForm, apiKey: e.target.value })} placeholder="sk-..." className="break-all" />
                  </div>
                </div>
              </div>
              <div className="relative z-10 flex gap-3 shrink-0 pt-4 border-t border-white/15">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className={`flex-1 ${SECONDARY_BUTTON} cursor-pointer`}>Cancel</button>
                <button type="button" onClick={handleAddProvider} className={`flex-1 ${PRIMARY_BUTTON} cursor-pointer`}>Add Provider</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingProviderId && (() => {
          const p = form.providers.find(x => x.id === editingProviderId);
          if (!p) return null;
          return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: 'easeOut' }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
            <motion.div initial={{ scale: 0.97, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0, y: 4 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} className="relative w-full max-w-lg overflow-hidden rounded-2xl p-6 space-y-6 max-h-[90vh] flex flex-col" style={SETTINGS_CARD_THEMES.editProvider}>
              <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.18) 0%, rgba(255,255,255,0.04) 32%, rgba(255,255,255,0) 62%)' }} />
              <div className="relative z-10 flex items-center justify-between gap-4 shrink-0 border-b border-white/15 pb-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-emerald-100">Provider</p>
                  <h2 className="mt-1 truncate text-xl font-extrabold text-white">{p.name || 'Edit Provider'}</h2>
                </div>
                <button type="button" onClick={() => setEditingProviderId(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-slate-950/35 text-white/80 hover:bg-slate-950/55 hover:text-white cursor-pointer"><XCircle size={18}/></button>
              </div>
              
              <div className="relative z-10 space-y-4 overflow-y-auto custom-scrollbar pr-2 flex-1 min-h-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <Input label="Name" value={p.name} onChange={e => updateProvider(p.id, 'name', e.target.value)} placeholder="Name" className="break-words" />
                    </div>
                    <div className="sm:col-span-2">
                      <Input label="Base URL" value={p.baseUrl} onChange={e => updateProvider(p.id, 'baseUrl', e.target.value)} placeholder="Base URL" className="break-all" />
                    </div>
                    <div className="sm:col-span-2 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <label className={SETTINGS_LABEL}>API Keys</label>
                        <span className="rounded-full border border-emerald-200/30 bg-slate-950/40 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-100">
                          {(p.apiKeys || (p.apiKey ? [p.apiKey] : [])).length} saved
                        </span>
                      </div>
                      <div className="space-y-2 rounded-2xl border border-white/15 bg-slate-950/25 p-3">
                        {(p.apiKeys || (p.apiKey ? [p.apiKey] : [])).map((key, idx) => (
                          <div key={idx} className="flex gap-2">
                            <div className={KEY_PREVIEW_CLASS}>
                              {key.slice(0, 6)}...{key.slice(-6)}
                            </div>
                            <button type="button" onClick={() => removeProviderApiKey(p.id, idx)} className={REMOVE_KEY_BUTTON} title="Remove Key">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <input type="password" placeholder="Add new API key..." className={`${FIELD_CLASS} font-mono`}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProviderApiKey(p.id, e.target.value); e.target.value = ''; } }}
                              onBlur={(e) => { if (e.target.value) { addProviderApiKey(p.id, e.target.value); e.target.value = ''; } }}
                            />
                          </div>
                          <div className="w-10 h-10 flex items-center justify-center text-white bg-slate-950/35 rounded-xl border border-white/25"><Plus size={16} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
              <div className="relative z-10 shrink-0 pt-4 border-t border-white/15">
                <button type="button" onClick={() => setEditingProviderId(null)} className={`w-full ${PRIMARY_BUTTON} cursor-pointer`}>Done</button>
              </div>
            </motion.div>
          </motion.div>
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {activeRouteProviderId && (() => {
          const provider = routeProviders.find((p) => p.id === activeRouteProviderId);
          if (!provider) return null;

          const providerRoutes = Object.entries(getModelRouting()).filter(([_, routeValue]) => routeIncludesProvider(routeValue, provider.id));

          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: 'easeOut' }} className="fixed inset-0 z-[110] flex items-stretch justify-center p-2 bg-slate-950/80 backdrop-blur-md sm:items-center sm:p-4">
              <motion.div initial={{ scale: 0.97, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0, y: 4 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} className="relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-2xl p-3 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:min-h-[min(680px,calc(100vh-2rem))] sm:p-6" style={SETTINGS_CARD_THEMES.activeModel}>
                <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 58%)' }} />
                <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-5">
                <div className="flex items-start justify-between gap-4 shrink-0">
                  <h2 className="min-w-0 text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <Route size={20} className="text-white/75 shrink-0" />
                    <span className="truncate break-words">{provider.name || provider.id}</span>
                  </h2>
                  <button type="button" onClick={() => setActiveRouteProviderId(null)} className="text-white/62 hover:text-white cursor-pointer shrink-0"><XCircle size={20}/></button>
                </div>

                <div className="min-h-0 flex flex-1 flex-col gap-4 overflow-hidden">
                  {/* Add Model Dropdown */}
                  <div className="relative z-50 shrink-0 rounded-2xl border border-cyan-200/20 bg-slate-950/25 p-3" ref={modelDropdownRef}>
                    <label className={`${SETTINGS_LABEL} block mb-2`}>Add Model Route</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={isModelDropdownOpen ? modelSearchQuery : ''}
                        onChange={(e) => {
                          setModelSearchQuery(e.target.value);
                          if (!isModelDropdownOpen) setIsModelDropdownOpen(true);
                        }}
                        onFocus={() => {
                          setIsModelDropdownOpen(true);
                          setModelSearchQuery('');
                        }}
                        placeholder="Select or search a model..."
                        className={`${FIELD_CLASS} rounded-lg px-3 py-2 text-[11px] font-mono placeholder:text-white/68`}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-cyan-100">
                        <ChevronDown size={14} />
                      </div>
                      <AnimatePresence>
                        {isModelDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-48 overflow-y-auto rounded-xl border border-cyan-200/35 p-1.5 shadow-[0_18px_44px_rgba(8,47,73,0.42)] custom-scrollbar"
                            style={{ background: 'linear-gradient(135deg, rgba(8,47,73,0.98) 0%, rgba(13,78,83,0.98) 52%, rgba(15,23,42,0.98) 100%)' }}
                          >
                            {availableModels
                              .filter(m => (m.name || '').toLowerCase().includes(modelSearchQuery.toLowerCase()) || m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                              .map((m) => (
                                <div
                                  key={m.id}
                                  onClick={() => {
                                    updateModelRouteProvider(m.id, provider.id);
                                    setIsModelDropdownOpen(false);
                                    setModelSearchQuery('');
                                  }}
                                  className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left font-mono text-[11px] font-semibold text-white hover:bg-cyan-100/14 cursor-pointer transition-colors"
                                >
                                  <span className="truncate">{m.name || m.id}</span>
                                  <span className="truncate text-[10px] text-cyan-100/78">{m.id}</span>
                                </div>
                              ))}
                            {availableModels.filter(m => (m.name || '').toLowerCase().includes(modelSearchQuery.toLowerCase()) || m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())).length === 0 && (
                              <div className="px-3 py-4 text-center font-mono text-[11px] font-semibold text-cyan-50/82">No models found</div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Existing Routes List */}
                  <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar pr-1">
                    <label className={`${SETTINGS_LABEL} block mb-2`}>Configured Routes</label>
                    <p className="text-[10px] font-medium text-white/88 leading-relaxed">
                      Requests keep the selected model exactly; providers are tried in priority order only when a provider fails.
                    </p>

                    {providerRoutes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/25 bg-slate-950/30 px-4 py-6 text-center font-semibold text-white/82">
                        <p className="text-xs font-medium">No models routed to this provider</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {providerRoutes.map(([model, routeValue]) => {
                          const routeEntries = getRouteProviders(routeValue);
                          const selectedTargets = new Set(routeEntries.map((entry) => entry.target));
                          const fallbackOptions = routeProviders.filter((p) => !selectedTargets.has(p.id));

                          return (
                            <div key={model} className={`${SOFT_PANEL} group p-3 space-y-3`}>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] font-mono text-white break-all">{model}</span>
                                <button
                                  type="button"
                                  onClick={() => removeModelRoute(model)}
                                  className="p-1.5 rounded-md bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white cursor-pointer transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                  title="Remove route"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              <div className="space-y-2">
                                {routeEntries.map((entry, index) => {
                                  const routeProvider = getProviderForRouteTarget(entry.target);
                                  return (
                                    <div key={`${model}-${entry.target}`} className="flex items-center gap-2 rounded-lg border border-white/25 bg-slate-950/35 px-2 py-2">
                                      <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] text-cyan-100">
                                        {index === 0 ? 'Primary' : `Fallback ${index}`}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate break-all text-[10px] font-semibold text-white/88" title={routeProvider.baseUrl || entry.target}>
                                        {routeProvider.name || entry.target}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => moveRouteProvider(model, entry.target, -1)}
                                        disabled={index === 0}
                                        className="p-1 rounded text-white/45 hover:text-white disabled:opacity-30 disabled:hover:text-white/45"
                                        title="Move up"
                                      >
                                        <ArrowUp size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveRouteProvider(model, entry.target, 1)}
                                        disabled={index === routeEntries.length - 1}
                                        className="p-1 rounded text-white/45 hover:text-white disabled:opacity-30 disabled:hover:text-white/45"
                                        title="Move down"
                                      >
                                        <ArrowDown size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeRouteProvider(model, entry.target)}
                                        className="p-1 rounded text-rose-400 hover:bg-rose-500/10"
                                        title="Remove provider from route"
                                      >
                                        <XCircle size={12} />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>

                              {fallbackOptions.length > 0 && (
                                <div className="relative">
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) addFallbackProvider(model, e.target.value);
                                      e.target.value = '';
                                    }}
                                    className={FALLBACK_SELECT}
                                  >
                                    <option className={FALLBACK_OPTION} value="">Add fallback provider...</option>
                                    {fallbackOptions.map((p) => (
                                      <option className={FALLBACK_OPTION} key={p.id} value={p.id}>{p.name || p.id}</option>
                                    ))}
                                  </select>
                                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-cyan-100" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 pt-4 border-t border-white/15">
                  <button type="button" onClick={() => setActiveRouteProviderId(null)} className={`w-full ${PRIMARY_BUTTON} cursor-pointer`}>Done</button>
                </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default Settings;
