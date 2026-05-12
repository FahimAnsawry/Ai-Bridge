import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Globe, ChevronDown, ChevronUp, ExternalLink, GitBranch, XCircle, Loader2, Copy, LogOut, Route, ArrowUp, ArrowDown } from 'lucide-react';
import {
  fetchConfig,
  saveConfig,
  fetchAuthStatus,
  fetchModels,
  fetchCopilotAuthStatus,
  startCopilotDeviceFlow,
  pollCopilotDeviceFlow,
  logoutCopilot,
} from '../api';
import { useToast } from '../context/ToastContext';

const DEFAULT_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2-Codex' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6' },
  { id: 'claude-opus-4.7', name: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4-6' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B' },
  { id: 'minimaxai/minimax-m2.7', name: 'MiniMax M2.7' },
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },

  { id: 'glm-5.1', name: 'GLM 5.1' },
  { id: 'grok-code-fast-1', name: 'Grok Code Fast 1' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7' },
  { id: 'qwen3.5-397b-a17b', name: 'qwen3.5-397b-a17b' },
  { id: 'qwen3.5-122b-a10b', name: 'Qwen3.5 122B' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  // NVIDIA Recommended
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
  { id: 'deepseek-ai/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B' },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct', name: 'Qwen3 Coder 480B A35B Instruct' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'minimaxai/minimax-m2.7', name: 'MiniMax M2.7' },
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B Instruct' }
];

// ── GitHub Copilot Auth Card ───────────────────────────────────────────────────
function CopilotAuthCard({
  onConnected,
}) {
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState(null);   // auth status from server
  const [loading, setLoading] = useState(true);
  const [flowState, setFlowState] = useState(null);   // active device flow info
  const [polling, setPolling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef(null);

  const refresh = async () => {
    const s = await fetchCopilotAuthStatus().catch(() => null);
    setStatus(s);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
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
    await refresh();
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
      refresh();
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
      const poll = await pollCopilotDeviceFlow().catch(() => null);
      const nextInterval = await handleDevicePollResult(poll, intervalSeconds);
      if (nextInterval) schedulePoll(nextInterval);
    }, intervalSeconds * 1000);
  };

  const startFlow = async () => {
    setSubmitting(true);
    try {
      const res = await startCopilotDeviceFlow();
      if (!res.success) throw new Error(res.error || 'Failed to start Device Flow');
      setFlowState(res);
      // Open GitHub device verification in a new tab
      window.open(res.verificationUri, '_blank', 'noopener');
      schedulePoll(res.interval || 5);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logoutCopilot();
    stopPolling();
    setFlowState(null);
    showToast('Copilot disconnected.', 'success');
    refresh();
  };

  const copyCode = () => {
    if (!flowState?.userCode) return;
    navigator.clipboard.writeText(flowState.userCode);
    showToast('Code copied!', 'success');
  };

  const isConnected = status?.hasToken;
  const isAuthed = status?.authenticated;

  if (loading) return (
    <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-5 flex items-center gap-3 text-slate-500 text-xs">
      <Loader2 size={14} className="animate-spin" /> Loading Copilot status...
    </div>
  );

  return (
    <div className={`glass border rounded-2xl p-4 space-y-3 transition-all duration-500 ${isConnected ? 'border-emerald-500/30 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]' : 'border-slate-800 hover:border-indigo-500/30 hover:shadow-glow'}`}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isConnected ? 'bg-emerald-500/15' : 'bg-slate-800'}`}>
            <GitBranch size={16} className={isConnected ? 'text-emerald-400' : 'text-slate-400'} />
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-white">GitHub Copilot</h3>

          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : isAuthed ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-800 text-slate-500'
            }`}>
            {isConnected ? 'Connected' : isAuthed ? 'Authorized' : (<><XCircle size={10} /> Not Connected</>)}
          </div>
          {isOpen ? (
            <ChevronUp size={15} className="text-slate-500" />
          ) : (
            <ChevronDown size={15} className="text-slate-500" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="copilot-card-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-4"
          >
            {/* Connected state */}
            {isConnected && (
              <div className="space-y-3">
                <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-xl p-3 space-y-1.5">
                  <p className="text-[10px] text-emerald-400 font-semibold">✓ Active Proxy Endpoints</p>
                  <div className="space-y-1 font-mono text-[9px] text-slate-400">
                    <div className="flex items-center justify-between">
                      <span>OpenAI format</span>
                      <span className="text-slate-300">/copilot/v1/chat/completions</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Anthropic format</span>
                      <span className="text-slate-300">/copilot/v1/messages</span>
                    </div>
                  </div>
                  {status?.tokenExpiry && (
                    <p className="text-[9px] text-slate-500 pt-0.5">
                      Token expires: {new Date(status.tokenExpiry).toLocaleTimeString()}
                      <span className="ml-1 text-slate-600">(auto-refreshes)</span>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 text-[10px] text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                >
                  <LogOut size={11} /> Disconnect
                </button>
              </div>
            )}

            {/* Not connected state */}
            {!isConnected && !flowState && (
              <div className="flex justify-end">
                <button
                  type="button"
                  id="copilot-device-flow-btn"
                  onClick={startFlow}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 hover:from-indigo-500 hover:via-purple-500 hover:to-cyan-400 text-white text-[11px] font-bold rounded-xl transition-all active:scale-95 shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)] disabled:opacity-60 cursor-pointer uppercase tracking-wider"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}
                  Connect
                </button>
              </div>
            )}

            {/* Active Device Flow polling state */}
            {flowState && (
              <div className="space-y-3">
                <div className="bg-indigo-950/30 border border-indigo-700/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-300 text-[11px] font-semibold">
                    <Loader2 size={12} className="animate-spin" />
                    Waiting for authorization...
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Enter this code on GitHub</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 font-mono text-xl font-bold text-white tracking-[0.3em] text-center">
                        {flowState.userCode}
                      </div>
                      <button type="button" onClick={copyCode} className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer" title="Copy code">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <a
                    href={flowState.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium rounded-lg transition-colors"
                  >
                    <ExternalLink size={11} /> Open {flowState.verificationUri}
                  </a>
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => { stopPolling(); setFlowState(null); }}
                    className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const uid = () => Math.random().toString(36).slice(2, 10);

const Input = ({ label, type = 'text', ...props }) => {
  const [show, setShow] = React.useState(false);
  const isPassword = type === 'password';
  return (
    <div className="space-y-2">
      {label && <label className="label-caps">{label}</label>}
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition duration-500"></div>
        <input {...props} type={isPassword ? (show ? 'text' : 'password') : type} className="relative w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:border-indigo-500 focus:shadow-glow focus:outline-none transition-all cursor-text pr-10 font-mono" />
        {isPassword && (
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 text-slate-500 hover:text-indigo-400 transition-colors z-10">
            {show ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        )}
      </div>
    </div>
  );
};

const Card = ({ children, className = '' }) => (
  <div className={`glass card-neon rounded-2xl p-6 transition-all duration-300 ${className}`}>
    {children}
  </div>
);

const Settings = ({ user: initialUser }) => {
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
  const [user, setUser] = useState(initialUser);
  const [expandedIds, setExpandedIds] = useState({});
  const [editingProviderId, setEditingProviderId] = useState(null);
  const [activeRouteProviderId, setActiveRouteProviderId] = useState(null);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const modelDropdownRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' });
  const providerListRef = useRef(null);
  const [providerScrollState, setProviderScrollState] = useState({ top: false, bottom: false });
  const { showToast } = useToast();

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
      await saveConfig(updates);
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

  const [availableModels, setAvailableModels] = useState([]);

  useEffect(() => {
    Promise.all([fetchConfig(), fetchAuthStatus(), fetchModels()])
      .then(([cfg, authData, modelsRes]) => {
        setForm({
          local_api_key: cfg.local_api_key || authData.user?.accessKey || '',
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
        setUser(authData.user);
        
        // Merge fetched models with DEFAULT_MODELS
        const fetched = modelsRes && modelsRes.data ? modelsRes.data : [];
        const combined = [...fetched];
        if (typeof DEFAULT_MODELS !== 'undefined') {
          DEFAULT_MODELS.forEach(dm => {
            if (!combined.find(m => m.id === dm.id)) {
              combined.push({ id: dm.id, name: dm.name });
            }
          });
        }
        setAvailableModels(combined);
        setLoading(false);
        setExpandedIds({});
      })
      .catch((err) => {
        console.error('[Settings] Failed to load config:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    requestAnimationFrame(updateProviderScrollState);
  }, [loading, form.providers, expandedIds]);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await persistConfigChange(form, { successMessage: 'Settings saved.' });
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [newProviderForm, setNewProviderForm] = React.useState({ name: '', baseUrl: '', apiKey: '' });

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
    const apiKey = user?.accessKey || form.local_api_key || '';
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

  const isPopularProvider = (provider) => {
    const name = provider?.name || '';
    const baseUrl = provider?.baseUrl || '';
    return provider?.id === 'copilot' || /github/i.test(name) || /\/copilot\/v1\/?$/i.test(baseUrl);
  };

  const popularProviders = form.providers.filter(isPopularProvider);
  const copilotProvider = popularProviders.find(provider => provider.id === 'copilot' || /github/i.test(provider.name || ''));
  const otherPopularProviders = popularProviders.filter(provider => provider.id !== copilotProvider?.id);
  const customProviders = form.providers.filter(provider => !isPopularProvider(provider));

  const renderProviderList = (providers, emptyLabel) => {
    if (providers.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-slate-600">
          <p className="text-xs font-medium">{emptyLabel}</p>
        </div>
      );
    }

    return providers.map(p => (
      <div key={p.id} className="p-4 rounded-xl border transition-all duration-300 glass border-slate-800/60 hover:border-indigo-500/30 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.15)] group">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(p.id)}>
          <div className="flex items-center gap-3 font-bold text-white text-[13px]">
            <div className="p-1 rounded-md bg-slate-800/50 text-indigo-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-colors">
              {expandedIds[p.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            <span className="truncate max-w-[120px] sm:max-w-none font-display tracking-tight text-sm">{p.name || 'Unnamed Provider'}</span>
            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider shadow-[0_0_10px_-2px_rgba(16,185,129,0.2)]">Active</span>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); removeProvider(p.id); }} className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer opacity-0 group-hover:opacity-100">
            <Trash2 size={13} />
          </button>
        </div>

        <AnimatePresence>
          {expandedIds[p.id] && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 pt-3 border-t border-slate-800 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Input value={p.name} onChange={e => updateProvider(p.id, 'name', e.target.value)} placeholder="Name" />
                </div>
                <Input value={p.baseUrl} onChange={e => updateProvider(p.id, 'baseUrl', e.target.value)} placeholder="Base URL" />
                <div className="sm:col-span-2">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">API Keys</label>
                    <div className="space-y-2">
                      {(p.apiKeys || (p.apiKey ? [p.apiKey] : [])).map((key, idx) => (
                        <div key={idx} className="flex gap-2">
                          <div className="flex-1 relative">
                            <input type="password" value={key} readOnly className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-400 focus:outline-none" />
                            <div className="absolute right-3 top-2.5 text-[8px] text-slate-600 font-mono">{key.slice(0, 4)}...{key.slice(-4)}</div>
                          </div>
                          <button type="button" onClick={() => removeProviderApiKey(p.id, idx)} className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors" title="Remove Key">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <input type="password" placeholder="Add new API key..." className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:border-indigo-500 focus:shadow-glow focus:outline-none transition-all font-mono"
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

  const renderProviderGrid = (providers, emptyLabel) => {
    if (providers.length === 0) {
      return (
        <div className="col-span-full rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-slate-600">
          <p className="text-xs font-medium">{emptyLabel}</p>
        </div>
      );
    }

    return providers.map(p => (
      <div 
        key={p.id} 
        onClick={() => setEditingProviderId(p.id)}
        className="p-4 rounded-xl border transition-all duration-300 glass border-slate-800/60 hover:border-indigo-500/50 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.25)] group cursor-pointer flex flex-col gap-3 min-h-[100px] justify-between relative overflow-hidden"
      >
        <div className="absolute -inset-0.5 bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition duration-500"></div>
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="font-display font-bold text-white tracking-tight text-sm truncate">{p.name || 'Unnamed Provider'}</span>
            <span className="text-[10px] text-slate-400 font-mono truncate">{p.baseUrl || 'No URL'}</span>
          </div>
          <button 
            type="button" 
            onClick={(e) => { e.stopPropagation(); removeProvider(p.id); }} 
            className="p-1.5 shrink-0 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="relative z-10 flex items-center justify-between mt-2 pt-2 border-t border-slate-800/50">
          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider shadow-[0_0_10px_-2px_rgba(16,185,129,0.2)]">Active</span>
          <div className="text-[10px] text-slate-500 font-mono">
            {(p.apiKeys || (p.apiKey ? [p.apiKey] : [])).length} keys
          </div>
        </div>
      </div>
    ));
  };

  if (loading) return <div className="text-center py-20 text-slate-500">Loading Configuration...</div>;

  return (
    <div className="max-w-7xl mx-auto h-[calc(100vh-100px)] flex flex-col py-6 lg:py-8 px-6 lg:px-10 space-y-6 overflow-hidden">
      <header className="shrink-0 space-y-2 pb-2 border-b border-slate-800/50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text text-neon-gradient tracking-tighter">System Settings</h1>
            <p className="text-slate-400 text-sm font-medium">Configure your gateway, providers, and security.</p>
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

      <form onSubmit={handleSave} className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-8 overflow-hidden pb-4 pt-2">
        <div className="lg:col-span-6 flex flex-col min-h-0 overflow-hidden">
          <Card className="flex-1 flex flex-col min-h-0 p-5 lg:p-6 shadow-panel overflow-hidden">
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-3 font-display tracking-tight">
                <Globe className="text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" size={20} />
                Providers
              </h2>
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden">
              <div
                ref={providerListRef}
                onScroll={updateProviderScrollState}
                className="absolute inset-0 overflow-y-auto overscroll-contain scroll-smooth space-y-3 pr-1 pb-8 custom-scrollbar"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="label-caps">Popular Providers</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <CopilotAuthCard
                        onConnected={ensureCopilotProvider}
                      />
                    </div>
                    {otherPopularProviders.length > 0 && renderProviderGrid(otherPopularProviders)}
                  </div>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800/50 mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="label-caps">Custom Provider</h3>
                    <button type="button" onClick={() => setIsAddModalOpen(true)} className="px-4 py-1.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold rounded-full hover:bg-indigo-500/20 hover:shadow-glow transition-all uppercase tracking-widest cursor-pointer border border-indigo-500/20">
                      <Plus size={12} className="inline mr-1" /> Add
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {renderProviderGrid(customProviders, 'No custom provider configured')}
                  </div>
                </div>
              </div>
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-slate-950/95 to-transparent transition-opacity ${providerScrollState.top ? 'opacity-100' : 'opacity-0'}`} />
              <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/95 to-transparent transition-opacity ${providerScrollState.bottom ? 'opacity-100' : 'opacity-0'}`} />
            </div>
          </Card>
        </div>

        <div className="lg:col-span-6 flex flex-col space-y-6 overflow-hidden min-h-0">
          <Card className="flex flex-col min-h-0 h-[calc(100vh-220px)] p-5 lg:p-6 shadow-panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 shrink-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-3 font-display tracking-tight">
                <Route className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" size={20} />
                Model Routes
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-500 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/20 shadow-[0_0_10px_-2px_rgba(34,211,238,0.2)]">
                  {Object.keys(getModelRouting()).length} Active Routes
                </span>
              </div>
            </div>

            <div className="space-y-4 overflow-hidden flex-1 min-h-0 flex flex-col pt-4 border-t border-slate-800/50 mt-4">
                  <div className="relative flex-1 min-h-0">
                    <div className="absolute inset-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4 pr-1 custom-scrollbar content-start pb-4">
                    {routeProviders.length === 0 ? (
                      <div className="col-span-full rounded-xl border border-dashed border-slate-800/50 bg-slate-950/40 px-4 py-8 text-center text-slate-600">
                        <p className="text-xs font-medium">No providers configured</p>
                      </div>
                    ) : (
                      routeProviders.map((provider) => {
                        const routedCount = Object.values(getModelRouting()).filter(routeValue => routeIncludesProvider(routeValue, provider.id)).length;

                        return (
                          <div
                            key={provider.id}
                            onClick={() => setActiveRouteProviderId(provider.id)}
                            className="p-5 rounded-xl border transition-all duration-300 glass border-slate-800/60 hover:border-cyan-500/50 hover:shadow-[0_0_20px_-5px_rgba(34,211,238,0.25)] group cursor-pointer flex flex-col gap-4 min-h-[120px] justify-between relative overflow-hidden"
                          >
                            <div className="absolute -inset-0.5 bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition duration-500 pointer-events-none"></div>

                            <div className="relative z-10 flex items-start justify-between gap-3">
                              <div className="flex flex-col gap-1.5 min-w-0">
                                <span className="font-display font-bold text-white tracking-tight text-base truncate">{provider.name || provider.id}</span>
                                <span className="text-[11px] text-slate-400 font-mono truncate">{provider.baseUrl || 'No URL'}</span>
                              </div>
                            </div>

                            <div className="relative z-10 flex items-center justify-between mt-auto pt-3 border-t border-slate-800/50">
                              <div className="flex items-center gap-2">
                                <Route size={12} className="text-cyan-500" />
                                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">
                                  {routedCount} Models Routed
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    </div>
                  </div>

                  </div>
          </Card>
        </div>
      </form>

      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-sm glass card-neon border border-slate-800 rounded-2xl p-6 space-y-6 shadow-panel">
              <h2 className="text-xl font-bold text-transparent bg-clip-text text-neon-gradient font-display">Add New Provider</h2>
              <div className="space-y-4">
                <Input label="Name" value={newProviderForm.name} onChange={e => setNewProviderForm({ ...newProviderForm, name: e.target.value })} placeholder="e.g. Local LLaMA" />
                <Input label="Base URL" value={newProviderForm.baseUrl} onChange={e => setNewProviderForm({ ...newProviderForm, baseUrl: e.target.value })} placeholder="https://..." />
                <Input label="API Key" type="password" value={newProviderForm.apiKey} onChange={e => setNewProviderForm({ ...newProviderForm, apiKey: e.target.value })} placeholder="sk-..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="flex-1 py-2.5 rounded-xl text-xs font-bold label-caps text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer">Cancel</button>
                <button type="button" onClick={handleAddProvider} className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-500 to-cyan-500 text-white hover:from-indigo-400 hover:to-cyan-400 shadow-[0_0_15px_-3px_rgba(34,211,238,0.4)] transition-all active:scale-95 cursor-pointer uppercase tracking-wider">Add Provider</button>
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-lg glass card-neon border border-slate-800 rounded-2xl p-6 space-y-6 shadow-panel max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between shrink-0">
                <h2 className="text-xl font-bold text-transparent bg-clip-text text-neon-gradient font-display">Edit Provider</h2>
                <button type="button" onClick={() => setEditingProviderId(null)} className="text-slate-400 hover:text-white cursor-pointer"><XCircle size={20}/></button>
              </div>
              
              <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 flex-1 min-h-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <Input label="Name" value={p.name} onChange={e => updateProvider(p.id, 'name', e.target.value)} placeholder="Name" />
                    </div>
                    <div className="sm:col-span-2">
                      <Input label="Base URL" value={p.baseUrl} onChange={e => updateProvider(p.id, 'baseUrl', e.target.value)} placeholder="Base URL" />
                    </div>
                    <div className="sm:col-span-2 space-y-3">
                      <label className="label-caps">API Keys</label>
                      <div className="space-y-2">
                        {(p.apiKeys || (p.apiKey ? [p.apiKey] : [])).map((key, idx) => (
                          <div key={idx} className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="password" value={key} readOnly className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-400 focus:outline-none font-mono" />
                              <div className="absolute right-3 top-2.5 text-[10px] text-slate-500 font-mono">{key.slice(0, 4)}...{key.slice(-4)}</div>
                            </div>
                            <button type="button" onClick={() => removeProviderApiKey(p.id, idx)} className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer" title="Remove Key">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <input type="password" placeholder="Add new API key..." className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:border-indigo-500 focus:shadow-glow focus:outline-none transition-all font-mono"
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProviderApiKey(p.id, e.target.value); e.target.value = ''; } }}
                              onBlur={(e) => { if (e.target.value) { addProviderApiKey(p.id, e.target.value); e.target.value = ''; } }}
                            />
                          </div>
                          <div className="w-10 h-10 flex items-center justify-center text-indigo-500 bg-indigo-500/10 rounded-xl border border-indigo-500/20"><Plus size={16} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
              <div className="shrink-0 pt-4 border-t border-slate-800/50">
                <button type="button" onClick={() => setEditingProviderId(null)} className="w-full py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-500 to-cyan-500 text-white hover:from-indigo-400 hover:to-cyan-400 shadow-[0_0_15px_-3px_rgba(34,211,238,0.4)] transition-all active:scale-95 cursor-pointer uppercase tracking-wider">Done</button>
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
              <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-lg glass card-neon border border-slate-800 rounded-2xl p-6 space-y-6 shadow-panel max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between shrink-0">
                  <h2 className="text-xl font-bold text-transparent bg-clip-text text-neon-gradient font-display flex items-center gap-2">
                    <Route size={20} className="text-cyan-400" />
                    Routes for {provider.name || provider.id}
                  </h2>
                  <button type="button" onClick={() => setActiveRouteProviderId(null)} className="text-slate-400 hover:text-white cursor-pointer"><XCircle size={20}/></button>
                </div>

                <div className="space-y-4 overflow-visible flex-1 min-h-0 flex flex-col">
                  {/* Add Model Dropdown */}
                  <div className="relative z-50 shrink-0" ref={modelDropdownRef}>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">Add Model Route</label>
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
                      className="w-full bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-white focus:border-cyan-500/50 focus:shadow-glow focus:outline-none font-mono placeholder:text-slate-500"
                    />
                    <div className="absolute right-3 top-[34px] pointer-events-none text-slate-500">
                      <ChevronDown size={14} />
                    </div>
                    <AnimatePresence>
                      {isModelDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute z-[100] w-full mt-1 bg-slate-900/95 backdrop-blur-md border border-cyan-500/30 rounded-lg shadow-glow max-h-48 overflow-y-auto custom-scrollbar p-1"
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
                                className="px-3 py-2 text-[11px] font-mono text-slate-300 hover:text-white hover:bg-cyan-500/20 rounded cursor-pointer transition-colors"
                              >
                                {m.name || m.id} <span className="text-slate-500 text-[10px]">({m.id})</span>
                              </div>
                            ))}
                          {availableModels.filter(m => (m.name || '').toLowerCase().includes(modelSearchQuery.toLowerCase()) || m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())).length === 0 && (
                            <div className="px-3 py-2 text-[11px] font-mono text-slate-500 text-center">No models found</div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Existing Routes List */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 mt-4">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">Configured Routes</label>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Requests keep the selected model exactly; providers are tried in priority order only when a provider fails.
                    </p>

                    {providerRoutes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-800/50 bg-slate-950/40 px-4 py-6 text-center text-slate-600">
                        <p className="text-xs font-medium">No models routed to this provider</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {providerRoutes.map(([model, routeValue]) => {
                          const routeEntries = getRouteProviders(routeValue);
                          const selectedTargets = new Set(routeEntries.map((entry) => entry.target));
                          const fallbackOptions = routeProviders.filter((p) => !selectedTargets.has(p.id));

                          return (
                            <div key={model} className="p-3 rounded-lg border border-slate-800/60 bg-slate-950/40 group hover:border-cyan-500/30 transition-colors space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] font-mono text-cyan-100 break-all">{model}</span>
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
                                    <div key={`${model}-${entry.target}`} className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-slate-900/50 px-2 py-2">
                                      <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] text-cyan-400">
                                        {index === 0 ? 'Primary' : `Fallback ${index}`}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-300" title={routeProvider.baseUrl || entry.target}>
                                        {routeProvider.name || entry.target}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => moveRouteProvider(model, entry.target, -1)}
                                        disabled={index === 0}
                                        className="p-1 rounded text-slate-500 hover:text-cyan-300 disabled:opacity-30 disabled:hover:text-slate-500"
                                        title="Move up"
                                      >
                                        <ArrowUp size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveRouteProvider(model, entry.target, 1)}
                                        disabled={index === routeEntries.length - 1}
                                        className="p-1 rounded text-slate-500 hover:text-cyan-300 disabled:opacity-30 disabled:hover:text-slate-500"
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
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) addFallbackProvider(model, e.target.value);
                                    e.target.value = '';
                                  }}
                                  className="w-full bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 text-[10px] text-slate-300 focus:border-cyan-500/50 focus:outline-none"
                                >
                                  <option value="">Add fallback provider...</option>
                                  {fallbackOptions.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name || p.id}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 pt-4 border-t border-slate-800/50">
                  <button type="button" onClick={() => setActiveRouteProviderId(null)} className="w-full py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-indigo-500 text-white hover:from-cyan-400 hover:to-indigo-400 shadow-[0_0_15px_-3px_rgba(34,211,238,0.4)] transition-all active:scale-95 cursor-pointer uppercase tracking-wider">Done</button>
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
