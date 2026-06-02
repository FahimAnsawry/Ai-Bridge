import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Edit2, MoreVertical, MessageSquare, ChevronRight, X } from 'lucide-react';
import {
  fetchChatThreads,
  createChatThread,
  updateChatThread,
  deleteChatThread,
} from '../../api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { useToast } from '../../context/ToastContext';

const ITEM_HEIGHT = 44;
const COLLAPSED_WIDTH = 48;

const ThreadSidebar = ({
  currentThreadId,
  onSelectThread,
  onSelectNewThread,
  sidebarWidth = 260,
}) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef(null);
  const menuRef = useRef(null);

  const threadsQuery = useQuery({
    queryKey: queryKeys.chatThreads(),
    queryFn: fetchChatThreads,
    staleTime: 30_000,
  });

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [contextMenu]);

  // Focus edit input when it appears
  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  const handleCreate = async () => {
    try {
      const thread = await createChatThread({ name: '', model: '' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads() });
      if (onSelectNewThread) onSelectNewThread(thread._id);
      else if (onSelectThread) onSelectThread(thread._id);
      showToast('New thread created.', 'success');
    } catch (err) {
      showToast(`Failed to create thread: ${err.message}`, 'error');
    }
  };

  const handleRename = async (id) => {
    const name = editingName.trim();
    if (!name) { setEditingId(null); return; }
    try {
      await updateChatThread(id, { name });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads() });
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      showToast(`Failed to rename: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    setContextMenu(null);
    try {
      await deleteChatThread(id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads() });
      if (currentThreadId === id) {
        // Select first thread or create new
        const updated = queryClient.getQueryData(queryKeys.chatThreads());
        if (updated && updated.length > 0) {
          onSelectThread?.(updated[0]._id);
        } else {
          const thread = await createChatThread({ name: '', model: '' });
          await queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads() });
          onSelectThread?.(thread._id);
        }
      }
      showToast('Thread deleted.', 'success');
    } catch (err) {
      showToast(`Failed to delete: ${err.message}`, 'error');
    }
  };

  const threads = threadsQuery.data || [];

  // ── Desktop ──
  if (collapsed) {
    return (
      <motion.aside
        className="flex h-full flex-col items-center gap-2 py-2"
        animate={{ width: COLLAPSED_WIDTH }}
      >
        <button
          type="button"
          onClick={handleCreate}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          title="New thread"
        >
          <Plus size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          title="Expand sidebar"
        >
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </motion.aside>
    );
  }

  return (
    <>
      {/* Mobile toggle button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg md:hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.92), rgba(124,58,237,0.92))',
          border: '1px solid rgba(157,169,255,0.32)',
        }}
        aria-label="Open threads"
      >
        <MessageSquare size={18} className="text-white/85" strokeWidth={1.8} />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] bg-slate-950/70 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', ease: [0.25, 0.1, 0.25, 1] }}
              className="fixed left-0 top-0 z-[71] h-full w-72 shadow-2xl md:hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(40,44,108,0.98), rgba(28,32,82,0.98))',
                borderRight: '1px solid rgba(157,169,255,0.22)',
              }}
            >
              <ThreadPanel
                threads={threads}
                currentThreadId={currentThreadId}
                onSelectThread={(id) => { onSelectThread(id); setMobileOpen(false); }}
                onNewThread={handleCreate}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                editingId={editingId}
                setEditingId={setEditingId}
                editingName={editingName}
                setEditingName={setEditingName}
                contextMenu={contextMenu}
                setContextMenu={setContextMenu}
                inputRef={inputRef}
                menuRef={menuRef}
                onRename={handleRename}
                onDelete={handleDelete}
                onClose={() => setMobileOpen(false)}
                collapsed={false}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <motion.aside
        className="hidden h-full flex-col md:flex"
        animate={{ width: sidebarWidth }}
        transition={{ type: 'tween', ease: [0.25, 0.1, 0.25, 1], duration: 0.2 }}
      >
        <ThreadPanel
          threads={threads}
          currentThreadId={currentThreadId}
          onSelectThread={onSelectThread}
          onNewThread={handleCreate}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          editingId={editingId}
          setEditingId={setEditingId}
          editingName={editingName}
          setEditingName={setEditingName}
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          inputRef={inputRef}
          menuRef={menuRef}
          onRename={handleRename}
          onDelete={handleDelete}
          onClose={null}
          collapsed={false}
        />
        <div className="mt-auto flex shrink-0 justify-center py-2">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
            title="Collapse sidebar"
          >
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        </div>
      </motion.aside>
    </>
  );
};

// Shared thread panel content
const ThreadPanel = ({
  threads,
  currentThreadId,
  onSelectThread,
  onNewThread,
  expandedId,
  setExpandedId,
  editingId,
  setEditingId,
  editingName,
  setEditingName,
  contextMenu,
  setContextMenu,
  inputRef,
  menuRef,
  onRename,
  onDelete,
  onClose,
  collapsed,
}) => {
  const handleContextMenu = (e, threadId) => {
    e.preventDefault();
    setContextMenu(contextMenu?.threadId === threadId ? null : { threadId });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/55">Threads</span>
        <div className="flex items-center gap-0.5">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
              title="Close"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          )}
          <button
            type="button"
            onClick={onNewThread}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="New thread"
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {threads.length === 0 && (
          <div className="py-6 text-center text-[11px] text-white/35">
            No threads yet
          </div>
        )}
        <AnimatePresence>
          {threads.map((thread) => (
            <ThreadItem
              key={thread._id}
              thread={thread}
              isActive={thread._id === currentThreadId}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              editingId={editingId}
              setEditingId={setEditingId}
              editingName={editingName}
              setEditingName={setEditingName}
              contextMenu={contextMenu}
              setContextMenu={setContextMenu}
              inputRef={inputRef}
              menuRef={menuRef}
              onSelect={onSelectThread}
              onRename={onRename}
              onDelete={onDelete}
              onContextMenu={handleContextMenu}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

// Individual thread item
const ThreadItem = ({
  thread,
  isActive,
  expandedId,
  setExpandedId,
  editingId,
  setEditingId,
  editingName,
  setEditingName,
  contextMenu,
  setContextMenu,
  inputRef,
  menuRef,
  onSelect,
  onRename,
  onDelete,
  onContextMenu,
}) => {
  const isExpanded = expandedId === thread._id;
  const isEditing = editingId === thread._id;
  const showMenu = contextMenu?.threadId === thread._id;

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className={`group relative my-px rounded-lg transition-colors ${
          isActive ? 'bg-white/10' : 'hover:bg-white/5'
        }`}
      >
        {/* Thread row */}
        <button
          type="button"
          onClick={() => onSelect(thread._id)}
          onContextMenu={(e) => onContextMenu(e, thread._id)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        >
          <MessageSquare
            size={13}
            strokeWidth={1.6}
            className={`shrink-0 ${isActive ? 'text-indigo-300' : 'text-white/40 group-hover:text-white/60'}`}
          />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/80">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRename(thread._id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => onRename(thread._id)}
                className="w-full bg-transparent text-[12.5px] text-white outline-none"
                placeholder="Thread name..."
              />
            ) : (
              thread.name ? (
                <span
                  onDoubleClick={() => {
                    setEditingId(thread._id);
                    setEditingName(thread.name);
                  }}
                >
                  {thread.name}
                </span>
              ) : (
                <span className="text-white/45 italic">New conversation</span>
              )
            )}
          </span>
          {/* Context menu trigger (visible on hover) */}
          {!isEditing && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onContextMenu(e, thread._id); }}
              className="shrink-0 rounded p-0.5 text-white/30 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white/70"
            >
              <MoreVertical size={12} strokeWidth={1.8} />
            </button>
          )}
        </button>

        {/* Last message preview (when expanded) */}
        {isExpanded && thread.lastMessagePreview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden px-7 pb-1.5"
          >
            <div className="text-[10.5px] text-white/35 line-clamp-2">
              {thread.lastMessagePreview}
            </div>
          </motion.div>
        )}

        {/* Context menu */}
        {showMenu && (
          <div
            ref={menuRef}
            className="absolute right-1 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-white/15 bg-slate-950/95 shadow-lg backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={() => {
                setEditingId(thread._id);
                setEditingName(thread.name);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Edit2 size={12} /> Rename
            </button>
            <button
              type="button"
              onClick={() => onDelete(thread._id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-red-300/70 transition-colors hover:bg-white/10 hover:text-red-200"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
};

export default ThreadSidebar;
