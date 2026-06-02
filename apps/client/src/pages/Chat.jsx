import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Trash2, MessageSquare } from 'lucide-react';
import {
  fetchChatMessages,
  appendChatMessage,
  clearChatMessages,
  deleteChatMessage,
  editChatMessage,
  fetchModels,
  fetchStatus,
  fetchConfig,
  fetchChatThreads,
} from '../api';
import { queryKeys } from '../api/queryKeys';
import { useToast } from '../context/ToastContext';
import ModelPicker from '../components/chat/ModelPicker';
import Composer from '../components/chat/Composer';
import MessageList from '../components/chat/MessageList';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ThreadSidebar from '../components/chat/ThreadSidebar';
import EditMessageModal from '../components/chat/EditMessageModal';

const MODEL_STORAGE_KEY = 'ai-bridge.chat.model';
const ANTHROPIC_MAX_TOKENS = 8192;

function isClaudeModel(id) {
  return typeof id === 'string' && /^claude[-_.]/i.test(id);
}

function parseOpenAiSseChunk(buffer, onDelta) {
  const lines = buffer.split('\n');
  const leftover = lines.pop();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') onDelta(delta);
    } catch {
      // ignore malformed event
    }
  }
  return leftover || '';
}

function parseAnthropicSseChunk(buffer, onDelta) {
  const lines = buffer.split('\n');
  const leftover = lines.pop();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const json = JSON.parse(payload);
      if (json?.type === 'content_block_delta') {
        const text = json?.delta?.text;
        if (typeof text === 'string') onDelta(text);
      } else if (json?.type === 'error') {
        const msg = json?.error?.message || 'Upstream returned an error.';
        onDelta('\n\n[error: ' + msg + ']');
      }
    } catch {
      // ignore malformed event
    }
  }
  return leftover || '';
}

function buildAnthropicMessages(messagesForModel) {
  const out = [];
  for (const m of messagesForModel) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = typeof m.content === 'string' ? m.content : '';
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content += '\n\n' + text;
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const Chat = ({ user }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(MODEL_STORAGE_KEY) || '');
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [localMessages, setLocalMessages] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const abortRef = useRef(null);
  const lastUserTextRef = useRef('');

  const threadsQuery = useQuery({
    queryKey: queryKeys.chatThreads(),
    queryFn: fetchChatThreads,
    staleTime: 30_000,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.chatMessages(),
    queryFn: () => fetchChatMessages({ threadId: currentThreadId }),
    enabled: !!currentThreadId,
    staleTime: 30_000,
  });

  const modelsQuery = useQuery({
    queryKey: queryKeys.models(),
    queryFn: fetchModels,
    staleTime: 5 * 60_000,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.status(),
    queryFn: fetchStatus,
    staleTime: 60_000,
  });

  const configQuery = useQuery({
    queryKey: queryKeys.config(),
    queryFn: fetchConfig,
    staleTime: 5 * 60_000,
  });

  const accessKey = statusQuery.data?.accessKey || user?.accessKey || '';

  const models = useMemo(() => {
    const routing = configQuery.data?.model_routing;
    if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
      const ids = Object.keys(routing).filter((id) => id && id.trim());
      if (ids.length) {
        return ids.sort((a, b) => a.localeCompare(b)).map((id) => ({ id }));
      }
    }
    return modelsQuery.data?.data || [];
  }, [configQuery.data, modelsQuery.data]);

  // Seed local state from server history once loaded
  useEffect(() => {
    if (historyQuery.data) {
      setLocalMessages(historyQuery.data);
    }
  }, [historyQuery.data]);

  // Auto-select first thread if none selected
  useEffect(() => {
    if (currentThreadId || threadsQuery.data?.length === 0) return;
    if (threadsQuery.data && threadsQuery.data.length > 0) {
      setCurrentThreadId(threadsQuery.data[0]._id);
    }
  }, [currentThreadId, threadsQuery.data, threadsQuery.isFetching]);

  // Auto-create thread when navigating to chat with no thread
  useEffect(() => {
    if (!currentThreadId && threadsQuery.data && threadsQuery.data.length === 0) {
      // Will be created on first send
    }
  }, [currentThreadId]);

  // Pick a default model
  useEffect(() => {
    if (!models.length) return;
    const valid = new Set(models.map((m) => m.id));
    if (selectedModel && valid.has(selectedModel)) return;
    const activeId = configQuery.data?.active_model_id;
    if (activeId && valid.has(activeId)) {
      setSelectedModel(activeId);
      return;
    }
    setSelectedModel(models[0].id);
  }, [selectedModel, configQuery.data, models]);

  useEffect(() => {
    if (selectedModel) localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  // ── Thread helpers ──

  const ensureThread = async () => {
    if (currentThreadId) return currentThreadId;
    // Create a new thread
    try {
      const thread = await queryClient.fetchQuery({
        queryKey: queryKeys.chatThreads(),
        queryFn: fetchChatThreads,
      });
      if (thread && thread.length > 0) {
        setCurrentThreadId(thread[0]._id);
        return thread[0]._id;
      }
      const res = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', model: '' }),
      });
      const newThread = await res.json();
      setCurrentThreadId(newThread._id);
      return newThread._id;
    } catch {
      return null;
    }
  };

  const handleSelectThread = (id) => {
    setCurrentThreadId(id);
    setLocalMessages([]);
  };

  const finishStreamingMessage = (full, modelUsed) => {
    setLocalMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant' && last._streaming) {
        copy[copy.length - 1] = { ...last, content: full, model: modelUsed, _streaming: false };
      }
      return copy;
    });
  };

  const replaceWithError = (errorText) => {
    setLocalMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant' && last._streaming) {
        copy.pop();
      }
      copy.push({
        _localId: `err-${Date.now()}`,
        role: 'error',
        content: errorText,
      });
      return copy;
    });
  };

  const send = async (text) => {
    if (!text.trim()) return;
    if (!accessKey) {
      showToast('No API key available — open Settings.', 'error');
      return;
    }
    if (!selectedModel) {
      showToast('Pick a model first.', 'error');
      return;
    }

    lastUserTextRef.current = text;

    const threadId = await ensureThread();
    if (!threadId) return;

    const userMsg = {
      _localId: `u-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    const placeholder = {
      _localId: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      model: selectedModel,
      _streaming: true,
    };

    const snapshot = localMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content }));
    snapshot.push({ role: 'user', content: text });

    setLocalMessages((prev) => [...prev, userMsg, placeholder]);
    setDraft('');
    setStreaming(true);

    // Fire-and-forget user-turn persistence
    appendChatMessage({ role: 'user', content: text, threadId }).catch((err) => {
      console.warn('[chat] failed to persist user turn:', err.message);
    });

    const ac = new AbortController();
    abortRef.current = ac;
    let accumulated = '';

    try {
      const isClaude = isClaudeModel(selectedModel);
      const url = isClaude ? '/v1/messages' : '/v1/chat/completions';
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessKey}`,
      };
      if (isClaude) headers['anthropic-version'] = '2023-06-01';

      const body = isClaude
        ? { model: selectedModel, max_tokens: ANTHROPIC_MAX_TOKENS, stream: true, messages: buildAnthropicMessages(snapshot) }
        : { model: selectedModel, stream: true, messages: snapshot };

      const parser = isClaude ? parseAnthropicSseChunk : parseOpenAiSseChunk;

      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let parsed = errBody;
        try { const obj = JSON.parse(errBody); parsed = obj?.error?.message || obj?.error || obj?.message || errBody; } catch {}
        replaceWithError(`HTTP ${res.status}: ${parsed || res.statusText}`);
        return;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!/event-stream|application\/json/i.test(contentType)) {
        const errBody = await res.text().catch(() => '');
        replaceWithError(
          `Unexpected response (content-type: ${contentType || 'unknown'}). ` + (errBody ? `Body: ${errBody.slice(0, 200)}` : '')
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parser(buffer, (delta) => {
          accumulated += delta;
          setLocalMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant' && last._streaming) {
              copy[copy.length - 1] = { ...last, content: accumulated };
            }
            return copy;
          });
        });
      }

      finishStreamingMessage(accumulated, selectedModel);

      if (accumulated.trim()) {
        appendChatMessage({ role: 'assistant', content: accumulated, model: selectedModel, threadId }).catch(() => {});
      } else {
        setLocalMessages((prev) => prev.filter((m) => !m._streaming));
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        finishStreamingMessage(accumulated, selectedModel);
        if (accumulated.trim()) {
          appendChatMessage({ role: 'assistant', content: accumulated, model: selectedModel, threadId }).catch(() => {});
        } else {
          setLocalMessages((prev) => prev.filter((m) => !m._streaming));
        }
      } else {
        console.error('[chat] stream error:', err);
        replaceWithError(err.message || 'Unknown error.');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  // ── Per-message actions ──

  const handleEditClick = (msg) => {
    setEditingMessage(msg);
    setEditModalOpen(true);
  };

  const handleEditSave = async (content) => {
    if (!editingMessage?._id) return false;
    try {
      const result = await editChatMessage(editingMessage._id, { content });
      // Optimistically update local state
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._localId === editingMessage._localId || m._id === editingMessage._id
            ? { ...m, content, edited: true }
            : m
        ).filter((m) => m._id !== result._id || result.cascadedDelete ? false : true)
      );
      // Re-fetch thread from server for accuracy
      if (currentThreadId) {
        const updated = await queryClient.fetchQuery({
          queryKey: queryKeys.chatMessages(),
          queryFn: () => fetchChatMessages({ threadId: currentThreadId }),
        });
        setLocalMessages(updated || []);
        await queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads() });
      }
      showToast('Message edited.', 'success');
      return true;
    } catch (err) {
      showToast(`Failed to edit: ${err.message}`, 'error');
      return false;
    }
  };

  const handleDeleteMessage = async (msg) => {
    if (msg._id) {
      try {
        await deleteChatMessage(msg._id);
      } catch {}
    }
    setLocalMessages((prev) =>
      prev.filter((m) => (m._localId !== msg._localId && m._id !== msg._id))
    );
  };

  const handleRegenerate = async (msg) => {
    if (streaming) return;
    // Find the user message before this assistant message
    const idx = localMessages.findIndex((m) => (m._id === msg._id || m._localId === msg._localId));
    if (idx < 0) return;
    let userContent = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (localMessages[i].role === 'user') {
        userContent = localMessages[i].content;
        break;
      }
    }
    if (!userContent) return;

    // Replace the assistant message with a streaming placeholder
    const placeholder = {
      _localId: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      model: selectedModel,
      _streaming: true,
    };
    setLocalMessages((prev) => {
      const copy = [...prev];
      copy[idx] = placeholder;
      return copy;
    });
    setStreaming(true);

    const snapshot = localMessages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m !== msg)
      .map(({ role, content }) => ({ role, content }))
      .concat({ role: 'user', content: userContent });

    const ac = new AbortController();
    abortRef.current = ac;
    let accumulated = '';
    try {
      const isClaude = isClaudeModel(selectedModel);
      const url = isClaude ? '/v1/messages' : '/v1/chat/completions';
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessKey}`,
      };
      if (isClaude) headers['anthropic-version'] = '2023-06-01';

      const body = isClaude
        ? { model: selectedModel, max_tokens: ANTHROPIC_MAX_TOKENS, stream: true, messages: buildAnthropicMessages(snapshot) }
        : { model: selectedModel, stream: true, messages: snapshot };

      const parser = isClaude ? parseAnthropicSseChunk : parseOpenAiSseChunk;

      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let parsed = errBody;
        try { const obj = JSON.parse(errBody); parsed = obj?.error?.message || obj?.error || obj?.message || errBody; } catch {}
        if (idx >= 0) {
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[idx] = { _localId: `err-${Date.now()}`, role: 'error', content: `HTTP ${res.status}: ${parsed || res.statusText}` };
            return copy;
          });
        }
        return;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!/event-stream|application\/json/i.test(contentType)) {
        const errBody = await res.text().catch(() => '');
        if (idx >= 0) {
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[idx] = { _localId: `err-${Date.now()}`, role: 'error', content: `Unexpected response (content-type: ${contentType || 'unknown'}).` };
            return copy;
          });
        }
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parser(buffer, (delta) => {
          accumulated += delta;
          setLocalMessages((prev) => {
            const copy = [...prev];
            const tail = copy[idx];
            if (tail && tail.role === 'assistant' && tail._streaming) {
              copy[idx] = { ...tail, content: accumulated };
            }
            return copy;
          });
        });
      }
      if (idx >= 0) {
        setLocalMessages((prev) => {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], content: accumulated, model: selectedModel, _streaming: false };
          return copy;
        });
        if (accumulated.trim() && currentThreadId) {
          appendChatMessage({ role: 'assistant', content: accumulated, model: selectedModel, threadId: currentThreadId }).catch(() => {});
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (idx >= 0) {
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], content: accumulated, model: selectedModel, _streaming: false };
            return copy;
          });
        }
      } else {
        if (idx >= 0) {
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[idx] = { _localId: `err-${Date.now()}`, role: 'error', content: err.message || 'Unknown error.' };
            return copy;
          });
        }
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleRetry = () => {
    if (!lastUserTextRef.current) return;
    setLocalMessages((prev) => prev.filter((m) => m.role !== 'error'));
    send(lastUserTextRef.current);
  };

  const handleClear = async () => {
    setConfirmClear(false);
    try {
      await clearChatMessages({ threadId: currentThreadId });
      setLocalMessages([]);
      if (currentThreadId) {
        queryClient.setQueryData(queryKeys.chatMessages(), []);
      }
      showToast('Chat cleared.', 'success');
    } catch (err) {
      showToast(`Failed to clear: ${err.message}`, 'error');
    }
  };

  const isHistoryLoading = historyQuery.isPending || threadsQuery.isPending;
  const isModelsLoading = configQuery.isPending && modelsQuery.isPending;

  return (
    <div className="relative flex h-[calc(100dvh-7.25rem)] md:h-[calc(100dvh-3rem)] overflow-hidden">
      {/* Thread sidebar */}
      <div className="hidden md:block md:w-[260px] md:shrink-0">
        <ThreadSidebar
          currentThreadId={currentThreadId}
          onSelectThread={handleSelectThread}
          sidebarWidth={260}
        />
      </div>

      {/* Main chat area */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex min-h-0 flex-1 flex-col px-3 md:px-4"
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 rounded-2xl px-3 py-2.5 sm:px-4"
          style={{
            background: 'var(--color-bg-panel, rgba(255,255,255,0.04))',
            border: '1px solid rgba(157,169,255,0.22)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.32), rgba(124,58,237,0.32))',
                border: '1px solid rgba(157,169,255,0.32)',
              }}
            >
              <MessageSquare size={16} className="text-white/85" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white/92">Chat</div>
              <div className="text-[11px] text-white/50">Routed through your bridge</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelPicker
              models={models}
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={isModelsLoading || streaming}
            />
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={!localMessages.length || streaming}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[12.5px] text-white/85 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(157,169,255,0.22)',
              }}
              aria-label="Clear chat"
              title="Clear chat"
            >
              <Trash2 size={14} strokeWidth={1.8} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          {isHistoryLoading ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-white/55">
              Loading chat…
            </div>
          ) : (
            <MessageList
              messages={localMessages}
              streaming={streaming}
              onRegenerate={handleRegenerate}
              onRetry={handleRetry}
              onEdit={handleEditClick}
              onDelete={handleDeleteMessage}
              emptyState={
                <div className="text-center">
                  <div
                    className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{
                      background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(124,58,237,0.18))',
                      border: '1px solid rgba(157,169,255,0.32)',
                    }}
                  >
                    <MessageSquare size={22} className="text-indigo-200" />
                  </div>
                  <div className="text-[14px] font-semibold text-white/90">Start a conversation</div>
                  <div className="mt-1 text-[12.5px] text-white/55">
                    Pick a model above, type a message below. Every turn goes through your bridge.
                  </div>
                </div>
              }
            />
          )}
        </div>

        {/* Composer */}
        <div className="mt-3 shrink-0">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => send(draft)}
              onStop={handleStop}
              streaming={streaming}
              disabled={isHistoryLoading || !selectedModel}
              placeholder={selectedModel ? undefined : 'Pick a model to start chatting…'}
            />
            <div className="mt-1.5 px-1 text-[10.5px] text-white/40">
              Press Enter to send · Shift+Enter for newline
            </div>
          </div>
        </div>

        {confirmClear && (
          <ConfirmationModal
            isOpen={confirmClear}
            title="Clear chat?"
            message="This permanently deletes every message in this thread. Cannot be undone."
            onConfirm={handleClear}
            onClose={() => setConfirmClear(false)}
          />
        )}
      </motion.div>

      {/* Edit message modal */}
      <EditMessageModal
        isOpen={editModalOpen}
        message={editingMessage}
        onClose={() => { setEditModalOpen(false); setEditingMessage(null); }}
        onSave={handleEditSave}
        initialContent={editingMessage?.content || ''}
      />
    </div>
  );
};

export default Chat;
