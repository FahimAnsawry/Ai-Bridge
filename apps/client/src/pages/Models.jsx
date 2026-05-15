import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Sparkles, Zap, Activity, Copy, Check, ChevronDown } from 'lucide-react';

const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'meta', 'moonshot', 'deepseek', 'z-ai', 'minimax', 'qwen', 'xai', 'custom'];

const MODEL_WINDOW_THEME = {
  background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: '0 8px 32px rgba(59,130,246,0.32)',
};

const MODEL_CARD_THEMES = [
  { background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)', boxShadow: '0 8px 32px rgba(37,99,235,0.28)' },
  { background: 'linear-gradient(135deg, #0f766e 0%, #22c55e 100%)', boxShadow: '0 8px 32px rgba(15,118,110,0.28)' },
  { background: 'linear-gradient(135deg, #be123c 0%, #f97316 100%)', boxShadow: '0 8px 32px rgba(190,18,60,0.26)' },
  { background: 'linear-gradient(135deg, #4338ca 0%, #0891b2 100%)', boxShadow: '0 8px 32px rgba(67,56,202,0.28)' },
  { background: 'linear-gradient(135deg, #a21caf 0%, #ec4899 100%)', boxShadow: '0 8px 32px rgba(162,28,175,0.24)' },
  { background: 'linear-gradient(135deg, #0369a1 0%, #14b8a6 100%)', boxShadow: '0 8px 32px rgba(3,105,161,0.28)' },
  { background: 'linear-gradient(135deg, #92400e 0%, #eab308 100%)', boxShadow: '0 8px 32px rgba(146,64,14,0.24)' },
  { background: 'linear-gradient(135deg, #475569 0%, #16a34a 100%)', boxShadow: '0 8px 32px rgba(71,85,105,0.26)' },
];

const PROVIDER_META = {
  openai: { label: 'OpenAI', color: 'text-green-400 bg-green-400/10 border-green-400/20' },
  anthropic: { label: 'Anthropic', color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  google: { label: 'Google', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  meta: { label: 'Meta', color: 'text-blue-300 bg-blue-300/10 border-blue-300/20' },
  moonshot: { label: 'Moonshot', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  deepseek: { label: 'DeepSeek', color: 'text-teal-400 bg-teal-400/10 border-teal-400/20' },
  'z-ai': { label: 'Z-AI', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  minimax: { label: 'MiniMax', color: 'text-pink-400 bg-pink-400/10 border-pink-400/20' },
  qwen: { label: 'Qwen', color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  xai: { label: 'xAI', color: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
  custom: { label: 'Custom', color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20' },
};

const MODELS = [
  // OpenAI
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', owned_by: 'openai' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', owned_by: 'openai' },
  { id: 'gpt-5.4', name: 'GPT-5.4', owned_by: 'openai' },
  { id: 'gpt-5.5', name: 'GPT-5.5', owned_by: 'openai' },
  // Anthropic
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', owned_by: 'anthropic' },
  { id: 'claude-opus-4.7', name: 'Claude Opus 4.7', owned_by: 'anthropic' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', owned_by: 'anthropic' },
  // Google
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', owned_by: 'google' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', owned_by: 'google' },
 
  // DeepSeek
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro', owned_by: 'deepseek' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', owned_by: 'deepseek' },
  // Moonshot
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', owned_by: 'moonshot' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', owned_by: 'moonshot' },
  // MiniMax
  { id: 'minimaxai/minimax-m2.7', name: 'MiniMax M2.7', owned_by: 'minimax' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', owned_by: 'minimax' },
  // Z-AI
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1', owned_by: 'z-ai' },
  { id: 'glm-5.1', name: 'GLM 5.1', owned_by: 'z-ai' },
  // Qwen
  { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B', owned_by: 'qwen' },
  { id: 'qwen3.6-max-preview', name: 'Qwen3.6 Max Preview', owned_by: 'qwen' },
  { id: 'qwen3.6-plus-thinking', name: 'Qwen3.6 Plus Thinking', owned_by: 'qwen' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', owned_by: 'qwen' },
];

function getProviderKey(provider) {
  if (!provider) return 'custom';
  const p = provider.toLowerCase();
  if (p.includes('openai')) return 'openai';
  if (p.includes('anthropic')) return 'anthropic';
  if (p.includes('google') || p.includes('gemini')) return 'google';
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

function getModelCardTheme(model, index) {
  const key = `${model.id || ''}${model.name || ''}${model.owned_by || ''}`;
  const hash = [...key].reduce((value, char) => value + char.charCodeAt(0), index);
  return { ...MODEL_WINDOW_THEME, ...MODEL_CARD_THEMES[hash % MODEL_CARD_THEMES.length] };
}

const ModelCard = ({ model, index }) => {
  const [copied, setCopied] = useState(false);
  const cardTheme = useMemo(() => getModelCardTheme(model, index), [model, index]);

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
      className="group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5"
      style={cardTheme}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 58%)' }} />

      <div className="relative z-10 flex justify-between items-start mb-4">
        <div className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider border ${provider.color}`}>
          {provider.label}
        </div>
        <button
          onClick={copyToClipboard}
          className="p-1.5 rounded-lg bg-white/[0.06] text-white/55 hover:bg-white/15 hover:text-white transition-all relative"
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

      <h3 className="relative z-10 text-sm font-bold text-white mb-1 transition-colors truncate" title={model.name || model.id}>
        {model.name || model.id}
      </h3>

      {model.name && (
        <p className="relative z-10 text-[10px] text-white/52 font-mono truncate mb-1" title={model.id}>
          {model.id}
        </p>
      )}

      <div className="relative z-10 flex items-center gap-3 mt-4">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/55">
          <Zap size={12} className="text-yellow-200" />
          <span>Active</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/55">
          <Activity size={12} className="text-cyan-100" />
          <span>Stable</span>
        </div>
      </div>
    </motion.div>
  );
};

const Models = () => {
  const [selectedProvider, setSelectedProvider] = useState('all');

  const providerGroups = useMemo(() => {
    const groups = MODELS.reduce((acc, model) => {
      const key = getProviderKey(model.owned_by);
      if (!acc[key]) {
        acc[key] = { key, ...PROVIDER_META[key], models: [] };
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
  }, []);

  const providerOptions = useMemo(() =>
    providerGroups.map(group => ({ key: group.key, label: group.label, count: group.models.length })),
  [providerGroups]);

  const visibleProviderGroups = useMemo(() =>
    selectedProvider === 'all'
      ? providerGroups
      : providerGroups.filter(group => group.key === selectedProvider),
  [providerGroups, selectedProvider]);

  const visibleModelCount = visibleProviderGroups.reduce((sum, group) => sum + group.models.length, 0);

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
            <label className="relative block">
              <span className="sr-only">Filter provider</span>
              <select
                value={selectedProvider}
                onChange={(event) => setSelectedProvider(event.target.value)}
                className="h-10 min-w-[12rem] appearance-none rounded-xl border border-white/15 bg-white/[0.07] pl-4 pr-10 text-xs font-black uppercase tracking-[0.14em] text-white/70 outline-none transition-all [color-scheme:dark] hover:bg-white/[0.12] focus:border-white/35 focus:ring-2 focus:ring-cyan-300/20"
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
            <div className="px-4 py-2 rounded-xl border border-white/15 bg-white/[0.07] text-xs font-bold text-white/70">
              {visibleModelCount} {visibleModelCount === 1 ? 'Model' : 'Models'}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 pr-2">
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
                    <div className="h-px w-10 bg-white/20" />
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
    </motion.div>
  );
};

export default Models;
