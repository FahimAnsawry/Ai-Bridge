import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Zap, Globe, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { fetchConfig, saveConfig, fetchAuthStatus } from '../api';
import AccessKeyDisplay from '../components/common/AccessKeyDisplay';
import { useToast } from '../context/ToastContext';

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
  const { showToast } = useToast();

  useEffect(() => {
    Promise.all([fetchConfig(), fetchAuthStatus()]).then(([cfg, authData]) => {
        setForm({
          local_api_key: cfg.local_api_key || '',
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

  const handleAddProvider = () => {
    if (!newProviderForm.name || !newProviderForm.baseUrl || !newProviderForm.apiKey) {
      showToast('All fields are required.', 'error');
      return;
    }
    const id = uid();
    const newP = { id, ...newProviderForm };
    const next = { ...form, providers: [...form.providers, newP] };
    setForm(next);
    saveConfig(next);
    setExpandedIds(prev => ({ ...prev, [id]: true }));
    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setIsAddModalOpen(false);
  };

  const toggleExpand = (id) => setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));

  const updateProvider = (id, field, value) => {
    setForm(prev => {
        const next = { ...prev, providers: prev.providers.map(p => {
          if (p.id !== id) return p;
          const updated = { ...p, [field]: value };
          // If editing the single apiKey, keep apiKeys synced for now (legacy compat)
          if (field === 'apiKey' && (!p.apiKeys || p.apiKeys.length <= 1)) {
            updated.apiKeys = [value];
          }
          return updated;
        }) };
        saveConfig(next);
        return next;
    });
  };

  const addProviderApiKey = (id, key) => {
    if (!key) return;
    setForm(prev => {
      const next = { ...prev, providers: prev.providers.map(p => {
        if (p.id !== id) return p;
        const apiKeys = Array.isArray(p.apiKeys) ? [...p.apiKeys] : (p.apiKey ? [p.apiKey] : []);
        if (apiKeys.includes(key)) return p;
        const newKeys = [...apiKeys, key];
        return { ...p, apiKeys: newKeys, apiKey: p.apiKey || key };
      }) };
      saveConfig(next);
      return next;
    });
  };

  const removeProviderApiKey = (id, index) => {
    setForm(prev => {
      const next = { ...prev, providers: prev.providers.map(p => {
        if (p.id !== id) return p;
        const apiKeys = Array.isArray(p.apiKeys) ? p.apiKeys.filter((_, i) => i !== index) : [];
        return { ...p, apiKeys, apiKey: apiKeys[0] || '' };
      }) };
      saveConfig(next);
      return next;
    });
  };

  const removeProvider = (id) => {
    setForm(prev => {
        const next = { ...prev, providers: prev.providers.filter(p => p.id !== id), active_provider_id: prev.active_provider_id === id ? (prev.providers.find(p => p.id !== id)?.id || '') : prev.active_provider_id };
        saveConfig(next);
        return next;
    });
  };

  const setActive = (p) => {
    if (!p.baseUrl || (p.apiKeys?.length === 0 && !p.apiKey)) {
      showToast('Base URL and at least one API Key are required.', 'error');
      return;
    }
    const next = {...form, active_provider_id: p.id};
    setForm(next);
    saveConfig(next);
  };

  if (loading) return <div className="text-center py-20 text-slate-500">Loading Configuration...</div>;

  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col py-6 lg:py-4 px-6 space-y-6 lg:space-y-4 overflow-hidden">
      <header className="shrink-0 space-y-1">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">System Settings</h1>
        <p className="text-slate-400 text-sm">Configure your gateway, providers, and security.</p>
      </header>

      <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-8 overflow-hidden pb-4">
        <div className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden">
          <Card className="flex-1 flex flex-col min-h-0 p-4 lg:p-5">
              <div className="flex items-center justify-between mb-4 shrink-0">
                  <h2 className="text-base font-bold text-white flex items-center gap-3">
                      <Globe className="text-indigo-500" size={18} />
                      Providers
                  </h2>
                  <button type="button" onClick={() => setIsAddModalOpen(true)} className="px-3 py-1.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold rounded-lg hover:bg-indigo-500/20 transition-colors uppercase tracking-widest cursor-pointer">
                      <Plus size={12} className="inline mr-1" /> Add
                  </button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                  {form.providers.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 py-10">
                      <Globe size={40} className="opacity-20" />
                      <p className="text-xs font-medium">No providers configured yet</p>
                    </div>
                  ) : form.providers.map(p => (
                      <div key={p.id} className={`p-3 rounded-xl border transition-all ${form.active_provider_id === p.id ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-slate-900 border-slate-800'}`}>
                          <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(p.id)}>
                              <div className="flex items-center gap-3 font-bold text-white text-[13px]">
                                  {expandedIds[p.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                  <span className="truncate max-w-[120px] sm:max-w-none">{p.name || 'Unnamed Provider'}</span>
                                  {form.active_provider_id === p.id && <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full uppercase">Active</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                  {form.active_provider_id !== p.id && (
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
                                          <button type="button" onClick={() => setActive(p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold transition-colors uppercase tracking-widest cursor-pointer ${form.active_provider_id === p.id ? 'bg-emerald-500/20 text-emerald-400' : (!p.baseUrl || (p.apiKeys?.length === 0 && !p.apiKey) ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-rose-950/30 text-rose-400 hover:bg-rose-950/50')}`}>
                                              <Zap size={11} /> {form.active_provider_id === p.id ? 'Selected' : 'Set Active'}
                                          </button>
                                      </div>
                                  </motion.div>
                              )}
                          </AnimatePresence>
                      </div>
                  ))}
              </div>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-6 lg:space-y-4">
          <AccessKeyDisplay accessKey={user?.accessKey} />

          <Card className="bg-indigo-500/5 border-indigo-500/20 p-4 lg:p-5">
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2">Configuration Note</h3>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Changes to providers and access keys are saved automatically as you type. Gateway port changes require a server restart to take effect.
            </p>
          </Card>
        </div>
      </form>

      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl">
                  <h2 className="text-lg font-bold text-white">Add New Provider</h2>
                  <div className="space-y-4">
                      <Input label="Name" value={newProviderForm.name} onChange={e => setNewProviderForm({...newProviderForm, name: e.target.value})} />
                      <Input label="Base URL" value={newProviderForm.baseUrl} onChange={e => setNewProviderForm({...newProviderForm, baseUrl: e.target.value})} />
                      <Input label="API Key" type="password" value={newProviderForm.apiKey} onChange={e => setNewProviderForm({...newProviderForm, apiKey: e.target.value})} />
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
