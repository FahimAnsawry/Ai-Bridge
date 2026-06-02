import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Edit2 } from 'lucide-react';

/**
 * EditMessageModal — modal for editing a user's message.
 * Triggers cascading delete on backend; on success, re-fetches thread.
 */
const EditMessageModal = ({
  isOpen,
  message,
  onClose,
  onSave,
  initialContent,
}) => {
  const [content, setContent] = React.useState(initialContent || '');
  const textareaRef = React.useRef(null);

  React.useEffect(() => {
    setContent(initialContent || '');
  }, [initialContent]);

  React.useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
    }
  }, [isOpen]);

  if (!isOpen || !message) return null;

  const handleSave = async () => {
    if (!content.trim()) return;
    const success = await onSave(content.trim());
    if (success) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl p-6 space-y-5"
            style={{
              background: 'linear-gradient(145deg, #090622 0%, #17153a 48%, #1f1a4a 100%)',
              border: '1px solid rgba(129,140,248,0.25)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 24px 64px rgba(2,6,23,0.58), 0 0 42px rgba(99,102,241,0.14)',
            }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(255,255,255,0.03) 55%, rgba(255,255,255,0) 70%)' }} />

            <div className="relative z-10 flex items-center justify-between gap-4 border-b border-white/15 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 size={16} className="text-indigo-300" strokeWidth={2} />
                <h2 className="text-base font-bold text-white">Edit Message</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-slate-950/35 text-white/80 hover:bg-slate-950/55 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="relative z-10 space-y-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/50">Model</p>
              <div className="font-mono text-[11px] text-white/60">{message.model || 'unknown'}</div>
            </div>

            <div className="relative z-10 space-y-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/50">Message</p>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                className="w-full rounded-xl border border-white/25 bg-slate-950/55 px-4 py-3 text-[14px] text-white placeholder:text-white/40 focus:outline-none [color-scheme:dark] resize-none leading-relaxed"
              />
              <p className="text-[10px] text-white/35">
                Editing will delete all assistant responses after this message.
              </p>
            </div>

            <div className="relative z-10 flex gap-3 pt-2 border-t border-white/15">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-white/25 bg-slate-950/30 px-4 py-2.5 text-xs font-extrabold text-white/85 hover:bg-slate-950/45 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!content.trim()}
                className="flex-1 rounded-xl border border-white/30 bg-slate-950/30 px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-white hover:bg-slate-950/50 disabled:opacity-40"
                style={{
                  background: content.trim()
                    ? 'linear-gradient(135deg, rgba(99,102,241,0.92), rgba(124,58,237,0.92))'
                    : 'rgba(255,255,255,0.04)',
                }}
              >
                Save Changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default EditMessageModal;
