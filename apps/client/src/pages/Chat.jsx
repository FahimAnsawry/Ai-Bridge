import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Trash2, MessageSquare } from 'lucide-react';
import {
  fetchChatMessages,
  appendChatMessage,
  clearChatMessages,
  deleteChatMessage,
  fetchModels,
  fetchStatus,
  fetchConfig,
} from '../api';
import { queryKeys } from '../api/queryKeys';
import { useToast } from '../context/ToastContext';
import ModelPicker from '../components/chat/ModelPicker';
import Composer from '../components/chat/Composer';
import MessageList from '../components/chat/MessageList';
import ConfirmationModal from '../components/common/ConfirmationModal';

const MODEL_STORAGE_KEY = 'ai-bridge.chat.model';
const ANTHROPIC_MAX_TOKENS = 8192;

function isClaudeModel(id) {
  return typeof id === 'string' && /^claude[-_.]/i.test(id);
}

function parseOpenAiSseChunk(buffer, onDelta) {
  // Returns the leftover (incomplete) buffer.
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
  // Anthropic SSE: `event: <name>\ndata: <json>\n\n`. We only need data lines —
  // `content_block_delta` events carry `delta.text` for text streaming.
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
        onDelta(`\n\n[error: ${msg}]`);
      }
    } catch {
      // ignore malformed event
    }
  }
  return leftover || '';
}

function buildAnthropicMessages(messagesForModel) {
  // Anthropic requires strictly alternating user/assistant turns.
  // Our local state may have consecutive same-role messages after a regenerate
  // edge case; collapse defensively.
  const out = [];
  for (const m of messagesForModel) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = typeof m.content === 'string' ? m.content : '';
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content += `\n\n${text}`;
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  // Anthropic also requires the first message to be from the user.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const Chat = ({ user }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(MODEL_STORAGE_KEY) || ''
  );
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [localMessages, setLocalMessages] = useState([]);
  const abortRef = useRef(null);
  const lastUserTextRef = useRef('');

  const historyQuery = useQuery({
    queryKey: queryKeys.chatMessages(),
    queryFn: fetchChatMessages,
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

  // Source the model list from Settings → Model Routing (the models the user has actually
  // configured to route). Fall back to the synced /api/models catalog if routing is empty.
  const models = useMemo(() => {
    const routing = configQuery.data?.model_routing;
    if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
      const ids = Object.keys(routing).filter((id) => id && id.trim());
      if (ids.length) {
        return ids
          .sort((a, b) => a.localeCompare(b))
          .map((id) => ({ id }));
      }
    }
    return modelsQuery.data?.data || [];
  }, [configQuery.data, modelsQuery.data]);

  // Seed local state from server history once loaded.
  useEffect(() => {
    if (historyQuery.data) setLocalMessages(historyQuery.data);
  }, [historyQuery.data]);

  // Pick a default model: localStorage value if still valid > active_model_id from config > first available.
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

    // Snapshot the conversation we send to the model (no error bubbles, no streaming placeholder).
    const snapshot = localMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content }));
    snapshot.push({ role: 'user', content: text });

    setLocalMessages((prev) => [...prev, userMsg, placeholder]);
    setDraft('');
    setStreaming(true);

    // Fire-and-forget user-turn persistence.
    appendChatMessage({ role: 'user', content: text }).catch((err) => {
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
        ? {
            model: selectedModel,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            stream: true,
            messages: buildAnthropicMessages(snapshot),
          }
        : { model: selectedModel, stream: true, messages: snapshot };

      const parser = isClaude ? parseAnthropicSseChunk : parseOpenAiSseChunk;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let parsed = errBody;
        try {
          const obj = JSON.parse(errBody);
          parsed = obj?.error?.message || obj?.error || obj?.message || errBody;
        } catch {}
        replaceWithError(`HTTP ${res.status}: ${parsed || res.statusText}`);
        return;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!/event-stream|application\/json/i.test(contentType)) {
        const errBody = await res.text().catch(() => '');
        replaceWithError(
          `Unexpected response (content-type: ${contentType || 'unknown'}). The dev proxy may not be routing /v1 to the backend. ` +
            (errBody ? `Body: ${errBody.slice(0, 200)}` : '')
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
        appendChatMessage({
          role: 'assistant',
          content: accumulated,
          model: selectedModel,
        }).catch((err) => {
          console.warn('[chat] failed to persist assistant turn:', err.message);
        });
      } else {
        // Empty response: drop the placeholder.
        setLocalMessages((prev) => prev.filter((m) => !m._streaming));
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Stopped by user: save whatever we have so far.
        finishStreamingMessage(accumulated, selectedModel);
        if (accumulated.trim()) {
          appendChatMessage({
            role: 'assistant',
            content: accumulated,
            model: selectedModel,
          }).catch(() => {});
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

  const handleRegenerate = async () => {
    if (streaming) return;
    const last = localMessages[localMessages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (!lastUserTextRef.current) {
      // Fall back to scanning history.
      const prevUser = [...localMessages].reverse().find((m) => m.role === 'user');
      if (!prevUser) return;
      lastUserTextRef.current = prevUser.content;
    }

    // Drop the last assistant message locally and from server.
    setLocalMessages((prev) => prev.slice(0, -1));
    if (last._id) {
      deleteChatMessage(last._id).catch(() => {});
    }
    // Replay without re-persisting the user turn — it's already saved.
    const text = lastUserTextRef.current;
    const placeholder = {
      _localId: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      model: selectedModel,
      _streaming: true,
    };
    setLocalMessages((prev) => [...prev, placeholder]);
    setStreaming(true);

    const snapshot = localMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => m !== last)
      .map(({ role, content }) => ({ role, content }));

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
        ? {
            model: selectedModel,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            stream: true,
            messages: buildAnthropicMessages(snapshot),
          }
        : { model: selectedModel, stream: true, messages: snapshot };

      const parser = isClaude ? parseAnthropicSseChunk : parseOpenAiSseChunk;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let parsed = errBody;
        try {
          const obj = JSON.parse(errBody);
          parsed = obj?.error?.message || obj?.error || obj?.message || errBody;
        } catch {}
        replaceWithError(`HTTP ${res.status}: ${parsed || res.statusText}`);
        return;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!/event-stream|application\/json/i.test(contentType)) {
        const errBody = await res.text().catch(() => '');
        replaceWithError(
          `Unexpected response (content-type: ${contentType || 'unknown'}). The dev proxy may not be routing /v1 to the backend. ` +
            (errBody ? `Body: ${errBody.slice(0, 200)}` : '')
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
            const tail = copy[copy.length - 1];
            if (tail && tail.role === 'assistant' && tail._streaming) {
              copy[copy.length - 1] = { ...tail, content: accumulated };
            }
            return copy;
          });
        });
      }
      finishStreamingMessage(accumulated, selectedModel);
      if (accumulated.trim()) {
        appendChatMessage({ role: 'assistant', content: accumulated, model: selectedModel }).catch(() => {});
      } else {
        setLocalMessages((prev) => prev.filter((m) => !m._streaming));
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        finishStreamingMessage(accumulated, selectedModel);
      } else {
        replaceWithError(err.message || 'Unknown error.');
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
      await clearChatMessages();
      setLocalMessages([]);
      queryClient.setQueryData(queryKeys.chatMessages(), []);
      lastUserTextRef.current = '';
      showToast('Chat cleared.', 'success');
    } catch (err) {
      showToast(`Failed to clear: ${err.message}`, 'error');
    }
  };

  const isHistoryLoading = historyQuery.isPending;
  const isModelsLoading = configQuery.isPending && modelsQuery.isPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-[calc(100dvh-7.25rem)] flex-col md:h-[calc(100dvh-3rem)]"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 sm:px-4"
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
                <div className="text-[14px] font-semibold text-white/90">
                  Start a conversation
                </div>
                <div className="mt-1 text-[12.5px] text-white/55">
                  Pick a model up top, type a message below. Every turn goes through your bridge.
                </div>
              </div>
            }
          />
        )}
      </div>

      {/* Composer */}
      <div className="mt-3">
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
  );
};

export default Chat;
