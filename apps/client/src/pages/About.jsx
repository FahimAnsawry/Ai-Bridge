import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Route, Gauge, ShieldCheck, ArrowLeft } from 'lucide-react';
import PublicNavbar from '../components/layout/PublicNavbar';

const highlights = [
  {
    title: 'Provider Abstraction',
    description: 'Keep one client integration while choosing providers and model mapping from your control panel.',
    icon: Route,
  },
  {
    title: 'Performance Insight',
    description: 'Monitor latency, request volume, and errors with built-in dashboard analytics and live logs.',
    icon: Gauge,
  },
  {
    title: 'Secure-by-Default Controls',
    description: 'Use local access keys and scoped settings to keep your proxy usage protected and auditable.',
    icon: ShieldCheck,
  },
];

function About() {
  return (
    <div className="min-h-screen bg-[--color-bg-page] px-4 pb-12 text-[--color-text-primary] sm:px-6 lg:px-8">
      <PublicNavbar />

      <main className="mx-auto mt-10 w-full max-w-6xl">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="rounded-3xl border p-8 sm:p-12"
          style={{
            borderColor: 'var(--color-glass-border)',
            background: 'linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(10,14,24,0.86) 70%)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <p className="label-caps mb-3">About this project</p>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Built for reliable AI routing at scale.</h1>
          <p className="mt-5 max-w-3xl text-base text-[--color-text-secondary] sm:text-lg">
            AI Proxy WebApp is a local bridge between AI clients and upstream providers. It gives you one stable API surface,
            operational visibility, and centralized configuration so integrations stay consistent as models and providers evolve.
          </p>
        </motion.section>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {highlights.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1 + idx * 0.08 }}
                className="rounded-2xl border p-5"
                style={{
                  borderColor: 'var(--color-border-strong)',
                  background: 'var(--color-bg-panel)',
                }}
              >
                <div
                  className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'var(--gradient-neon-3)' }}
                >
                  <Icon size={18} />
                </div>
                <h3 className="text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm text-[--color-text-secondary]">{item.description}</p>
              </motion.article>
            );
          })}
        </section>

        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold text-[--color-text-primary]"
            style={{ borderColor: 'var(--color-border-strong)' }}
          >
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}

export default About;
