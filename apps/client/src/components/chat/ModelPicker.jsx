import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X } from 'lucide-react';

const PANEL_BG = 'linear-gradient(180deg, rgba(40,44,108,0.96) 0%, rgba(32,32,92,0.97) 100%)';

/**
 * Detects whether the viewport should use the mobile bottom-sheet variant.
 * Falls back to false on the server / before hydration so SSR-safe layouts stay stable.
 */
function useIsMobile(breakpointPx = 640) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpointPx : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = (e) => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    setIsMobile(mq.matches);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [breakpointPx]);
  return isMobile;
}

const ModelPicker = ({ models = [], value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const isMobile = useIsMobile(640);
  const [coords, setCoords] = useState(null); // { top, left, width, placement }

  const computeDesktopCoords = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const desired = 340;
    const width = Math.min(desired, vw - margin * 2);
    const maxHeight = Math.min(420, vh - 24);
    // Default: anchor to button's left edge, open downward.
    let left = rect.left;
    if (left + width + margin > vw) left = Math.max(margin, vw - width - margin);
    if (left < margin) left = margin;
    let top = rect.bottom + 6;
    let placement = 'bottom';
    if (top + maxHeight > vh - margin) {
      // Flip above if there's more room there.
      const spaceAbove = rect.top - margin;
      const spaceBelow = vh - rect.bottom - margin;
      if (spaceAbove > spaceBelow) {
        top = Math.max(margin, rect.top - maxHeight - 6);
        placement = 'top';
      }
    }
    return { top, left, width, maxHeight, placement };
  }, []);

  useLayoutEffect(() => {
    if (!open || isMobile) return;
    setCoords(computeDesktopCoords());
  }, [open, isMobile, computeDesktopCoords]);

  useEffect(() => {
    if (!open || isMobile) return;
    const reflow = () => setCoords(computeDesktopCoords());
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => {
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [open, isMobile, computeDesktopCoords]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const t = e.target;
      if (buttonRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  const filtered = query.trim()
    ? models.filter((m) => m.id.toLowerCase().includes(query.trim().toLowerCase()))
    : models;

  const handlePick = (id) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const trigger = (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={() => setOpen((v) => !v)}
      className="flex max-w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-white/92 transition-colors hover:bg-white/[0.06] disabled:opacity-50 sm:px-3"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(157,169,255,0.22)',
      }}
      aria-haspopup="listbox"
      aria-expanded={open}
    >
      <span className="truncate font-mono text-[12px] text-white/85 sm:text-[12.5px]" style={{ maxWidth: '40vw' }}>
        {value || 'Select a model'}
      </span>
      <ChevronDown size={14} strokeWidth={1.8} className="shrink-0 text-white/60" />
    </button>
  );

  // ── Mobile: render a bottom sheet via portal ────────────────────────────────
  if (open && isMobile) {
    return (
      <>
        {trigger}
        {createPortal(
          <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(3,6,34,0.62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={panelRef}
              className="absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl"
              style={{
                background: PANEL_BG,
                border: '1px solid rgba(157,169,255,0.22)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -18px 50px rgba(5,6,44,0.55)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
              }}
            >
              <div className="flex items-center justify-between px-4 pb-1 pt-3">
                <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-white/15" />
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-1">
                <span className="text-[13px] font-semibold text-white/90">Select a model</span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} strokeWidth={1.8} />
                </button>
              </div>
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                <Search size={15} className="text-white/50" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models"
                  className="w-full bg-transparent text-[14px] text-white placeholder:text-white/40 focus:outline-none"
                />
              </div>
              <ul role="listbox" className="flex-1 overflow-y-auto py-1">
                {filtered.length === 0 && (
                  <li className="px-4 py-6 text-center text-[13px] text-white/50">
                    {models.length === 0 ? 'Add models in Settings → Model Routing first.' : 'No models match.'}
                  </li>
                )}
                {filtered.map((m) => {
                  const isActive = m.id === value;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(m.id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                        style={{ color: isActive ? 'rgba(199,207,255,0.98)' : 'rgba(232,236,255,0.86)' }}
                      >
                        <span className="truncate font-mono text-[13px]">{m.id}</span>
                        {isActive && <Check size={15} strokeWidth={2} className="shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  // ── Desktop / tablet: portal-positioned popover ─────────────────────────────
  return (
    <>
      {trigger}
      {open && !isMobile && coords && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          className="fixed z-[60] flex flex-col overflow-hidden rounded-xl"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
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
          <ul className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-[12.5px] text-white/50">
                {models.length === 0 ? 'Add models in Settings → Model Routing first.' : 'No models match.'}
              </li>
            )}
            {filtered.map((m) => {
              const isActive = m.id === value;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(m.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/[0.06]"
                    style={{ color: isActive ? 'rgba(199,207,255,0.98)' : 'rgba(232,236,255,0.86)' }}
                  >
                    <span className="truncate font-mono">{m.id}</span>
                    {isActive && <Check size={14} strokeWidth={2} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
};

export default ModelPicker;
