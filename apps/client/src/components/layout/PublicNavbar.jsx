import React from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';

const PublicNavbar = () => {
  const linkClassName = ({ isActive }) => [
    'px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200',
    isActive
      ? 'text-white border border-white/20 bg-white/10'
      : 'text-[--color-text-secondary] hover:text-white hover:bg-white/5'
  ].join(' ');

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="sticky top-0 z-20"
    >
      <div
        className="mx-auto mt-4 flex w-full max-w-6xl items-center justify-between rounded-2xl border px-4 py-3 backdrop-blur"
        style={{
          borderColor: 'var(--color-glass-border)',
          background: 'var(--color-glass-bg)',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <NavLink to="/" className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
            style={{
              background: 'var(--gradient-neon)',
              boxShadow: '0 0 20px rgba(99,102,241,0.35)',
            }}
          >
            <Zap size={18} fill="currentColor" />
          </span>
          <span className="font-bold tracking-tight text-[--color-text-primary]">AI Proxy</span>
        </NavLink>

        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkClassName}>
            Home
          </NavLink>
          <NavLink to="/about" className={linkClassName}>
            About
          </NavLink>
          <a
            href="/auth/google"
            className="ml-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-transform duration-200 hover:scale-[1.02]"
            style={{ background: 'var(--gradient-neon)' }}
          >
            Sign in
          </a>
        </nav>
      </div>
    </motion.header>
  );
};

export default PublicNavbar;
