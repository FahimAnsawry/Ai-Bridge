import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Zap, Globe, ChevronDown, ChevronUp, ExternalLink, GitBranch, XCircle, Loader2, Copy, LogOut } from 'lucide-react';
import {
  fetchConfig,
  saveConfig,
  fetchAuthStatus,
  fetchCopilotAuthStatus,
  startCopilotDeviceFlow,
  pollCopilotDeviceFlow,
  logoutCopilot,
} from '../api';
import AccessKeyDisplay from '../components/common/AccessKeyDisplay';
import { useToast } from '../context/ToastContext';

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
    <div className={`bg-slate-950/50 border rounded-2xl p-5 space-y-4 transition-all ${isConnected ? 'border-emerald-700/40' : 'border-slate-800'}`}>
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
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-[10px] font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-indigo-500/20 disabled:opacity-60 cursor-pointer"
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
      {label && <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</label>}
      <div className="relative">
        <input {...props} type={isPassword ? (show ? 'text' : 'password') : type} className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:border-indigo-500/50 focus:outline-none transition-all cursor-text pr-10" />
        {isPassword && (
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2 text-slate-500 hover:text-slate-300">
            {show ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        )}
      </div>
    </div>
  );
};

const Card = ({ children, className = '' }) => (
  <div className={`bg-slate-950/50 border border-slate-800 rounded-2xl p-6 ${className}`}>
    {children}
  </div>
);

const Settings = ({ user: initialUser }) => {
  const [form, setForm] = useState({
    local_api_key: '',
    active_provider_id: '',
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const providerListRef = useRef(null);
  const [providerScrollState, setProviderScrollState] = useState({ top: false, bottom: false });
  const { showToast } = useToast();

  const updateProviderScrollState = () => {
    const el = providerListRef.current;
    if (!el) return;
    const hasOverflow = el.scrollHeight > el.clientHeight + 1;
    setProviderScrollState({
      top: hasOverflow && el.scrollTop > 4,
      bottom: hasOverflow && el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    });
  };

  useEffect(() => {
    Promise.all([fetchConfig(), fetchAuthStatus()]).then(([cfg, authData]) => {
      setForm({
        local_api_key: cfg.local_api_key || authData.user?.accessKey || '',
        active_provider_id: cfg.active_provider_id || '',
        providers: cfg.providers || [],
        port: cfg.port || 3000,
        token_optimization_enabled: cfg.token_optimization_enabled === true,
        prompt_budget_tokens: cfg.prompt_budget_tokens || 0,
        token_summarization_enabled: cfg.token_summarization_enabled === true,
        response_cache_enabled: cfg.response_cache_enabled === true,
        response_cache_ttl_seconds: cfg.response_cache_ttl_seconds || 30,
      });
      setUser(authData.user);
      setLoading(false);
      setExpandedIds({});
    });
  }, []);

  useEffect(() => {
    requestAnimationFrame(updateProviderScrollState);
  }, [loading, form.providers, expandedIds]);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await saveConfig(form);
      showToast('Settings saved.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [newProviderForm, setNewProviderForm] = React.useState({ name: '', baseUrl: '', apiKey: '' });

  const isProviderSelected = (provider) => provider?.isActive !== false;

  const handleAddProvider = () => {
    if (!newProviderForm.name || !newProviderForm.baseUrl || !newProviderForm.apiKey) {
      showToast('All fields are required.', 'error');
      return;
    }
    const id = uid();
    const newP = { id, ...newProviderForm, isActive: false };
    const next = { ...form, providers: [...form.providers, newP] };
    setForm(next);
    saveConfig({ providers: next.providers });
    setExpandedIds(prev => ({ ...prev, [id]: true }));
    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setIsAddModalOpen(false);
  };

  const toggleExpand = (id) => setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));

  const updateProvider = (id, field, value) => {
    setForm(prev => {
      const next = {
        ...prev, providers: prev.providers.map(p => {
          if (p.id !== id) return p;
          const updated = { ...p, [field]: value };
          // If editing the single apiKey, keep apiKeys synced for now (legacy compat)
          if (field === 'apiKey' && (!p.apiKeys || p.apiKeys.length <= 1)) {
            updated.apiKeys = [value];
          }
          return updated;
        })
      };
      saveConfig({ providers: next.providers });
      return next;
    });
  };

  const addProviderApiKey = (id, key) => {
    if (!key) return;
    setForm(prev => {
      const next = {
        ...prev, providers: prev.providers.map(p => {
          if (p.id !== id) return p;
          const apiKeys = Array.isArray(p.apiKeys) ? [...p.apiKeys] : (p.apiKey ? [p.apiKey] : []);
          if (apiKeys.includes(key)) return p;
          const newKeys = [...apiKeys, key];
          return { ...p, apiKeys: newKeys, apiKey: p.apiKey || key };
        })
      };
      saveConfig({ providers: next.providers });
      return next;
    });
  };

  const removeProviderApiKey = (id, index) => {
    setForm(prev => {
      const next = {
        ...prev, providers: prev.providers.map(p => {
          if (p.id !== id) return p;
          const apiKeys = Array.isArray(p.apiKeys) ? p.apiKeys.filter((_, i) => i !== index) : [];
          return { ...p, apiKeys, apiKey: apiKeys[0] || '' };
        })
      };
      saveConfig({ providers: next.providers });
      return next;
    });
  };

  const removeProvider = (id) => {
    setForm(prev => {
      const providers = prev.providers.filter(p => p.id !== id);
      const fallbackProvider = providers.find(p => !isPopularProvider(p) && isProviderSelected(p)) || providers.find(isProviderSelected) || providers[0];
      const next = {
        ...prev,
        providers,
        active_provider_id: prev.active_provider_id === id ? (fallbackProvider?.id || '') : prev.active_provider_id,
      };
      saveConfig({
        providers: next.providers,
        active_provider_id: next.active_provider_id,
        replace_providers: true,
      });
      return next;
    });
  };

  const setActive = (p) => {
    if (!p.baseUrl || (p.apiKeys?.length === 0 && !p.apiKey)) {
      showToast('Base URL and at least one API Key are required.', 'error');
      return;
    }
    const isPopular = isPopularProvider(p);
    const providers = form.providers.map(provider => {
      if (provider.id === p.id) return { ...provider, isActive: true };
      if (!isPopular && !isPopularProvider(provider)) return { ...provider, isActive: false };
      return provider;
    });
    const next = {
      ...form,
      providers,
      active_provider_id: isPopular ? form.active_provider_id : p.id,
    };
    setForm(next);
    saveConfig({
      providers: next.providers,
      active_provider_id: next.active_provider_id,
    });
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
    const selectedCustomProvider = existingProviders.find(p => !isPopularProvider(p) && isProviderSelected(p));
    const next = {
      ...form,
      providers: [...existingProviders, copilotProvider],
      active_provider_id: selectedCustomProvider?.id || (form.active_provider_id === 'copilot' ? '' : form.active_provider_id),
    };
    try {
      await saveConfig({
        providers: next.providers,
        active_provider_id: next.active_provider_id,
      });
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

    return providers.map(p => {
      const isSelected = isProviderSelected(p);
      const isDefault = form.active_provider_id === p.id;

      return (
        <div key={p.id} className={`p-3 rounded-xl border transition-all ${isSelected ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-slate-900 border-slate-800'}`}>
          <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(p.id)}>
            <div className="flex items-center gap-3 font-bold text-white text-[13px]">
              {expandedIds[p.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <span className="truncate max-w-[120px] sm:max-w-none">{p.name || 'Unnamed Provider'}</span>
              {isSelected && <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full uppercase">{isDefault ? 'Active' : 'Selected'}</span>}
            </div>
            <div className="flex items-center gap-2">
              {!isSelected && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActive(p); }}
                  className={`p-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-colors cursor-pointer flex items-center gap-1 ${!p.baseUrl || (p.apiKeys?.length === 0 && !p.apiKey) ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20'}`}
                  title={!p.baseUrl || (p.apiKeys?.length === 0 && !p.apiKey) ? 'Requires Base URL and API Key' : 'Set as Active'}
                >
                  <Zap size={11} />
                  <span className="hidden sm:inline">Select</span>
                </button>
              )}
              <button type="button" onClick={(e) => { e.stopPropagation(); removeProvider(p.id); }} className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 cursor-pointer">
                <Trash2 size={12} />
              </button>
            </div>
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
                              <input
                                type="password"
                                value={key}
                                readOnly
                                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-400 focus:outline-none"
                              />
                              <div className="absolute right-3 top-2.5 text-[8px] text-slate-600 font-mono">
                                {key.slice(0, 4)}...{key.slice(-4)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeProviderApiKey(p.id, idx)}
                              className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors"
                              title="Remove Key"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <input
                              type="password"
                              placeholder="Add new API key..."
                              className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:border-indigo-500/50 focus:outline-none transition-all"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addProviderApiKey(p.id, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value) {
                                  addProviderApiKey(p.id, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            />
                          </div>
                          <div className="w-9 h-9 flex items-center justify-center text-slate-700">
                            <Plus size={16} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setActive(p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold transition-colors uppercase tracking-widest cursor-pointer ${isSelected ? 'bg-emerald-500/20 text-emerald-400' : (!p.baseUrl || (p.apiKeys?.length === 0 && !p.apiKey) ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-rose-950/30 text-rose-400 hover:bg-rose-950/50')}`}>
                    <Zap size={11} /> {isSelected ? (isDefault ? 'Active' : 'Selected') : 'Select'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });
  };

  if (loading) return <div className="text-center py-20 text-slate-500">Loading Configuration...</div>;

  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col py-6 lg:py-4 px-6 space-y-6 lg:space-y-4 overflow-hidden">
      <header className="shrink-0 space-y-1">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">System Settings</h1>
        <p className="text-slate-400 text-sm">Configure your gateway, providers, and security.</p>
      </header>

      <form onSubmit={handleSave} className="flex-1 min-h-150 flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-8 overflow-hidden pb-4">
        <div className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden">
          <Card className="flex-1 flex flex-col min-h-0 p-4 lg:p-5">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-base font-bold text-white flex items-center gap-3">
                <Globe className="text-indigo-500" size={18} />
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Popular Providers</h3>
                  </div>
                  <div className="space-y-3">
                    <CopilotAuthCard
                      onConnected={ensureCopilotProvider}
                    />
                    {otherPopularProviders.length > 0 && renderProviderList(otherPopularProviders)}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Custom Provider</h3>
                    <button type="button" onClick={() => setIsAddModalOpen(true)} className="px-3 py-1.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold rounded-lg hover:bg-indigo-500/20 transition-colors uppercase tracking-widest cursor-pointer">
                      <Plus size={12} className="inline mr-1" /> Add
                    </button>
                  </div>
                  <div className="space-y-3">
                    {renderProviderList(customProviders, 'No custom provider configured')}
                  </div>
                </div>
              </div>
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-slate-950/95 to-transparent transition-opacity ${providerScrollState.top ? 'opacity-100' : 'opacity-0'}`} />
              <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/95 to-transparent transition-opacity ${providerScrollState.bottom ? 'opacity-100' : 'opacity-0'}`} />
            </div>
          </Card>
        </div>

        <div className="lg:col-span-4">
          <AccessKeyDisplay accessKey={user?.accessKey} />
        </div>
      </form>

      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl">
              <h2 className="text-lg font-bold text-white">Add New Provider</h2>
              <div className="space-y-4">
                <Input label="Name" value={newProviderForm.name} onChange={e => setNewProviderForm({ ...newProviderForm, name: e.target.value })} />
                <Input label="Base URL" value={newProviderForm.baseUrl} onChange={e => setNewProviderForm({ ...newProviderForm, baseUrl: e.target.value })} />
                <Input label="API Key" type="password" value={newProviderForm.apiKey} onChange={e => setNewProviderForm({ ...newProviderForm, apiKey: e.target.value })} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setIsAddModalOpen(false)} className="flex-1 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleAddProvider} className="flex-1 py-2 rounded-xl text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/20 transition-all active:scale-95">Add Provider</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Settings;
