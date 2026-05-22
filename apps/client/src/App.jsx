import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import OverviewSkeleton from './components/dashboard/OverviewSkeleton';
import SettingsSkeleton from './components/settings/SettingsSkeleton';
import { fetchAuthStatus} from './api';
import { queryKeys } from './api/queryKeys';
import { ToastProvider, useToast } from './context/ToastContext';
import { LiveLogsProvider } from './context/LiveLogsContext';

const SIDEBAR_WIDTH = 80;
const PROTECTED_ROUTES = ['/dashboard','/settings', '/logs', '/models'];

function DashboardLoadingShell({currentPath }) {
  const isSettingsPage = currentPath === '/settings';
  const isDashboardPage = currentPath === '/dashboard';

  return (
    <div
      className="flex h-dvhoverflow-hidden text-[--color-text-primary]"
      style={{ background: 'linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583100%)' }}
    >
      <Sidebar
        desktopWidth={SIDEBAR_WIDTH}
        mobileOpen={false}
        onCloseMobile={() => {}}
        onToggleMobile={() => {}}
/>

      <main className={`relative z-10 flex-1 min-w-0 min-h-0 px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-18 sm:px-8 sm:pt-20 md:pb-12 lg:pt-10 transition-all duration-300 ${isSettingsPage ? 'overflow-y-auto' : isDashboardPage ?'lg:overflow-hidden overflow-y-auto' : 'overflow-y-auto'}`}>
        <div className={`mx-auto w-full max-w-[92rem] ${isDashboardPage ? 'lg:h-full lg:min-h-0 lg:overflow-hidden' : ''}`}>
          {isSettingsPage ? <SettingsSkeleton /> : isDashboardPage ? <OverviewSkeleton /> : null}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

function AppContent() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isModalWindowVisible, setIsModalWindowVisible] = useState(false);
  const { showToast } = useToast();
  const location = useLocation();
  const mainRef = useRef(null);
  const isSettingsPage = location.pathname === '/settings';
  const isDashboardPage = location.pathname === '/dashboard';
  const isProtectedRoute = PROTECTED_ROUTES.some((path) => location.pathname.startsWith(path));
  const authQuery = useQuery({
    queryKey: queryKeys.authStatus(),
    queryFn: fetchAuthStatus,
    retry: false,
    staleTime: 60_000,
  });
  const user = authQuery.data?.user || null;
  const loading = authQuery.isPending;

  useEffect(() => {
    window.scrollTo(0, 0);
    if(mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if(params.get('login') === 'success') {
      const isFirst = params.get('first') === 'true';
      showToast(isFirst ? 'Login successful' : 'Welcome back!', 'success');
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    if (params.get('logout') === 'success') {
      showToast('Signed out successfully', 'success');
      constnewUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [showToast]);

  useEffect(() => {
    if (isModalWindowVisible) {
      setMobileNavOpen(false);
    }
  }, [isModalWindowVisible]);

  if (loading) {
    if (isProtectedRoute) {
      return <DashboardLoadingShell currentPath={location.pathname} />;
    }

    return <div className="min-h-screen bg-[--color-bg-page]" aria-busy="true" />;
  }

  if (!user) {
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
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
          onToggleMobile={() => setMobileNavOpen((value) => !value)}
          user={user}
        />
      )}

      <main ref={mainRef} className={`relative z-10 flex-1 min-w-0min-h-0 px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-18 sm:px-8 sm:pt-20 md:pb-12 lg:pt-10 transition-all duration-300 ${isSettingsPage ? 'overflow-y-auto' : isDashboardPage ? 'lg:overflow-hidden overflow-y-auto' : 'overflow-y-auto'}`}>
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
