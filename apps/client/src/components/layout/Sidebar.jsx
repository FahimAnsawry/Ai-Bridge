import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Settings,
  Activity,
  Box,
  Menu,
  X,
  Zap,
  BookOpen,
  LogOut,
  Users
} from 'lucide-react';

const GRADIENTS = {
  blue:    'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
  violet:  'linear-gradient(135deg, #a855f7 0%, #818cf8 100%)',
  emerald: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  amber:   'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
  neon:    'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #22d3ee 100%)',
  red:     'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
};

const menuItems = [
  { name: 'Overview', icon: LayoutDashboard, path: '/dashboard', gradient: GRADIENTS.blue,    glow: 'rgba(99,102,241,0.5)' },
  { name: 'Settings', icon: Settings,        path: '/settings',  gradient: GRADIENTS.violet,  glow: 'rgba(168,85,247,0.5)' },
  { name: 'Logs',     icon: Activity,        path: '/logs',      gradient: GRADIENTS.emerald, glow: 'rgba(16,185,129,0.5)' },
  { name: 'Models',   icon: Box,             path: '/models',    gradient: GRADIENTS.amber,   glow: 'rgba(251,191,36,0.5)' },
  { name: 'Setup',    icon: BookOpen,        path: '/setup',     gradient: GRADIENTS.violet,  glow: 'rgba(168,85,247,0.5)' },
];

const Sidebar = ({ desktopWidth, mobileOpen, onCloseMobile, onToggleMobile, user }) => {
  const location = useLocation();
  const [hoveredIndex, setHoveredIndex] = useState(null);

  // Removed the navigation-based auto-close effect which was likely conflicting
  // with the toggle state and causing the sidebar to close immediately.
  
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onCloseMobile(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onCloseMobile]);

  const containerVariants = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const itemVariants = {
    hidden:  { opacity: 0, x: -12 },
    visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
  };

  const displayedItems = menuItems;

  return (
    <>
      {/* Mobile Toggle */}
      <div
        className="fixed left-4 top-4 z-[60] lg:hidden"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleMobile();
        }}
      >
        <button
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-all"
          style={{
            background: 'rgba(13,17,23,0.95)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--color-text-secondary)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onCloseMobile}
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Panel */}
      <motion.aside
        animate={{ width: desktopWidth }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{
          paddingLeft: '12px', paddingRight: '12px',
          background: 'linear-gradient(180deg, #080b14 0%, #05070f 100%)',
          borderColor: 'rgba(255,255,255,0.05)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.6)',
        }}
        className={[
          'fixed inset-y-0 left-0 z-40 flex flex-col lg:sticky lg:top-0 h-screen shrink-0',
          'py-6 border-r',
          'transition-transform duration-300 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Top spacer */}
        <div className="h-10 shrink-0" />

        {/* Logo */}
        <div className="flex items-center justify-center mb-12">
          <motion.div
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white relative"
            style={{
              background: GRADIENTS.neon,
              boxShadow: '0 0 24px rgba(99,102,241,0.5), 0 0 48px rgba(99,102,241,0.2)',
            }}
          >
            {/* Inner glow ring */}
            <div
              className="absolute inset-0 rounded-2xl"
              style={{ border: '1px solid rgba(255,255,255,0.2)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)' }}
            />
            <Zap size={22} fill="currentColor" />
          </motion.div>
        </div>

        {/* Navigation */}
        <motion.nav
          variants={containerVariants} initial="hidden" animate="visible"
          className="flex flex-col gap-2"
        >
          {displayedItems.map(({ name, icon: Icon, path, gradient, glow }, index) => (
            <motion.div
              key={name}
              variants={itemVariants}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="relative"
            >
              <NavLink to={path} onClick={onCloseMobile} aria-label={name}>
                {({ isActive }) => (
                  <div
                    className="relative flex items-center justify-center rounded-xl px-2 py-3 transition-all duration-300 overflow-hidden"
                    style={{ background: 'transparent' }}
                  >
                    {/* Active left indicator */}
                    {isActive && (
                      <motion.div
                        layoutId="active-bar"
                        className="absolute left-0 inset-y-2 w-[3px] rounded-r-full"
                        style={{ background: gradient, boxShadow: `0 0 8px ${glow}` }}
                      />
                    )}

                    {/* Icon container */}
                    <span
                      className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300"
                      style={
                        isActive
                          ? {
                              background: gradient,
                              boxShadow: `0 0 20px ${glow}, 0 4px 12px rgba(0,0,0,0.4)`,
                              color: 'white',
                              border: '1px solid rgba(255,255,255,0.15)',
                            }
                          : {
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.07)',
                              color: hoveredIndex === index ? 'rgba(255,255,255,0.8)' : 'var(--color-text-tertiary)',
                              boxShadow: hoveredIndex === index ? `0 0 12px ${glow}` : 'none',
                            }
                      }
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                    </span>
                  </div>
                )}
              </NavLink>
            </motion.div>
          ))}
        </motion.nav>

        <div className="flex-1" />

        {/* User / Logout */}
        <div className="mt-4 border-t border-white/5 pt-4 px-2">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <div className="flex flex-col min-w-0 transition-opacity duration-300" style={{ opacity: desktopWidth > 80 ? 1 : 0 }}>
              <span className="text-sm font-medium text-white truncate">{user?.displayName || 'User'}</span>
              <span className="text-xs text-white/50 truncate">{user?.email}</span>
            </div>
          </div>
          
          <motion.div variants={itemVariants} className="relative">
            <a href="/auth/logout" aria-label="Logout">
              <div className="relative flex items-center justify-center rounded-xl px-2 py-3 transition-all duration-300 overflow-hidden hover:bg-white/5 group">
                <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300 bg-white/5 border border-white/10 text-white/50 group-hover:text-red-400 group-hover:bg-red-500/10 group-hover:border-red-500/20">
                  <LogOut size={18} strokeWidth={2} />
                </span>
                <span className="absolute left-16 text-sm font-medium tracking-wide text-white/50 group-hover:text-red-400 whitespace-nowrap transition-opacity duration-300" style={{ opacity: desktopWidth > 80 ? 1 : 0 }}>
                  Logout
                </span>
              </div>
            </a>
          </motion.div>
        </div>

        {/* Bottom decoration */}
        <div className="flex justify-center pb-2">
          <div
            className="w-8 h-[2px] rounded-full"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.4), transparent)' }}
          />
        </div>
      </motion.aside>
    </>
  );
};

export default Sidebar;
