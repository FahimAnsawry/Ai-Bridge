import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  KeyRound,
  Play,
  Route,
  Settings,
  TerminalSquare,
} from 'lucide-react';
import PublicNavbar from '../components/layout/PublicNavbar';
import PublicFooter from '../components/layout/PublicFooter';

const sections = [
  {
    icon: Play,
    title: 'Start the bridge',
    cardClass: 'border-cyan-200/22 bg-cyan-950/26 hover:border-cyan-200/42 hover:bg-cyan-950/34',
    iconClass: 'bg-cyan-300 text-slate-950',
    dotClass: 'bg-cyan-300',
    body: 'Run the backend proxy and the Vite dashboard together from the project root.',
    code: 'npm run dev',
    notes: ['Proxy endpoint: http://localhost:3000/v1', 'Dashboard: http://localhost:5174', 'Dashboard API: http://localhost:3000/api'],
  },
  {
    icon: KeyRound,
    title: 'Get your local access key',
    cardClass: 'border-emerald-200/22 bg-emerald-950/24 hover:border-emerald-200/42 hover:bg-emerald-950/32',
    iconClass: 'bg-emerald-300 text-slate-950',
    dotClass: 'bg-emerald-300',
    body: 'Log in with Google, go to Settings, and grab your base URL and API key from API config.',
    code: 'Base URL: http://localhost:3000/v1\nAPI key: <your Bridge access key>',
    notes: ['Use the Bridge key in Claude CLI, not the upstream provider key.', 'Provider keys stay server-side in Settings.'],
  },
  {
    icon: Settings,
    title: 'Configure providers',
    cardClass: 'border-violet-200/22 bg-violet-950/24 hover:border-violet-200/42 hover:bg-violet-950/32',
    iconClass: 'bg-violet-400 text-white',
    dotClass: 'bg-violet-300',
    body: 'In Settings, add one or more upstream providers. Each provider needs a name, base URL, and API key. Examples include SwiftRouter, Cpass, Anthropic, OpenAI-compatible gateways, or GitHub Copilot.',
    code: 'Provider base URL: https://api.example.com/v1\nProvider API key: sk-...',
    notes: ['Enable providers that should be eligible for routing.', 'Use multiple keys on a provider when you want same-provider key failover.'],
  },
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

const cliSteps = [
  'Set Claude CLI to use the local proxy as its Anthropic-compatible endpoint.',
  'Use your Bridge access key as the Anthropic auth token.',
  'Start Claude with a model ID that exists in Settings -> Model Routing.',
];

const modelExamples = [
  'claude --model claude-sonnet-4-6',
  'claude --model claude-opus-4.6',
  'claude --model gpt-5.5',
];

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

function CodeBlock({ children }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-white/12 bg-slate-950/55 p-4 text-xs font-semibold leading-6 text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <code>{children}</code>
    </pre>
  );
}

function Docs() {
  return (
    <div
      className="h-screen overflow-y-auto text-[--color-text-primary]"
      style={{
        background:
          'radial-gradient(circle at 12% 12%, rgba(99, 102, 241, 0.24), transparent 30%), radial-gradient(circle at 86% 8%, rgba(168, 85, 247, 0.2), transparent 28%), linear-gradient(135deg, #161168 0%, #292373 40%, #3E297A 70%, #522583 100%)',
      }}
    >
      <PublicNavbar />

      <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-24 sm:px-6 sm:pt-28 lg:px-8">
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
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Use AI Proxy Bridge with Claude CLI
            </h1>
            <p className="mt-5 text-base font-medium leading-8 text-slate-300">
              Point Claude CLI at the local `/v1/messages` proxy, keep provider keys in the dashboard,
              and control exactly which upstream handles each model.
            </p>
          </motion.header>

          <motion.div variants={fadeUp} className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-xl border border-cyan-200/24 bg-cyan-950/24 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
                  <TerminalSquare size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100">Environment</p>
                  <h2 className="text-xl font-black text-white">Claude CLI variables</h2>
                </div>
              </div>

              <CodeBlock>{`# macOS / Linux / Git Bash
export ANTHROPIC_BASE_URL="http://localhost:3000/v1"
export ANTHROPIC_AUTH_TOKEN="<your Bridge access key>"

# Windows PowerShell
$env:ANTHROPIC_BASE_URL="http://localhost:3000/v1"
$env:ANTHROPIC_AUTH_TOKEN="<your Bridge access key>"`}</CodeBlock>

              <div className="mt-5 grid gap-3">
                {cliSteps.map((step) => (
                  <div key={step} className="flex gap-3 text-sm leading-6 text-slate-300">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-indigo-200/24 bg-indigo-950/26 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-white">
                  <GitBranch size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-100">Models</p>
                  <h2 className="text-xl font-black text-white">Run with a routed model</h2>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {modelExamples.map((command) => (
                  <code key={command} className="rounded-lg border border-indigo-300/18 bg-indigo-950/38 px-4 py-3 text-xs font-bold text-indigo-50">
                    {command}
                  </code>
                ))}
              </div>

              <p className="mt-5 text-sm leading-6 text-slate-300">
                The model ID should match a model route in Settings. If the route has multiple providers,
                the proxy tries them in priority order when the first provider fails.
              </p>

              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-950 transition-all hover:scale-[1.02] hover:shadow-[0_0_24px_-5px_rgba(45,212,191,0.65)]"
              >
                Open Dashboard
                <ArrowRight size={14} />
              </Link>
            </section>
          </motion.div>

          <motion.section variants={fadeUp} className="grid gap-4 lg:grid-cols-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <article
                  key={section.title}
                  className={`rounded-xl border p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all duration-300 ${section.cardClass}`}
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

                  <div className="mt-4 grid gap-2">
                    {section.notes.map((note) => (
                      <div key={note} className="flex gap-2 text-xs font-semibold leading-5 text-slate-400">
                        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${section.dotClass}`} />
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </motion.section>

          <motion.section
            variants={fadeUp}
            className="rounded-xl border border-amber-200/20 bg-amber-300/10 p-5 text-sm leading-7 text-amber-50"
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

      <PublicFooter />
    </div>
  );
}

export default Docs;
