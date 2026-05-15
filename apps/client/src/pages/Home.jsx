import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Gauge,
  KeyRound,
  Layers,
  LockKeyhole,
  Route,
  ServerCog,
  Shield,
  TerminalSquare,
} from 'lucide-react';
import PublicNavbar from '../components/layout/PublicNavbar';
import PublicFooter from '../components/layout/PublicFooter';
import heroIllustration from '../assets/hero.png';

const features = [
  {
    title: 'One OpenAI-compatible surface',
    description: 'Keep your local tools pointed at one base URL while provider settings move behind the bridge.',
    icon: Route,
    accent: '#6366f1',
  },
  {
    title: 'Live request telemetry',
    description: 'Watch volume, latency, tokens, models, errors, and provider behavior as traffic moves.',
    icon: Activity,
    accent: '#06b6d4',
  },
  {
    title: 'Local key boundary',
    description: 'Keep upstream credentials server-side and hand tools a controlled local access key.',
    icon: Shield,
    accent: '#ec4899',
  },
];

const stats = [
  { value: '/v1', label: 'local API surface' },
  { value: '30s', label: 'log refresh rhythm' },
  { value: '0', label: 'secrets in browser code' },
];

const pipeline = [
  { label: 'Client tool', detail: 'Kilo Code, Claude Code, SDKs', icon: TerminalSquare },
  { label: 'AI Proxy', detail: 'Auth, logs, routing', icon: ServerCog },
  { label: 'Provider', detail: 'Compatible API', icon: Layers },
];

const consoleRows = [
  { method: 'POST', model: 'claude-sonnet-4.6', ms: '842ms', status: '200', tone: 'indigo' },
  { method: 'GET', model: 'models sync', ms: '113ms', status: '200', tone: 'cyan' },
  { method: 'POST', model: 'claude-opus-4.6', ms: '1.8s', status: '200', tone: 'rose' },
];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.15 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

function Home() {
  return (
    <div
      className="h-screen overflow-y-auto text-[--color-text-primary]"
      style={{
        background:
          'radial-gradient(circle at 12% 12%, rgba(99, 102, 241, 0.24), transparent 30%), radial-gradient(circle at 86% 8%, rgba(168, 85, 247, 0.2), transparent 28%), linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)',
      }}
    >
      <PublicNavbar />

      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={container}
          className="relative min-h-[calc(100dvh-5rem)] overflow-hidden pt-24 sm:pt-28 pb-8"
        >
          <div className="pointer-events-none absolute right-[-6rem] top-16 hidden w-[34rem] opacity-45 lg:block">
            <img src={heroIllustration} alt="" className="w-full" />
          </div>

          <motion.div variants={fadeUp} className="relative z-10 max-w-3xl">
            <h1 className="max-w-3xl font-['Sora'] text-5xl font-black leading-[1.02] text-white sm:text-6xl lg:text-7xl" style={{ letterSpacing: 0 }}>
              Route every model request through one sharp local bridge.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              AI Proxy WebApp gives your tools a stable endpoint, keeps provider credentials tucked away, and turns raw request traffic into a dashboard you can actually operate from.
            </p>

            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/login"
                className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-bold text-slate-950 transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_14px_30px_-8px_rgba(0,0,0,0.45)]"
                style={{
                  background: 'linear-gradient(135deg, #67e8f9 0%, #2dd4bf 100%)',
                  boxShadow: '0 8px 22px rgba(45, 212, 191, 0.18)',
                }}
              >
                <span className="relative z-10 flex items-center gap-2">
                  Open Dashboard
                  <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </Link>
              <Link
                to="/about"
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl border border-white/20 px-6 py-3.5 text-sm font-bold text-white transition-all duration-300 hover:-translate-y-[2px] hover:border-white/35 hover:bg-white/[0.08] hover:shadow-[0_14px_30px_-8px_rgba(0,0,0,0.4)]"
              >
                About the bridge
                <ArrowRight size={15} className="text-indigo-400 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </motion.div>
          </motion.div>

          <motion.div variants={fadeUp} className="relative z-10 mt-12 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <motion.div
              variants={fadeUp}
              className="rounded-xl border border-white/12 bg-white/[0.055] p-5 shadow-2xl backdrop-blur-xl sm:p-6 transition-shadow duration-500 hover:shadow-[0_0_40px_-8px_rgba(99,102,241,0.2)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-bold uppercase text-slate-400">Routing Deck</p>
                  <p className="mt-1 font-['Sora'] text-xl font-black text-white" style={{ letterSpacing: 0 }}>localhost:3000/v1</p>
                </div>
                <span className="rounded-lg bg-indigo-300/15 px-3 py-1.5 text-xs font-black text-indigo-100 animate-pulse">online</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {pipeline.map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.label} className="relative rounded-lg border border-white/10 bg-slate-950/40 p-4 transition-colors duration-300 hover:border-indigo-400/20">
                      {idx < pipeline.length - 1 && <div className="absolute right-[-18px] top-1/2 hidden h-px w-8 bg-indigo-300/45 sm:block" />}
                      <Icon size={20} className="text-indigo-200" />
                      <p className="mt-4 text-sm font-black text-white">{step.label}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{step.detail}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 space-y-2">
                {consoleRows.map((row) => (
                  <div key={`${row.method}-${row.model}`} className="grid grid-cols-[56px_minmax(0,1fr)_64px_48px] items-center gap-3 rounded-lg border border-white/8 bg-black/24 px-3 py-3 text-xs transition-colors duration-300 hover:border-white/14">
                    <span className="font-mono font-bold text-slate-400">{row.method}</span>
                    <span className="truncate font-mono text-slate-200">{row.model}</span>
                    <span className="font-mono text-slate-400">{row.ms}</span>
                    <span className={`text-right font-mono font-black ${row.tone === 'indigo' ? 'text-indigo-300' : row.tone === 'cyan' ? 'text-cyan-300' : 'text-rose-300'}`}>{row.status}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {stats.map((stat, idx) => (
                <motion.div
                  key={stat.label}
                  variants={fadeUp}
                  className="rounded-lg border border-white/12 bg-white/[0.045] p-5 backdrop-blur transition-all duration-300 hover:border-indigo-400/20 hover:bg-white/[0.06]"
                >
                  <p className="font-['Sora'] text-3xl font-black text-white" style={{ letterSpacing: 0 }}>{stat.value}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-400">{stat.label}</p>
                </motion.div>
              ))}
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
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <motion.article
                key={feature.title}
                variants={fadeUp}
                className="group rounded-xl border border-white/10 bg-white/[0.045] p-6 transition-all duration-300 hover:border-indigo-300/30 hover:bg-white/[0.06] hover:shadow-[0_0_32px_-8px_rgba(99,102,241,0.15)] hover:-translate-y-0.5"
              >
                <div
                  className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg text-white transition-transform duration-300 group-hover:scale-110"
                  style={{ background: feature.accent }}
                >
                  <Icon size={18} />
                </div>
                <h3 className="text-lg font-black text-white">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{feature.description}</p>
              </motion.article>
            );
          })}
        </motion.section>

        <motion.section
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={container}
          className="grid gap-4 border-t border-white/10 py-8 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <motion.div variants={fadeUp}>
            <p className="text-xs font-black uppercase text-indigo-200">From setup to signal</p>
            <h2 className="mt-3 font-['Sora'] text-3xl font-black text-white sm:text-4xl" style={{ letterSpacing: 0 }}>A quieter way to run noisy AI traffic.</h2>
          </motion.div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: KeyRound, title: 'Configure once', text: 'Set upstream base URL, provider key, local key, and model defaults from the dashboard.' },
              { icon: Gauge, title: 'Measure continuously', text: 'Recent traffic, model distribution, request volume, and latency stay visible while you work.' },
              { icon: LockKeyhole, title: 'Protect credentials', text: 'Client tools authenticate locally, while provider tokens remain on the server side.' },
              { icon: CheckCircle2, title: 'Keep clients steady', text: 'Swap providers or sync models without rewriting every local AI integration.' },
            ].map((item, idx) => {
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
      </main>

      <PublicFooter />
    </div>
  );
}

export default Home;
