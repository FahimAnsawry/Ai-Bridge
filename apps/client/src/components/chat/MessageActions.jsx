import React, { useState } from 'react';
import { Copy, Check, RefreshCw, Trash2, Edit2 } from 'lucide-react';

/**
 * MessageActions — renders a compact action bar for assistant messages.
 * Shown on hover; buttons for copy, regenerate, delete.
 */
const MessageActions = ({ onCopy, onRegenerate, onDelete, onEdit, model, onEditClick }) => {
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    if (!onCopy || copying) return;
    try {
      setCopying(true);
      await onCopy();
    } finally {
      setTimeout(() => setCopying(false), 1500);
    }
  };

  return (
    <div className="mt-1 ml-1 flex items-center gap-1.5 flex-wrap">
      {model && (
        <span className="font-mono text-[10px] text-white/35">{model}</span>
      )}
      {onEditClick && (
        <button
          type="button"
          onClick={onEditClick}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          title="Edit"
        >
          <Edit2 size={10} strokeWidth={2} />
        </button>
      )}
      {onCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          title="Copy message"
        >
          {copying ? <Check size={10} /> : <Copy size={10} />}
          {copying ? 'Copied' : 'Copy'}
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          title="Regenerate"
        >
          <RefreshCw size={10} strokeWidth={2} />
          Regenerate
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-red-300/70"
          title="Delete message"
        >
          <Trash2 size={10} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

export default MessageActions;
