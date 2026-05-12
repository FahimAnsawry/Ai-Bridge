import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Sparkles, Zap, Activity, Copy, Check, AlertCircle, ChevronDown, RefreshCw } from 'lucide-react';
import { fetchConfig, fetchModels, syncModels } from '../api';
import { isNvidiaNimProvider } from '../utils/providerDetection';

const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'nvidia', 'meta', 'moonshot', 'deepseek', 'z-ai', 'minimax', 'qwen', 'xai', 'custom'];

const PROVIDER_META = {
  openai: { label: 'OpenAI', color: 'text-green-400 bg-green-400/10 border-green-400/20' },
  anthropic: { label: 'Anthropic', color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  google: { label: 'Google', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  nvidia: { label: 'NVIDIA', color: 'text-lime-400 bg-lime-400/10 border-lime-400/20' },
  meta: { label: 'Meta', color: 'text-blue-300 bg-blue-300/10 border-blue-300/20' },
  moonshot: { label: 'Moonshot', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  deepseek: { label: 'DeepSeek', color: 'text-teal-400 bg-teal-400/10 border-teal-400/20' },
  'z-ai': { label: 'Z-AI', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  minimax: { label: 'MiniMax', color: 'text-pink-400 bg-pink-400/10 border-pink-400/20' },
  qwen: { label: 'Qwen', color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  xai: { label: 'xAI', color: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
  custom: { label: 'Custom', color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20' },
};

function getProviderKey(provider) {
  if (!provider) return 'custom';
  const p = provider.toLowerCase();
  if (p.includes('openai')) return 'openai';
  if (p.includes('anthropic')) return 'anthropic';
  if (p.includes('google') || p.includes('gemini')) return 'google';
  if (p.includes('nvidia') || p.includes('nim') || p.includes('nemotron')) return 'nvidia';
  if (p.includes('meta') || p.includes('llama')) return 'meta';
  if (p.includes('moonshot') || p.includes('kimi')) return 'moonshot';
  if (p.includes('deepseek')) return 'deepseek';
  if (p.includes('zhipu') || p.includes('z-ai') || p.includes('glm')) return 'z-ai';
  if (p.includes('minimax')) return 'minimax';
  if (p.includes('alibaba') || p.includes('qwen')) return 'qwen';
  if (p.includes('xai') || p.includes('grok')) return 'xai';
  return 'custom';
}

function getProviderMeta(provider) {
  return PROVIDER_META[getProviderKey(provider)] || PROVIDER_META.custom;
}

const NVIDIA_RECOMMENDED_MODELS = [
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro', owned_by: 'DeepSeek' },
  { id: 'deepseek-ai/deepseek-v4-flash', name: 'DeepSeek V4 Flash', owned_by: 'DeepSeek' },
  { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B', owned_by: 'Qwen' },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct', name: 'Qwen3 Coder 480B A35B Instruct', owned_by: 'Qwen' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', owned_by: 'Moonshot' },
  { id: 'minimaxai/minimax-m2.7', name: 'MiniMax M2.7', owned_by: 'MiniMax' },
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1', owned_by: 'Z-AI' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', owned_by: 'Meta' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B Instruct', owned_by: 'NVIDIA' },
];

const ModelCard = ({ model, index }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(model.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const provider = getProviderMeta(model.owned_by);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className="group relative p-5 rounded-2xl border border-slate-800 bg-slate-950/50 hover:bg-slate-900 transition-all duration-300"
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider border ${provider.color}`}>
          {provider.label}
        </div>
        <button 
          onClick={copyToClipboard}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-all relative"
          title="Copy Model ID"
        >
          <AnimatePresence mode="wait">
            {copied ? (
              <motion.div key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                <Check size={14} className="text-emerald-400" />
              </motion.div>
            ) : (
              <motion.div key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                <Copy size={14} />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </div>
      
      <h3 className="text-sm font-bold text-white mb-1 group-hover:text-indigo-400 transition-colors truncate" title={model.name || model.id}>
        {model.name || model.id}
      </h3>
      
      {model.name && (
        <p className="text-[10px] text-slate-500 font-mono truncate mb-1" title={model.id}>
          {model.id}
        </p>
      )}
      
      <div className="flex items-center gap-3 mt-4">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
          <Zap size={12} className="text-yellow-500" />
          <span>Active</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
          <Activity size={12} className="text-indigo-500" />
          <span>Stable</span>
        </div>
      </div>
    </motion.div>
  );
};

const Models = ({ user }) => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [activeProvider, setActiveProvider] = useState(null);
  const [activeProviderIsNim, setActiveProviderIsNim] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const providerGroups = useMemo(() => {
    const groups = models.reduce((acc, model) => {
      const key = getProviderKey(model.owned_by);
      if (!acc[key]) {
        acc[key] = {
          key,
          ...PROVIDER_META[key],
          models: [],
        };
      }
      acc[key].models.push(model);
      return acc;
    }, {});

    return Object.values(groups)
      .map(group => ({
        ...group,
        models: [...group.models].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '')),
      }))
      .sort((a, b) => {
        const aIndex = PROVIDER_ORDER.indexOf(a.key);
        const bIndex = PROVIDER_ORDER.indexOf(b.key);
        return (aIndex === -1 ? PROVIDER_ORDER.length : aIndex) - (bIndex === -1 ? PROVIDER_ORDER.length : bIndex);
      });
  }, [models]);
  const providerOptions = useMemo(() => (
    providerGroups.map(group => ({
      key: group.key,
      label: group.label,
      count: group.models.length,
    }))
  ), [providerGroups]);
  const visibleProviderGroups = useMemo(() => (
    selectedProvider === 'all'
      ? providerGroups
      : providerGroups.filter(group => group.key === selectedProvider)
  ), [providerGroups, selectedProvider]);
  const visibleModelCount = visibleProviderGroups.reduce((sum, group) => sum + group.models.length, 0);

  const loadModels = async () => {
    try {
      setLoading(true);
      const [res, cfg] = await Promise.all([fetchModels(), fetchConfig()]);
      
      const fetchedModels = res.data || [];
      const providers = cfg.providers || [];
      const currentProvider = providers.find(provider => provider.id === cfg.active_provider_id) || null;
      const currentProviderIsNim = isNvidiaNimProvider(currentProvider);
      const hardcodedModels = [
        { id: 'gpt-5-mini', name: 'GPT-5 Mini', owned_by: 'openai' },
        { id: 'gpt-5.2', name: 'GPT-5.2', owned_by: 'openai' },
        { id: 'gpt-5.2-codex', name: 'GPT-5.2-Codex', owned_by: 'openai' },
        { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', owned_by: 'openai' },
        { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', owned_by: 'anthropic' },
        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', owned_by: 'anthropic' },
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', owned_by: 'anthropic' },
        { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', owned_by: 'moonshot' },
        { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro', owned_by: 'deepseek' },
        { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B', owned_by: 'qwen' },
        { id: 'minimaxai/minimax-m2.7', name: 'MiniMax M2.7', owned_by: 'minimax' },
        { id: 'z-ai/glm-5.1', name: 'GLM 5.1', owned_by: 'z-ai' },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', owned_by: 'deepseek' },
        { id: 'glm-5.1', name: 'GLM 5.1', owned_by: 'zhipu' },
        { id: 'grok-code-fast-1', name: 'Grok Code Fast 1', owned_by: 'xai' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6', owned_by: 'moonshot' },
        { id: 'minimax-m2.7', name: 'MiniMax M2.7', owned_by: 'minimax' },
        { id: 'qwen-3.6-plus', name: 'Qwen 3.6 Plus', owned_by: 'alibaba' },
        { id: 'qwen3.5-122b-a10b', name: 'Qwen3.5 122B', owned_by: 'alibaba' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', owned_by: 'google' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', owned_by: 'google' },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', owned_by: 'google' },
        { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', owned_by: 'google' },
        { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', owned_by: 'openai' },
        { id: 'gpt-5.4', name: 'GPT-5.4', owned_by: 'openai' },
        { id: 'gpt-5.5', name: 'GPT-5.5', owned_by: 'openai' }
      ];

      const allModels = [...fetchedModels];
      if (currentProviderIsNim) {
        NVIDIA_RECOMMENDED_MODELS.forEach(model => {
          if (!allModels.find(existing => existing.id === model.id)) {
            allModels.push(model);
          }
        });
      } else {
        hardcodedModels.forEach(hm => {
          if (!allModels.find(m => m.id === hm.id || m.name === hm.name)) {
            allModels.push(hm);
          }
        });
      }

      setModels(allModels);
      setActiveProvider(currentProvider);
      setActiveProviderIsNim(currentProviderIsNim);
      setError(null);
    } catch (err) {
      setError('Failed to load models. Make sure your provider is configured.');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!activeProvider?.id) return;
    try {
      setSyncing(true);
      await syncModels({ providerId: activeProvider.id });
      await loadModels();
    } catch (err) {
      setError(err.message || 'Model sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 lg:py-4"
    >
      <header className="shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
            <Box size={18} />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Model Inventory</p>
        </div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Active Models</h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || !activeProvider?.id}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs font-black uppercase tracking-[0.14em] text-slate-300 outline-none transition-all hover:border-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              title="Sync models"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
            <label className="relative block">
              <span className="sr-only">Filter provider</span>
              <select
                value={selectedProvider}
                onChange={(event) => setSelectedProvider(event.target.value)}
                className="h-10 min-w-[12rem] appearance-none rounded-xl border border-slate-800 bg-slate-950 pl-4 pr-10 text-xs font-black uppercase tracking-[0.14em] text-slate-300 outline-none transition-all hover:border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">All providers</option>
                {providerOptions.map(provider => (
                  <option key={provider.key} value={provider.key}>
                    {provider.label} ({provider.count})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </label>
            <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-400">
              {visibleModelCount} {visibleModelCount === 1 ? 'Model' : 'Models'}
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="shrink-0 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs font-medium">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {activeProviderIsNim && (
        <div className="shrink-0 rounded-2xl border border-lime-400/20 bg-lime-400/10 px-4 py-3 text-xs font-medium text-lime-100">
          NVIDIA NIM is active. Use one of the listed model IDs in your client; Claude model IDs will be rejected by the proxy.
        </div>
      )}

      <div className="flex-1 pr-2">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
             {[...Array(8)].map((_, i) => (
               <div key={i} className="h-32 bg-slate-900/50 border border-slate-800 rounded-2xl animate-pulse" />
             ))}
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 bg-slate-950/30 rounded-3xl border border-dashed border-slate-800">
            <Sparkles size={48} className="mb-4 opacity-20" />
            <h3 className="text-sm font-bold text-white mb-1">No models found</h3>
            <p className="text-xs text-slate-500 max-w-xs text-center">
              {activeProviderIsNim
                ? 'Your NVIDIA NIM catalog is empty. Sync models to fetch valid NIM model IDs.'
                : 'Your model catalog is empty. Run a sync to populate it from your active provider.'}
            </p>
          </div>
        ) : (
          <div className="pb-10">
            {selectedProvider === 'all' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {visibleProviderGroups.flatMap(group => group.models).map((model, index) => (
                  <ModelCard key={model.id} model={model} index={index} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {visibleProviderGroups.map((group) => (
                  <section key={group.key} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border ${group.color}`}>
                          {group.label}
                        </div>
                        <div className="h-px w-10 bg-slate-800" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shrink-0">
                        {group.models.length} {group.models.length === 1 ? 'Model' : 'Models'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {group.models.map((model, index) => (
                        <ModelCard key={model.id} model={model} index={index} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Models;



