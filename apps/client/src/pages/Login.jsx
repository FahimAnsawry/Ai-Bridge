import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck, UserRound, Zap } from 'lucide-react';
import PublicFooter from '../components/layout/PublicFooter';

function Login() {
  return (
    <div
      className="h-screen w-screen overflow-y-auto px-4 py-6 text-[--color-text-primary] sm:px-6"
      style={{
        background:
          'radial-gradient(circle at 18% 12%, rgba(99, 102, 241, 0.24), transparent 30%), radial-gradient(circle at 82% 8%, rgba(168, 85, 247, 0.2), transparent 28%), linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)',
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white"
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 54%, #06b6d4 100%)',
                boxShadow: '0 0 24px rgba(99, 102, 241, 0.34)',
              }}
            >
              <Zap size={18} fill="currentColor" />
            </span>
            <span className="font-bold text-white" style={{ letterSpacing: 0 }}>AI Proxy</span>
          </Link>

          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm font-bold text-white transition-all duration-300 hover:-translate-y-[2px] hover:border-white/35 hover:bg-white/[0.08] hover:shadow-[0_14px_30px_-8px_rgba(0,0,0,0.4)]"
          >
            <ArrowLeft size={15} />
            Home
          </Link>
        </header>

        <main className="grid flex-1 items-center gap-8 py-12 lg:grid-cols-[1fr_0.86fr]">
          <motion.section
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="max-w-2xl"
          >
            <h1 className="font-['Sora'] text-5xl font-black leading-[1.04] text-white sm:text-6xl" style={{ letterSpacing: 0 }}>
              Sign in before opening the control room.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
              Use Google authentication to access provider settings, request logs, model sync, and local access key controls.
            </p>

            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
                <KeyRound size={18} className="text-indigo-300" />
                <p className="mt-3 text-sm font-black text-white">Provider keys stay server-side</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
                <ShieldCheck size={18} className="text-cyan-300" />
                <p className="mt-3 text-sm font-black text-white">Dashboard actions stay authenticated</p>
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="rounded-lg border border-white/12 bg-white/[0.055] p-5 shadow-2xl backdrop-blur-xl sm:p-6"
          >
            <div className="border-b border-white/10 pb-5">
              <p className="text-xs font-bold uppercase text-slate-400">Login</p>
              <h2 className="mt-2 font-['Sora'] text-2xl font-black text-white" style={{ letterSpacing: 0 }}>Continue to AI Proxy</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">Choose Google sign-in or continue with the local guest account stored in server files.</p>
            </div>

            <a
              href="/auth/google"
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg px-4 py-3 text-sm font-black text-slate-950 shadow-sm transition-all hover:brightness-[1.03] focus:outline-none focus:ring-4 focus:ring-cyan-300/20"
              style={{
                background: 'linear-gradient(135deg, #67e8f9 0%, #2dd4bf 100%)',
                boxShadow: '0 12px 30px rgba(45, 212, 191, 0.18)',
              }}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
              <ArrowRight size={16} />
            </a>

            <a
              href="/auth/guest"
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-lg border border-cyan-200/22 bg-white/5 px-4 py-3 text-sm font-bold text-cyan-50 transition-colors duration-200 hover:border-cyan-200/42 hover:bg-cyan-300/10 focus:outline-none focus:ring-4 focus:ring-cyan-300/15"
            >
              <UserRound size={18} />
              Continue as Guest
            </a>

          </motion.section>
        </main>

        <PublicFooter />
      </div>
    </div>
  );
}

export default Login;
