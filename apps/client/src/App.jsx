import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import Sidebar from './components/layout/Sidebar';
import BottomNav from './components/layout/BottomNav';
import Overview from './pages/Overview';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Models from './pages/Models';
import Login from './pages/Login';
import Home from './pages/Home';
import About from './pages/About';
import Docs from './pages/Docs';
import { fetchAuthStatus } from './api';
import { queryKeys } from './api/queryKeys';
import { ToastProvider, useToast } from './context/ToastContext';
import { LiveLogsProvider } from './context/LiveLogsContext';

const SIDEBAR_WIDTH = 80;

function AppLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-4 text-[--color-text-primary] overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative flex flex-col items-center justify-center rounded-2xl px-8 py-10 text-center max-w-sm w-full"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
          backdropFilter: 'blur(22px)',
          border: '1px solid rgba(255,255,255,0.22)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
        }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 55%)' }} />
        
        {/* Pulsing Glowing Circle around Zap */}
        <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl" style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
          <motion.div
            className="absolute inset-0 rounded-2xl"
            style={{ background: 'rgba(99,102,241,0.1)' }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 0.8, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <Zap size={36} className="relative z-10 text-indigo-300" />
        </div>

        <h3 className="text-lg font-bold tracking-tight text-white mb-1">
          AI Proxy
        </h3>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 mb-6">
          Bridge
        </p>

        {/* Linear Loading Progress Indicator */}
        <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden relative">
          <motion.div
            className="absolute top-0 bottom-0 left-0 bg-indigo-500 rounded-full"
            style={{ width: '40%' }}
            animate={{
              left: ['-40%', '100%'],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}

function AppContent() {
  const [isModalWindowVisible, setIsModalWindowVisible] = useState(false);
  const { showToast } = useToast();
  const location = useLocation();
  const mainRef = useRef(null);
  const isSettingsPage = location.pathname === '/settings';
  const isDashboardPage = location.pathname === '/dashboard';

  const [hasSessionHint, setHasSessionHint] = useState(() => {
    return localStorage.getItem('auth_verified') === 'true';
  });

  const authQuery = useQuery({
    queryKey: queryKeys.authStatus(),
    queryFn: fetchAuthStatus,
    retry: false,
    staleTime: 60_000,
  });
  const user = authQuery.data?.user || null;
  const loading = authQuery.isPending;

  // Sync session hint with successful auth query
  useEffect(() => {
    if (authQuery.isSuccess) {
      if (authQuery.data?.user) {
        localStorage.setItem('auth_verified', 'true');
        setHasSessionHint(true);
      } else {
        localStorage.removeItem('auth_verified');
        setHasSessionHint(false);
      }
    }
  }, [authQuery.isSuccess, authQuery.data]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if(mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if(params.get('login') === 'success') {
      const isFirst = params.get('first') === 'true';
      showToast(isFirst ? 'Login successful' : 'Welcome back!', 'success');
      localStorage.setItem('auth_verified', 'true');
      setHasSessionHint(true);
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    if (params.get('logout') === 'success') {
      showToast('Signed out successfully', 'success');
      localStorage.removeItem('auth_verified');
      setHasSessionHint(false);
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [showToast]);

  // If auth is loading and we don't have a session hint, show the global loading screen
  if (loading && !hasSessionHint) {
    return <AppLoading />;
  }

  // If auth finished and there's no user, show public landing/login pages
  if (!loading && !user) {
    return (
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/about' element={<About />} />
        <Route path='/docs' element={<Docs user={user} />} />
        <Route path='/login' element={<Login />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    );
  }

  return (
    <LiveLogsProvider user={user}>
<div className='flex h-dvh text-[--color-text-primary] overflow-hidden' style={{ background: 'linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)' }}>

      {!isModalWindowVisible && (
        <Sidebar
          desktopWidth={SIDEBAR_WIDTH}
          user={user}
        />
      )}

      <main ref={mainRef} className={`relative z-10 flex-1 min-w-0 min-h-0 px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-6 sm:px-8 sm:pt-6 md:pb-12 lg:pt-6 transition-all duration-300 ${isSettingsPage ? 'overflow-y-auto' : isDashboardPage ? 'lg:overflow-hidden overflow-y-auto' : 'overflow-y-auto'}`}>
        <div className={`mx-auto w-full max-w-[92rem] ${isDashboardPage ? 'lg:h-full lg:min-h-0 lg:overflow-hidden' : ''}`}>
          <Routes>
            <Route path='/' element={<Navigate to="/dashboard" replace />} />
<Route path='/dashboard' element={<Overview user={user} />} />
            <Route path='/settings' element={<Settings user={user} onModalVisibilityChange={setIsModalWindowVisible} />} />
            <Route path='/logs' element={<Logs user={user} onModalVisibilityChange={setIsModalWindowVisible} />} />
            <Route path='/models' element={<Models user={user} />} />
            <Route path='/docs' element={<Docs user={user} />} />
            <Route path='*' element={<Navigate to='/dashboard' replace />} />
          </Routes>
        </div>
      </main>

      {!isModalWindowVisible && <BottomNav />}
    </div>
    </LiveLogsProvider>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;












