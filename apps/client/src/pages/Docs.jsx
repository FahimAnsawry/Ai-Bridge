import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Route,
  TerminalSquare,
} from 'lucide-react';
import PublicNavbar from '../components/layout/PublicNavbar';
import PublicFooter from '../components/layout/PublicFooter';


const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

function CodeBlock({ children }) {
  return (
    <pre className="mt-4 w-full min-w-0 max-w-full overflow-x-auto rounded-xl border border-white/12 bg-slate-950/55 p-3.5 sm:p-4 text-xs font-semibold leading-6 text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <code className="block whitespace-pre-wrap break-all">{children}</code>
    </pre>
  );
}

function Docs({ user }) {
  const currentBaseUrl = typeof window !== 'undefined'
        ? (window.location.origin.includes('localhost')
        ? 'https://ai-bridge-zag2.onrender.com/v1'
        : `${window.location.origin.replace(/\/+$/, '')}/v1`)
    : 'https://ai-bridge-zag2.onrender.com/v1';

  const sections = [
    {
      icon: Route,
      title: 'Route models',
      cardClass: 'border-rose-200/22 bg-rose-950/22 hover:border-rose-200/42 hover:bg-rose-950/30',
      iconClass: 'bg-rose-400 text-white',
      dotClass: 'bg-rose-300',
      body: 'Use the Routes button on a provider card to attach model IDs to that provider. Claude CLI requests keep the model name they ask for; the proxy uses your route to choose where that exact model goes.',
      code: 'claude-sonnet-4-6 -> Cpass\ngpt-5.5 -> SwiftRouter\ndeepseek-v4-pro -> AgentRouter, MirrorCore',
      notes: ['Put fallback providers in priority order when a model can run in more than one place.', 'If model routes exist, requested models must be added before use.'],
    },
  ];

  const content = (
    <main className={`mx-auto w-full max-w-6xl px-4 pb-12 ${user ? 'pt-4' : 'pt-24 sm:pt-28'} sm:px-6 lg:px-8`}>
      <motion.section
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08, delayChildren: 0.08 } },
        }}
        className="grid gap-8"
      >
        <motion.header variants={fadeUp} className="max-w-3xl">
          <h1
            className="text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl"
          >
            Use AI Proxy Bridge with Claude CLI
          </h1>
          <p className="mt-5 text-base font-medium leading-8 text-slate-300">
            Point Claude CLI at the local `/v1/messages` proxy, keep provider keys in the dashboard,
            and control exactly which upstream handles each model.
          </p>
        </motion.header>

        <motion.div variants={fadeUp} className="grid gap-6 min-w-0 lg:grid-cols-2">
          <section className="min-w-0 rounded-xl border border-cyan-200/24 bg-cyan-950/24 p-4 shadow-2xl backdrop-blur-xl sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
                <TerminalSquare size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100">Environment</p>
                <h2 className="text-xl font-black text-white">SETTINGS.JSON</h2>
              </div>
            </div>

            <CodeBlock>{`// ~/.claude.json or ~/.config/claude/SETTINGS.JSON
{
  "env": {
    "ANTHROPIC_BASE_URL": "${currentBaseUrl}",
    "ANTHROPIC_AUTH_TOKEN": "<your Bridge access key>",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_USER_ID_IN_TELEMETRY": "1"
  }
}`}</CodeBlock>
          </section>

          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <article
                key={section.title}
                className={`min-w-0 rounded-xl border p-4 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all duration-300 ${section.cardClass}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${section.iconClass}`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white">{section.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{section.body}</p>
                  </div>
                </div>

                <CodeBlock>{section.code}</CodeBlock>

                <div className="mt-4 grid gap-2 min-w-0 w-full">
                  {section.notes.map((note) => (
                    <div key={note} className="flex items-start gap-2 text-xs font-semibold leading-5 text-slate-400 min-w-0 w-full">
                      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${section.dotClass}`} />
                      <span className="break-all min-w-0 flex-1">{note}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </motion.div>

        <motion.section
          variants={fadeUp}
          className="rounded-xl border border-amber-200/20 bg-amber-300/10 p-4 sm:p-6 text-sm leading-7 text-amber-50"
        >
          <p className="font-black uppercase tracking-[0.16em] text-amber-100">Common checks</p>
          <p className="mt-2">
            If Claude CLI connects but stops after a response, check Logs for upstream status codes, confirm the model
            is routed to a provider that supports Claude-style `/messages`, and verify the Bridge key in Claude CLI
            matches the access key shown in Settings.
          </p>
        </motion.section>
      </motion.section>
    </main>
  );

  if (user) {
    return content;
  }

  return (
    <div
      className="min-h-dvh overflow-x-hidden text-[--color-text-primary]"
      style={{
        background:
          'radial-gradient(circle at 12% 12%, rgba(99, 102, 241, 0.24), transparent 30%), radial-gradient(circle at 86% 8%, rgba(168, 85, 247, 0.2), transparent 28%), linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)',
      }}
    >
      <PublicNavbar />
      {content}
      <PublicFooter />
    </div>
  );
}

export default Docs;
