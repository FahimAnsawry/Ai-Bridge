import React, { useRef, useEffect } from 'react';
import { Send, Square } from 'lucide-react';

const Composer = ({ value, onChange, onSend, onStop, streaming, disabled, placeholder }) => {
  const taRef = useRef(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, 220);
    ta.style.height = `${next}px`;
  }, [value]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming) return;
      if (!disabled && value.trim()) onSend();
    }
  };

  return (
    <div
      className="flex items-end gap-2 rounded-2xl p-2"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(157,169,255,0.22)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Send a message — Shift+Enter for newline'}
        disabled={disabled}
        className="min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-[14px] text-white placeholder:text-white/40 focus:outline-none disabled:opacity-50"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition-colors"
          style={{
            background: 'linear-gradient(135deg, rgba(239,68,68,0.85), rgba(190,18,60,0.85))',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <Square size={16} strokeWidth={2.2} fill="currentColor" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition-colors disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.92), rgba(124,58,237,0.92))',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <Send size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

export default Composer;
