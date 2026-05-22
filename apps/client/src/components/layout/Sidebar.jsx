import React from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Settings,
  Boxes,
  FileText,
  BookOpen,
  LogOut,
} from 'lucide-react';

const SIDEBAR_WIDTH = 96;
const SIDEBAR_RAIL_BG = 'linear-gradient(180deg, rgba(36,44,116,0.86) 0%, rgba(31,36,100,0.88) 46%, rgba(33,31,106,0.88) 100%)';
const SIDEBAR_RAIL_SHEEN = 'linear-gradient(90deg, rgba(255,255,255,0.15), rgba(255,255,255,0.035) 42%, rgba(4,8,46,0.12)), radial-gradient(ellipse at 50% 8%, rgba(88,104,174,0.32), transparent 28%)';
const SIDEBAR_ACTIVE_BG = 'linear-gradient(180deg, rgba(77,89,127,0.64), rgba(58,66,111,0.54))';

const menuItems = [
  { name: 'Overview', icon: LayoutDashboard, path: '/dashboard' },
  { name: 'Settings', icon: Settings, path: '/settings' },
  { name: 'Logs', icon: FileText, path: '/logs' },
  { name: 'Models', icon: Boxes, path: '/models' },
  { name: 'Docs', icon: BookOpen, path: '/docs' },
];

const Sidebar = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
  };

  const itemVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.18 } },
  };

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: SIDEBAR_WIDTH }}
        style={{ background: 'transparent' }}
        className={[
          'sticky top-0 inset-y-0 left-0 z-40 hidden md:flex h-dvh shrink-0 flex-col items-center overflow-hidden',
          'px-0 py-0',
        ].join(' ')}
      >
        <div
          className="absolute left-3.5 top-[10px] bottom-[10px] w-[70px] overflow-hidden rounded-[14px]"
          style={{
            background: SIDEBAR_RAIL_BG,
            border: '1px solid rgba(157,169,255,0.22)',
            backdropFilter: 'blur(24px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.06), 0 18px 42px rgba(5,6,44,0.24)',
          }}
        />
        <div
          className="pointer-events-none absolute left-3.5 top-[10px] bottom-[10px] w-[70px] overflow-hidden rounded-[14px]"
          style={{
            background: SIDEBAR_RAIL_SHEEN,
          }}
        />

        <div className="h-[72px] shrink-0 lg:h-[92px]" />

        <motion.nav
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative z-10 flex min-h-0 w-[70px] flex-1 flex-col items-center gap-[22px] overflow-y-auto overscroll-contain py-1 no-scrollbar"
        >
          {menuItems.map(({ name, icon: Icon, path }, index) => (
            <motion.div
              key={name}
              variants={itemVariants}
              className="relative flex w-full justify-center"
            >
              <NavLink
                to={path}
                aria-label={name}
                title={name}
                className="block"
              >
                {({ isActive }) => {
                  return (
                    <div
                      className="relative flex h-12 w-12 items-center justify-center rounded-[10px]"
                      style={
                        isActive
                          ? {
                              background: SIDEBAR_ACTIVE_BG,
                              border: '1px solid rgba(199,207,255,0.18)',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
                            }
                          : {
                              background: 'transparent',
                              border: '1px solid transparent',
                            }
                      }
                    >
                      <span
                        className="relative z-10 flex h-8 w-8 items-center justify-center"
                        style={{ color: isActive ? 'rgba(245,247,255,0.92)' : 'rgba(222,228,255,0.68)' }}
                      >
                        <Icon size={22} strokeWidth={1.45} />
                      </span>
                    </div>
                  );
                }}
              </NavLink>
            </motion.div>
          ))}
        </motion.nav>

        <div className="relative z-10 flex w-full shrink-0 justify-center pb-[28px] pt-4">
          <a href="/auth/logout" aria-label="Logout" title="Logout" className="block">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[10px]"
              style={{ color: 'rgba(222,228,255,0.66)' }}
            >
              <LogOut size={22} strokeWidth={1.45} />
            </div>
          </a>
        </div>
      </motion.aside>
    </>
  );
};

export default Sidebar;
