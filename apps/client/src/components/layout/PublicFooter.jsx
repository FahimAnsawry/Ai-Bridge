import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Zap } from 'lucide-react';

const footerLinks = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Docs', to: '/docs' },
  { label: 'Login', to: '/login' },
];

function PublicFooter() {
  return (
    <footer className="mx-auto mt-6 w-full max-w-6xl border-t border-white/10 px-4 py-6 sm:mt-10 sm:px-6 lg:px-8 sm:py-10">
      <div className="grid gap-5 sm:gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
        <div>
          <div className="flex items-start gap-3 sm:items-center">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white sm:h-9 sm:w-9"
              style={{ background: 'rgba(99, 102, 241, 0.9)' }}
            >
              <Zap size={16} fill="currentColor" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-black text-white" style={{ letterSpacing: 0 }}>AI Proxy</p>
              <p className="mt-1 text-xs leading-5 text-slate-400 sm:text-sm">Local model routing, visibility, and access control.</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 text-xs leading-5 text-slate-400 sm:mt-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:text-sm">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={15} className="text-indigo-300" />
              Provider keys stay server-side
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-white/20 sm:block" />
            <span>OpenAI-compatible local endpoint</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-end">
          <nav className="flex flex-wrap gap-x-4 gap-y-2 sm:gap-x-5 sm:gap-y-3">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="text-xs font-semibold uppercase text-slate-300 transition-colors duration-200 hover:text-white sm:text-sm"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

export default PublicFooter;
