import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const Toast = ({ message, type = 'info', onClose }) => {
  const configs = {
    success: {
      icon: <CheckCircle2 size={18} className="text-emerald-400" />,
      bg: 'bg-emerald-950/20',
      border: 'border-emerald-500/30',
      glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]',
    },
    error: {
      icon: <AlertCircle size={18} className="text-rose-400" />,
      bg: 'bg-rose-950/20',
      border: 'border-rose-500/30',
      glow: 'shadow-[0_0_20px_rgba(244,63,94,0.15)]',
    },
    info: {
      icon: <Info size={18} className="text-indigo-400" />,
      bg: 'bg-indigo-950/20',
      border: 'border-indigo-500/30',
      glow: 'shadow-[0_0_20px_rgba(99,102,241,0.15)]',
    },
  };

  const config = configs[type] || configs.info;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className={`
        pointer-events-auto
        flex items-center gap-3 min-w-[300px] max-w-md
        px-4 py-3 rounded-2xl border backdrop-blur-md
        ${config.bg} ${config.border} ${config.glow}
        text-white shadow-2xl
      `}
    >
      <div className="shrink-0">{config.icon}</div>
      <div className="flex-1 text-sm font-medium tracking-wide">
        {message}
      </div>
      <button
        onClick={onClose}
        className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
};

export default Toast;
