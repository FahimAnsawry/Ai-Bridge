import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

const MessageList = ({ messages, streaming, onRegenerate, onRetry, emptyState }) => {
  const scrollRef = useRef(null);
  const stuckRef = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stuckRef.current = distance < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stuckRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!messages.length && emptyState) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        {emptyState}
      </div>
    );
  }

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto px-3 py-4 sm:px-4"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {messages.map((m, idx) => {
          const isLastAssistant = idx === lastAssistantIdx;
          const isStreaming = streaming && idx === messages.length - 1 && m.role === 'assistant';
          return (
            <MessageBubble
              key={m._id || m._localId || idx}
              message={m}
              isLast={isLastAssistant && !streaming}
              streaming={isStreaming}
              onRegenerate={isLastAssistant && !streaming ? onRegenerate : null}
              onRetry={m.role === 'error' ? onRetry : null}
            />
          );
        })}
      </div>
    </div>
  );
};

export default MessageList;
