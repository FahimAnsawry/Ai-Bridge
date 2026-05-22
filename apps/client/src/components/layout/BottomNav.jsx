import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Boxes,
  FileText,
  BookOpen,
  LogOut,
  MoreHorizontal,
  X,
} from 'lucide-react';

const NAV_BG = 'linear-gradient(180deg, rgba(36,44,116,0.92) 0%, rgba(31,36,100,0.94) 50%, rgba(33,31,106,0.95) 100%)';
const NAV_SHEEN = 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 45%, transparent)';
const SHEET_BG = 'linear-gradient(180deg, rgba(40,44,108,0.96) 0%, rgba(32,32,92,0.97) 100%)';
const ACTIVE_BG = 'linear-gradient(180deg, rgba(77,89,127,0.64), rgba(58,66,111,0.54))';

const primaryItems = [
  { name: 'Overview', icon: LayoutDashboard, path: '/dashboard' },
  { name: 'Settings', icon: Settings, path: '/settings' },
  { name: 'Logs', icon: FileText, path: '/logs' },
  { name: 'Models', icon: Boxes, path: '/models' },
];

const moreItems = [
  { name: 'Docs', icon: BookOpen, path: '/docs', type: 'link' },
  { name: 'Logout', icon: LogOut, href: '/auth/logout', type: 'action', tone: 'danger' },
];

const TabContent = ({ Icon, label, isActive, tone }) => {
  const activeColor = tone === 'danger' ? 'rgba(255,196,196,0.98)' : 'rgba(245,247,255,0.98)';
  const idleColor = tone === 'danger' ? 'rgba(255,196,196,0.78)' : 'rgba(222,228,255,0.62)';
  return (
    <div className="relative mx-auto flex min-h-[56px] w-full max-w-[88px] flex-col items-center justify-center gap-[3px] rounded-xl px-1 py-1.5 transition-colors duration-200">
      <span
        aria-hidden="true"
        className="absolute -top-[3px] h-[3px] rounded-full transition-all duration-300 ease-out"
        style={{
          width: isActive ? '28px' : '0px',
          opacity: isActive ? 1 : 0,
          background: 'linear-gradient(90deg, rgba(199,207,255,0.95), rgba(168,180,255,0.95))',
          boxShadow: isActive ? '0 0 12px rgba(168,180,255,0.55)' : 'none',
        }}
      />
      <span
        className="flex h-7 w-7 items-center justify-center transition-transform duration-200"
        style={{
          color: isActive ? activeColor : idleColor,
          transform: isActive ? 'translateY(-1px)' : 'none',
        }}
      >
        <Icon size={21} strokeWidth={isActive ? 2.1 : 1.6} />
      </span>
      <span
        className="text-[10.5px] font-medium leading-none tracking-wide transition-colors duration-200"
        style={{ color: isActive ? activeColor : idleColor }}
      >
        {label}
      </span>
    </div>
  );
};

const BottomNav = () => {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const moreActive = moreItems.some((m) => m.type === 'link' && location.pathname.startsWith(m.path));

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: 'rgba(3,6,34,0.62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {moreOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
          className="fixed inset-x-0 bottom-0 z-50 md:hidden animate-[slideUp_220ms_ease-out]"
          style={{
            background: SHEET_BG,
            borderTop: '1px solid rgba(157,169,255,0.22)',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 -18px 50px rgba(5,6,44,0.55)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }}
        >
          <div className="flex items-center justify-between px-5 pt-3 pb-1">
            <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-white/15" />
          </div>
          <div className="flex items-center justify-between px-5 pb-2">
            <span className="text-[13px] font-semibold tracking-wide text-white/85">More</span>
            <button
              type="button"
              aria-label="Close more menu"
              onClick={() => setMoreOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
          </div>
          <ul className="flex flex-col gap-1 px-3 pb-2">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const isDanger = item.tone === 'danger';
              const baseRow = 'flex w-full items-center gap-3 rounded-xl px-3 py-3 transition-colors';
              const rowStyle = {
                color: isDanger ? 'rgba(255,196,196,0.95)' : 'rgba(232,236,255,0.94)',
                background: 'transparent',
                minHeight: 48,
              };
              if (item.type === 'link') {
                return (
                  <li key={item.name}>
                    <NavLink
                      to={item.path}
                      aria-label={item.name}
                      className={baseRow}
                      style={({ isActive }) =>
                        isActive
                          ? { ...rowStyle, background: ACTIVE_BG, border: '1px solid rgba(199,207,255,0.18)' }
                          : { ...rowStyle, border: '1px solid transparent' }
                      }
                    >
                      <Icon size={20} strokeWidth={1.7} />
                      <span className="text-[14px] font-medium">{item.name}</span>
                    </NavLink>
                  </li>
                );
              }
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    aria-label={item.name}
                    className={baseRow}
                    style={{ ...rowStyle, border: '1px solid transparent' }}
                  >
                    <Icon size={20} strokeWidth={1.7} />
                    <span className="text-[14px] font-medium">{item.name}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <nav
        role="navigation"
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
        style={{
          background: NAV_BG,
          borderTop: '1px solid rgba(157,169,255,0.22)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 -10px 30px rgba(5,6,44,0.45)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-10"
          style={{ background: NAV_SHEEN }}
        />
        <ul className="relative flex items-stretch justify-around px-1.5 pt-1">
          {primaryItems.map(({ name, icon: Icon, path }) => (
            <li key={name} className="flex-1">
              <NavLink
                to={path}
                aria-label={name}
                className="block outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-white/40"
              >
                {({ isActive }) => <TabContent Icon={Icon} label={name} isActive={isActive} />}
              </NavLink>
            </li>
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="More"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className="block w-full outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-white/40"
            >
              <TabContent Icon={MoreHorizontal} label="More" isActive={moreOpen || moreActive} />
            </button>
          </li>
        </ul>
      </nav>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(16px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  );
};

export default BottomNav;
