import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Sidebar from './components/layout/Sidebar';
import Overview from './pages/Overview';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Models from './pages/Models';
import SetupGuide from './pages/SetupGuide';
import Login from './pages/Login';
import Home from './pages/Home';
import About from './pages/About';
import { fetchAuthStatus } from './api';
import { ToastProvider, useToast } from './context/ToastContext';

const SIDEBAR_WIDTH = 80;

function AppContent() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    fetchAuthStatus()
      .then((data) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // console.log('Current URL params:', params.toString());
    if (params.get('login') === 'success') {
      // console.log('Login success detected');
      const isFirst = params.get('first') === 'true';
      showToast(isFirst ? 'Login successful' : 'Welcome back!', 'success');
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    if (params.get('logout') === 'success') {
      // console.log('Logout success detected');
      showToast('Signed out successfully', 'success');
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [showToast]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-[--color-bg-page] text-[--color-text-primary]">Loading...</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/about' element={<About />} />
        <Route path='/login' element={<Login />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    );
  }

  return (
    <div className='flex h-screen bg-[--color-bg-page] text-[--color-text-primary] overflow-hidden'>

      <Sidebar
        desktopWidth={SIDEBAR_WIDTH}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onToggleMobile={() => setMobileNavOpen((value) => !value)}
        user={user}
      />

      <main className='relative z-10 flex-1 min-w-0 min-h-0 px-4 pb-8 pt-24 sm:px-8 sm:pb-12 sm:pt-28 lg:pt-10 transition-all duration-300 overflow-y-auto'>
        <div className='mx-auto w-full max-w-[92rem]'>
          <AnimatePresence mode='wait'>
            <Routes>
              <Route path='/' element={<Navigate to="/dashboard" replace />} />
              <Route path='/dashboard' element={<Overview user={user} />} />
              <Route path='/settings' element={<Settings user={user} />} />
              <Route path='/logs' element={<Logs user={user} />} />
              <Route path='/models' element={<Models user={user} />} />
              <Route path='/setup' element={<SetupGuide user={user} />} />
              <Route path='*' element={<Navigate to='/dashboard' replace />} />
            </Routes>
          </AnimatePresence>
        </div>
      </main>
    </div>
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

