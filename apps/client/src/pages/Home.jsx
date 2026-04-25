import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Activity, Layers, ArrowRight } from 'lucide-react';
import PublicNavbar from '../components/layout/PublicNavbar';

const features = [
  {
    title: 'Unified AI Gateway',
    description: 'Route tools through one endpoint and manage providers without changing your client integrations.',
    icon: Layers,
  },
  {
    title: 'Real-Time Visibility',
    description: 'Track requests, errors, and latency from a single dashboard designed for operational clarity.',
    icon: Activity,
  },
  {
    title: 'Access Control',
    description: 'Protect usage with local access keys and provider-level controls for safe team operations.',
    icon: Shield,
  },
];

function Home() {
  return (
    <div className="min-h-screen bg-[--color-bg-page] px-4 pb-12 text-[--color-text-primary] sm:px-6 lg:px-8">
      <PublicNavbar />

      <main className="mx-auto mt-10 w-full max-w-6xl">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-3xl border p-8 sm:p-12"
          style={{
            borderColor: 'var(--color-glass-border)',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(10,14,24,0.85) 70%)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <p className="label-caps mb-3">AI Proxy WebApp</p>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">One endpoint for all your model traffic.</h1>
          <p className="mt-5 max-w-2xl text-base text-[--color-text-secondary] sm:text-lg">
            AI Proxy helps you centralize routing, monitor usage, and keep integrations stable while switching providers behind the scenes.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/auth/google"
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
              style={{ background: 'var(--gradient-neon)' }}
            >
              Open Dashboard
              <ArrowRight size={16} />
            </a>
            <Link
              to="/about"
              className="inline-flex items-center rounded-xl border px-5 py-3 text-sm font-semibold text-[--color-text-primary]"
              style={{ borderColor: 'var(--color-border-strong)' }}
            >
              Learn More
            </Link>
          </div>
        </motion.section>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + idx * 0.08 }}
                className="rounded-2xl border p-5"
                style={{
                  borderColor: 'var(--color-border-strong)',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                }}
              >
                <div
                  className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'var(--gradient-neon)' }}
                >
                  <Icon size={18} />
                </div>
                <h3 className="text-lg font-bold">{feature.title}</h3>
                <p className="mt-2 text-sm text-[--color-text-secondary]">{feature.description}</p>
              </motion.article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

export default Home;
