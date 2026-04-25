import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Sparkles, Cpu, Zap, Activity, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';
import { fetchModels } from '../api';

const ModelCard = ({ model, index }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(model.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getProviderColor = (provider) => {
    if (!provider) return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    const p = provider.toLowerCase();
    if (p.includes('openai')) return 'text-green-400 bg-green-400/10 border-green-400/20';
    if (p.includes('anthropic')) return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
    if (p.includes('google') || p.includes('gemini')) return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
    if (p.includes('zhipu')) return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
    if (p.includes('moonshot') || p.includes('kimi')) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    if (p.includes('minimax')) return 'text-pink-400 bg-pink-400/10 border-pink-400/20';
    if (p.includes('alibaba') || p.includes('qwen')) return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20';
    return 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className="group relative p-5 rounded-2xl border border-slate-800 bg-slate-950/50 hover:bg-slate-900 transition-all duration-300"
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider border ${getProviderColor(model.owned_by)}`}>
          {model.owned_by || 'custom'}
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

  const loadModels = async () => {
    try {
      setLoading(true);
      const res = await fetchModels();
      
      const fetchedModels = res.data || [];
      const hardcodedModels = [
        { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', owned_by: 'anthropic' },
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', owned_by: 'anthropic' },
        { id: 'glm-5.1', name: 'GLM 5.1', owned_by: 'zhipu' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6', owned_by: 'moonshot' },
        { id: 'minimax-m2.7', name: 'MiniMax M2.7', owned_by: 'minimax' },
        { id: 'qwen-3.6-plus', name: 'Qwen 3.6 Plus', owned_by: 'alibaba' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', owned_by: 'google' },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', owned_by: 'google' }
      ];

      const allModels = [...fetchedModels];
      hardcodedModels.forEach(hm => {
        if (!allModels.find(m => m.id === hm.id || m.name === hm.name)) {
          allModels.push(hm);
        }
      });

      setModels(allModels);
      setError(null);
    } catch (err) {
      setError('Failed to load models. Make sure your provider is configured.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6 h-full overflow-hidden"
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
             <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-400">
               {models.length} Models
             </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs font-medium">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
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
            <p className="text-xs text-slate-500 max-w-xs text-center">Your model catalog is empty. Run a sync to populate it from your active provider.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
            {models.map((model, index) => (
              <ModelCard key={model.id} model={model} index={index} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Models;
