import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Database,
  Gauge,
  GitBranch,
  KeyRound,
  Route,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import PublicNavbar from '../components/layout/PublicNavbar';
import PublicFooter from '../components/layout/PublicFooter';

const highlights = [
  {
    title: 'Provider abstraction',
    description: 'One local integration can point at SwiftRouter or another OpenAI-compatible upstream.',
    icon: Route,
    color: '#6366f1',
  },
  {
    title: 'Operational memory',
    description: 'Request logs, token usage, latency, status codes, and model activity stay available for review.',
    icon: Gauge,
    color: '#06b6d4',
  },
  {
    title: 'Credential containment',
    description: 'Local tools receive a proxy key while sensitive upstream API keys remain in server configuration.',
    icon: ShieldCheck,
    color: '#ec4899',
  },
];

const architecture = [
  { title: 'Local clients', text: 'Editors, agents, extensions, and SDKs send OpenAI-compatible requests.', icon: GitBranch },
  { title: 'Express proxy', text: 'Authentication, provider routing, logging, streaming, and error handling run server-side.', icon: ServerCog },
  { title: 'Mongo-backed history', text: 'Request records create the dashboard activity feed and analytics surface.', icon: Database },
  { title: 'React dashboard', text: 'Settings, models, logs, and overview panels give the bridge an operator console.', icon: SlidersHorizontal },
];

const principles = [
  { label: 'Keep integrations boring', detail: 'A stable base URL is easier to trust than a pile of per-tool provider edits.' },
  { label: 'Make traffic visible', detail: 'The dashboard favors current operating signals over decorative reporting.' },
  { label: 'Put secrets behind glass', detail: 'Provider credentials belong on the backend, not scattered through local clients.' },
];

const heroSignals = [
  { label: 'Route once', value: 'one local endpoint', icon: Route, tone: 'rgba(99, 102, 241, 0.22)' },
  { label: 'See traffic', value: 'logs, latency, tokens', icon: Activity, tone: 'rgba(6, 182, 212, 0.18)' },
  { label: 'Keep keys inside', value: 'provider secrets stay server-side', icon: ShieldCheck, tone: 'rgba(236, 72, 153, 0.18)' },
];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

function About() {
  return (
    <div
      className="min-h-dvh overflow-x-hidden text-[--color-text-primary]"
      style={{
        background:
          'radial-gradient(circle at 15% 8%, rgba(99, 102, 241, 0.22), transparent 30%), radial-gradient(circle at 78% 2%, rgba(168, 85, 247, 0.2), transparent 28%), linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)',
      }}
    >
      <PublicNavbar />

      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={container}
          className="relative overflow-hidden pt-24 sm:pt-28 pb-10 sm:pb-14"
        >
          <motion.div
            variants={fadeUp}
            className="relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.055] p-6 shadow-2xl backdrop-blur-xl transition-shadow duration-500 hover:shadow-[0_0_40px_-8px_rgba(99,102,241,0.15)] sm:p-8 lg:p-10"
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 0% 0%, rgba(99,102,241,0.22), transparent 28%), radial-gradient(circle at 100% 100%, rgba(6,182,212,0.14), transparent 26%)',
              }}
            />

            <div className="relative grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div className="max-w-3xl">
                <h1 className="font-['Sora'] text-5xl font-black leading-[1.04] text-white sm:text-6xl" style={{ letterSpacing: 0 }}>
                  A local bridge for people who keep changing models.
                </h1>
                <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                  This project sits between AI clients and upstream providers so experimentation stays flexible, observable, and easier to secure. It is built for local workflows where routing, logs, keys, and model availability need to be in one place.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    to="/login"
                    className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-bold text-slate-950 transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_28px_-4px_rgba(45,212,191,0.5)]"
                    style={{
                      background: 'linear-gradient(135deg, #67e8f9 0%, #2dd4bf 100%)',
                      boxShadow: '0 12px 30px rgba(45, 212, 191, 0.22)',
                    }}
                  >
                    Open Dashboard
                    <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    to="/"
                    className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl border border-indigo-400/25 px-6 py-3.5 text-sm font-bold text-indigo-100 transition-all duration-300 hover:border-indigo-400/50 hover:bg-indigo-500/10 hover:shadow-[0_0_24px_-6px_rgba(99,102,241,0.3)] hover:scale-[1.02]"
                  >
                    <ArrowLeft size={15} className="text-indigo-400 transition-transform duration-300 group-hover:-translate-x-0.5" />
                    Home
                  </Link>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/28 p-4 transition-colors duration-300 hover:border-indigo-400/20">
                  <p className="text-xs font-black uppercase text-indigo-200">What the bridge does</p>
                  <p className="mt-3 font-['Sora'] text-2xl font-black text-white" style={{ letterSpacing: 0 }}>
                    Stabilize the client side while the provider side keeps moving.
                  </p>
                </div>

                {heroSignals.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="group grid grid-cols-[44px_minmax(0,1fr)] items-center gap-4 rounded-xl border border-white/10 bg-black/18 px-4 py-4 transition-all duration-300 hover:border-white/14">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-white transition-transform duration-300 group-hover:scale-110"
                        style={{ background: item.tone }}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase text-slate-400">{item.label}</p>
                        <p className="mt-1 text-sm font-semibold leading-6 text-slate-200">{item.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.section>

        <motion.section
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={container}
          className="grid grid-cols-1 gap-4 py-8 md:grid-cols-3"
        >
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <motion.article
                key={item.title}
                variants={fadeUp}
                className="group rounded-xl border border-white/10 bg-white/[0.045] p-6 transition-all duration-300 hover:border-indigo-300/30 hover:bg-white/[0.06] hover:shadow-[0_0_32px_-8px_rgba(99,102,241,0.15)] hover:-translate-y-0.5"
              >
                <div
                  className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg text-white transition-transform duration-300 group-hover:scale-110"
                  style={{ background: item.color }}
                >
                  <Icon size={18} />
                </div>
                <h3 className="text-lg font-black text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{item.description}</p>
              </motion.article>
            );
          })}
        </motion.section>

        <motion.section
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={container}
          className="grid gap-4 border-t border-white/10 py-8 lg:grid-cols-[0.82fr_1.18fr]"
        >
          <motion.div variants={fadeUp}>
            <p className="text-xs font-black uppercase text-indigo-200">How it is wired</p>
            <h2 className="mt-3 font-['Sora'] text-3xl font-black text-white sm:text-4xl" style={{ letterSpacing: 0 }}>Small pieces, clear responsibilities.</h2>
            <p className="mt-4 text-sm leading-7 text-slate-400">
              The app keeps route handlers thin and pushes provider, auth, proxy, and logging behavior into services, so the dashboard can stay focused on operating the bridge.
            </p>
          </motion.div>
          <div className="grid gap-3 sm:grid-cols-2">
            {architecture.map((item) => {
              const Icon = item.icon;
              return (
                <motion.article
                  key={item.title}
                  variants={fadeUp}
                  className="group rounded-lg border border-white/10 bg-slate-950/30 p-4 transition-all duration-300 hover:border-indigo-400/20 hover:bg-slate-950/40"
                >
                  <Icon size={18} className="text-indigo-300 transition-transform duration-300 group-hover:scale-110" />
                  <h3 className="mt-3 text-base font-black text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.text}</p>
                </motion.article>
              );
            })}
          </div>
        </motion.section>

        <motion.section
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={container}
          className="grid gap-4 border-t border-white/10 py-8 lg:grid-cols-3"
        >
          {principles.map((item) => (
            <motion.article
              key={item.label}
              variants={fadeUp}
              className="group rounded-lg border border-white/10 bg-white/[0.04] p-5 transition-all duration-300 hover:border-indigo-400/20 hover:bg-white/[0.06]"
            >
              <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 text-white transition-transform duration-300 group-hover:scale-110">
                <KeyRound size={17} />
              </div>
              <h3 className="text-base font-black text-white">{item.label}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{item.detail}</p>
            </motion.article>
          ))}
        </motion.section>
      </main>

      <PublicFooter />
    </div>
  );
}

export default About;
