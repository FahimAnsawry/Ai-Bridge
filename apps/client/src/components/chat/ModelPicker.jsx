import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

const PANEL_BG = 'linear-gradient(180deg, rgba(40,44,108,0.96) 0%, rgba(32,32,92,0.97) 100%)';

const ModelPicker = ({ models, value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = query
    ? models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()))
    : models;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white/92 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(157,169,255,0.22)',
        }}
      >
        <span className="font-mono text-[12.5px] text-white/85">
          {value || 'Select a model'}
        </span>
        <ChevronDown size={14} strokeWidth={1.8} className="text-white/60" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1.5 w-[320px] max-w-[80vw] overflow-hidden rounded-xl"
          style={{
            background: PANEL_BG,
            border: '1px solid rgba(157,169,255,0.22)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 18px 50px rgba(5,6,44,0.55)',
          }}
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <Search size={14} className="text-white/50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models"
              className="w-full bg-transparent text-[13px] text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-[12.5px] text-white/50">
                No models match.
              </li>
            )}
            {filtered.map((m) => {
              const isActive = m.id === value;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/[0.06]"
                    style={{ color: isActive ? 'rgba(199,207,255,0.98)' : 'rgba(232,236,255,0.86)' }}
                  >
                    <span className="font-mono">{m.id}</span>
                    {isActive && <Check size={14} strokeWidth={2} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ModelPicker;
