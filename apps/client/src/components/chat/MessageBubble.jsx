import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import MessageActions from './MessageActions';

const COLLAPSIBLE_THRESHOLD = 40;

const CodeBlock = ({ children, className, messageContentLength }) => {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const language = /language-(\w+)/.exec(className || '')?.[1] || 'text';
  const code = String(children).replace(/\n$/, '');
  const isCollapsible = (collapsed || messageContentLength > COLLAPSIBLE_THRESHOLD) && code.split('\n').length > 8;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-white/55">
            {language}
          </span>
          {code.split('\n').length > 8 && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] text-white/35 transition-colors hover:bg-white/10 hover:text-white/60"
            >
              {collapsed ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ maxHeight: collapsed ? '200px' : 'none', overflow: 'hidden' }}>
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: '12px 14px',
            background: 'rgba(0,0,0,0.45)',
            fontSize: '12.5px',
            lineHeight: 1.55,
            maxHeight: collapsed ? '200px' : 'none',
            overflow: collapsed ? 'auto' : 'visible',
          }}
          codeTagProps={{ style: { fontFamily: '"Geist Mono Variable", ui-monospace, monospace' } }}
        >
          {code}
        </SyntaxHighlighter>
        {collapsed && code.split('\n').length > 12 && (
          <div className="flex items-center justify-center gap-1 bg-black/60 py-2 text-[10px] text-white/40">
            <ChevronDown size={10} />
            {code.split('\n').length - 10} more lines · Click Expand
          </div>
        )}
      </div>
    </div>
  );
};

const markdownComponents = {
  code({ inline, className, children, ...rest }) {
    if (inline) {
      return (
        <code
          className="rounded px-1 py-0.5 font-mono text-[12.5px]"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(232,236,255,0.95)' }}
          {...rest}
        >
          {children}
        </code>
      );
    }
    return <CodeBlock className={className} children={children} />;
  },
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
        {children}
      </a>
    );
  },
  p({ children }) {
    return <p className="my-2 leading-relaxed">{children}</p>;
  },
  ul({ children }) {
    return <ul className="my-2 list-disc pl-5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal pl-5">{children}</ol>;
  },
  li({ children }) {
    return <li className="my-1">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="my-3 text-[18px] font-bold">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="my-3 text-[16px] font-bold">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="my-2 text-[14.5px] font-semibold">{children}</h3>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-white/20 pl-3 text-white/75">
        {children}
      </blockquote>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 bg-white/[0.06]">
            <tr>{children}</tr>
          </thead>
          {children.props?.children?.filter(
            (c) => c?.props?.tagName !== 'thead'
          )}
        </table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border border-white/15 bg-white/[0.08] px-2 py-1.5 text-left font-semibold">{children}</th>;
  },
  td({ children, ...rest }) {
    return (
      <td
        className={`border border-white/10 px-2 py-1 ${rest.index !== undefined && rest.index % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
      >
        {children}
      </td>
    );
  },
};

const MessageBubble = ({ message, isLast, streaming, onRegenerate, onRetry, onEdit, onDelete }) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] text-white whitespace-pre-wrap"
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.32), rgba(124,58,237,0.32))',
            border: '1px solid rgba(157,169,255,0.32)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          {message.content}
          {message.edited && (
            <span className="ml-1.5 text-[10px] text-white/40 italic">(edited)</span>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(message)}
              className="ml-2 inline-flex items-center text-[10px] text-white/50 transition-colors hover:text-white/80"
              title="Edit message"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="flex justify-start">
        <div
          className="max-w-[85%] rounded-2xl px-4 py-3"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.32)',
          }}
        >
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-red-300">
            <AlertTriangle size={14} strokeWidth={2} />
            Request failed
          </div>
          <div className="text-[13px] text-red-100/85 whitespace-pre-wrap">{message.content}</div>
          <div className="mt-2 flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-red-100/90 transition-colors hover:bg-white/10"
              >
                <RefreshCw size={12} strokeWidth={2} />
                Retry
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(message)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-red-300/70 transition-colors hover:bg-white/10 hover:text-red-200"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // assistant
  const formatTimestamp = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return timeStr;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
  };

  const timestamp = formatTimestamp(message.createdAt);

  return (
    <div className="flex justify-start">
      <div className="max-w-[88%]">
        <div
          className="rounded-2xl px-4 py-3 text-[14px] text-white/92"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(157,169,255,0.18)',
          }}
        >
          {message.content ? (
            <div className="text-[14px] leading-relaxed text-white/92">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
          ) : streaming ? (
            <span className="inline-flex items-center gap-1 text-white/50">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" />
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" style={{ animationDelay: '120ms' }} />
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" style={{ animationDelay: '240ms' }} />
            </span>
          ) : null}
        </div>

        {/* Action bar + timestamp */}
        {message.content && !streaming && (
          <div className="flex items-center gap-1.5">
            <MessageActions
              model={message.model}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(message.content);
                } catch {}
              }}
              onRegenerate={isLast ? onRegenerate : null}
              onDelete={onDelete}
              onEditClick={onEdit ? () => onEdit(message) : null}
            />
            {timestamp && (
              <span className="text-[9px] text-white/25 ml-auto">{timestamp}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
