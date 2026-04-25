import React, { useState } from 'react';
import { FiCopy, FiCheck, FiRefreshCw } from 'react-icons/fi';
import { regenerateAccessKey } from '../../api';
import { motion, AnimatePresence } from 'framer-motion';

export default function AccessKeyDisplay({ accessKey: initialKey }) {
  const [accessKey, setAccessKey] = useState(initialKey);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [error, setError] = useState(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(accessKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    setShowConfirmModal(false);
    setError(null);
    setLoading(true);
    try {
      const data = await regenerateAccessKey();
      setAccessKey(data.accessKey);
      setVisible(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!accessKey) {
    return (
      <div className="p-4 bg-yellow-50/5 border border-yellow-500/20 text-yellow-500 rounded-xl flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">No Access Key</p>
          <p className="text-[10px] opacity-70">Generate your first key to start using the proxy.</p>
        </div>
        <button
          onClick={() => setShowConfirmModal(true)}
          disabled={loading}
          className="px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
        >
          {loading ? '...' : 'Generate'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-5 relative overflow-hidden group">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg">
            <Zap className="text-indigo-500" size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">API Access Key</h3>
            <p className="text-[10px] text-slate-500">Your unique gateway credentials</p>
          </div>
        </div>
        <button
          onClick={() => setShowConfirmModal(true)}
          disabled={loading}
          className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-indigo-400 transition-colors"
          title="Regenerate Key"
        >
          <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2.5 font-mono text-xs text-white break-all relative">
          {visible ? accessKey : '••••••••'}
        </div>
        <button
          onClick={() => setVisible(!visible)}
          className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl transition-colors text-slate-400"
          title={visible ? "Hide Key" : "Show Key"}
        >
          {visible ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </button>
        <button
          onClick={handleCopy}
          className="p-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-all active:scale-95 flex items-center justify-center min-w-[2.5rem]"
          title="Copy to clipboard"
        >
          {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
        </button>
      </div>

      {visible && (
        <p className="mt-3 text-[9px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">
          Key visible — Copy and save securely!
        </p>
      )}

      <AnimatePresence>
        {showConfirmModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl">
              <h2 className="text-lg font-bold text-white">Regenerate Access Key</h2>
              <p className="text-slate-400 text-sm">Are you sure you want to regenerate your access key? The old one will stop working immediately.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleRegenerate} className="flex-1 py-2 rounded-xl text-xs font-bold bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-500/20 transition-all active:scale-95">Regenerate</button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-rose-500" />
                Error
              </h2>
              <p className="text-slate-400 text-sm">{error}</p>
              <button onClick={() => setError(null)} className="w-full py-2 rounded-xl text-xs font-bold bg-slate-800 text-white hover:bg-slate-700 transition-all">Close</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const Zap = ({ className, size }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);
