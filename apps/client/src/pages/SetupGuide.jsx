import React from 'react';
import { motion } from 'framer-motion';
import { BookOpen } from 'lucide-react';

const SetupGuide = ({ user }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col gap-6"
    >
      <header>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-[--color-bg-panel] border border-[--color-glass-border] text-[#818cf8]">
            <BookOpen size={20} />
          </div>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-[--color-text-tertiary]">Getting Started</p>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-[--color-text-primary]">Setup Guide</h1>
        <p className="mt-2 text-sm font-medium text-[--color-text-secondary]">
          Configure your environment and start proxying AI requests.
        </p>
      </header>

      <div 
        className="rounded-2xl p-8 border border-[--color-glass-border] bg-[--color-bg-panel]"
        style={{ minHeight: '400px' }}
      >
        <p className="text-[--color-text-tertiary] italic">Setup guide content coming soon...</p>
      </div>
    </motion.div>
  );
};

export default SetupGuide;
