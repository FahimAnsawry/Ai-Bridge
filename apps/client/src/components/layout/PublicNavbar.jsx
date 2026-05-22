import { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Menu, X, Zap } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' },
  { to: '/docs', label: 'Docs' },
];

const PublicNavbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const linkClass = ({ isActive }) =>
    `relative px-4 py-2 text-sm font-semibold uppercase transition-all duration-300 ${
      isActive
        ? 'text-cyan-400'
        : 'text-slate-400 hover:text-cyan-300'
    }`;

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-4 sm:px-6 lg:px-8">
        <motion.div
          animate={{
            borderColor: scrolled
              ? 'rgba(255,255,255,0.10)'
              : 'rgba(255,255,255,0.06)',
          }}
          className="flex w-full max-w-6xl items-center gap-4 rounded-2xl border px-5 py-3 transition-shadow duration-500"
          style={{
            background: scrolled
              ? 'rgba(15,10,50,0.88)'
              : 'rgba(15,10,50,0.55)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: scrolled
              ? '0 8px 32px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.08)'
              : '0 2px 16px -4px rgba(0,0,0,0.3)',
          }}
        >
          {/* Logo */}
          <NavLink to="/" className="flex shrink-0 items-center gap-3 group">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-300 group-hover:shadow-[0_0_18px_-3px_rgba(99,102,241,0.5)] group-hover:scale-105"
              style={{ background: 'rgba(99,102,241,0.18)' }}
            >
              <Zap size={16} className="text-indigo-300 transition-colors duration-300 group-hover:text-indigo-200" />
            </span>
            <div className="hidden sm:block">
              <span className="text-base font-black text-white tracking-tight uppercase">
                AI BRIDGE
              </span>
            </div>
          </NavLink>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={linkClass}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden sm:flex items-center gap-3">
            <Link
              to="/login"
              className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl px-5 py-2.5 text-sm font-bold text-slate-950 transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_14px_30px_-8px_rgba(0,0,0,0.45)]"
              style={{
                background: 'linear-gradient(135deg, #67e8f9 0%, #2dd4bf 100%)',
                boxShadow: '0 12px 30px rgba(45, 212, 191, 0.22)',
              }}
            >
              <span className="relative z-10 flex items-center gap-2.5">
                SIGN IN
                <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </Link>
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="flex sm:hidden h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300 hover:text-white hover:border-white/20 transition-colors"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </motion.div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm sm:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="fixed top-20 left-4 right-4 z-50 rounded-2xl border border-white/12 p-5 sm:hidden"
              style={{
                background: 'rgba(15,10,50,0.96)',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 20px 60px -12px rgba(0,0,0,0.6)',
              }}
            >
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                        isActive
                          ? 'bg-accent/14 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
                <hr className="my-2 border-white/8" />
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-slate-950 transition-all duration-200 hover:shadow-[0_0_20px_-4px_rgba(45,212,191,0.5)]"
                  style={{ background: 'linear-gradient(135deg, #67e8f9 0%, #2dd4bf 100%)' }}
                >
                  SIGN IN
                  <ArrowRight size={14} />
                </Link>
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default PublicNavbar;
