function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block) return '';
        if (typeof block === 'string') return block;
        if (typeof block.text === 'string') return block.text;
        if (typeof block.content === 'string') return block.content;
        if (Array.isArray(block.content)) {
          return block.content
            .map((nested) => {
              if (!nested) return '';
              if (typeof nested === 'string') return nested;
              if (typeof nested.text === 'string') return nested.text;
              if (nested.type === 'reasoning_content' && typeof nested.content === 'string') {
                return `[reasoning]${nested.content}[/reasoning]`;
              }
              return JSON.stringify(nested);
            })
            .join(' ');
        }
        if (block.type === 'reasoning_content' && typeof block.content === 'string') {
          return `[reasoning]${block.content}[/reasoning]`;
        }
        return JSON.stringify(block);
      })
      .join(' ');
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content);
  }
  return '';
}

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function estimatePromptTokens({ system, messages }) {
  let total = 0;

  if (typeof system === 'string' || Array.isArray(system)) {
    total += estimateTextTokens(extractTextFromContent(system));
  }

  if (Array.isArray(messages)) {
    for (const message of messages) {
      total += estimateTextTokens(extractTextFromContent(message?.content));

      if (Array.isArray(message?.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          const fn = toolCall?.function || {};
          total += estimateTextTokens(fn.name || '');
          total += estimateTextTokens(fn.arguments || '');
        }
      }

      if (message?.function_call) {
        total += estimateTextTokens(message.function_call?.name || '');
        total += estimateTextTokens(message.function_call?.arguments || '');
      }

      if (message?.tool_call_id) {
        total += estimateTextTokens(message.tool_call_id);
      }
    }
  }

  return Math.max(1, total);
}

function hasToolContentBlocks(message) {
  if (!Array.isArray(message?.content)) return false;
  return message.content.some(
    (block) => block?.type === 'tool_use' || block?.type === 'tool_result'
  );
}

function canTrimMessage(message) {
  if (!message || message.role === 'system') return false;
  if (message.role === 'tool' || message.role === 'function') return false;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false;

  if (hasToolContentBlocks(message)) {
    return false;
  }

  return true;
}

function hasUnsafeToolEdges(message) {
  if (!message) return false;
  if (message.role === 'tool' || message.role === 'function') return true;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  return hasToolContentBlocks(message);
}

function summarizeMessagesToBudget({
  messages,
  system,
  budget,
  reserveTokens = 1024,
  minMessages = 10,
  preservedRecentCount = 6,
  maxSummaryChars = 1400,
}) {
  const beforeTokens = estimatePromptTokens({ system, messages });
  const noChange = {
    messages,
    summarized: false,
    summaryText: '',
    replacedCount: 0,
    beforeTokens,
    afterTokens: beforeTokens,
  };

  if (!Array.isArray(messages) || messages.length < minMessages || !Number.isFinite(budget) || budget <= 0) {
    return noChange;
  }

  const effectiveBudget = Math.max(1, Math.floor(budget - reserveTokens));
  if (beforeTokens <= effectiveBudget) {
    return noChange;
  }

  const cutoff = Math.max(0, messages.length - preservedRecentCount);
  if (cutoff <= 0) {
    return noChange;
  }

  const head = messages.slice(0, cutoff);
  const tail = messages.slice(cutoff);

  let splitStart = -1;
  let splitEnd = -1;
  for (let i = 0; i < head.length; i++) {
    if (hasUnsafeToolEdges(head[i])) {
      if (splitStart >= 0) {
        splitEnd = i;
        break;
      }
      continue;
    }
    if (splitStart < 0) splitStart = i;
    splitEnd = i + 1;
  }

  if (splitStart < 0 || splitEnd <= splitStart) {
    return noChange;
  }

  const summarySlice = head.slice(splitStart, splitEnd);
  const summaryParts = [];
  for (const message of summarySlice) {
    const role = message?.role || 'unknown';
    const text = extractTextFromContent(message?.content)
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    summaryParts.push(`${role}: ${text}`);
    const joined = summaryParts.join('\n');
    if (joined.length >= maxSummaryChars) break;
  }

  const summaryText = summaryParts.join('\n').slice(0, maxSummaryChars).trim();
  if (!summaryText) {
    return noChange;
  }

  const summaryMessage = {
    role: 'system',
    content: `Conversation summary for context retention:\n${summaryText}`,
  };

  const optimizedMessages = [
    ...head.slice(0, splitStart),
    summaryMessage,
    ...head.slice(splitEnd),
    ...tail,
  ];

  const afterTokens = estimatePromptTokens({ system, messages: optimizedMessages });

  return {
    messages: optimizedMessages,
    summarized: afterTokens < beforeTokens,
    summaryText,
    replacedCount: splitEnd - splitStart,
    beforeTokens,
    afterTokens,
  };
}

function pruneMessagesToBudget({ messages, system, budget, reserveTokens = 1024 }) {
  if (!Array.isArray(messages) || !Number.isFinite(budget) || budget <= 0) {
    return {
      messages,
      pruned: false,
      prunedCount: 0,
      beforeTokens: estimatePromptTokens({ system, messages }),
      afterTokens: estimatePromptTokens({ system, messages }),
    };
  }

  const beforeTokens = estimatePromptTokens({ system, messages });
  const effectiveBudget = Math.max(1, Math.floor(budget - reserveTokens));

  if (beforeTokens <= effectiveBudget) {
    return {
      messages,
      pruned: false,
      prunedCount: 0,
      beforeTokens,
      afterTokens: beforeTokens,
    };
  }

  const preservedRecentCount = 6;
  const cutoff = Math.max(0, messages.length - preservedRecentCount);
  const preservedTail = messages.slice(cutoff);
  const head = messages.slice(0, cutoff);

  const trimmedHead = [];
  let prunedCount = 0;

  for (const message of head) {
    const tentative = [...trimmedHead, message, ...preservedTail];
    const tentativeTokens = estimatePromptTokens({ system, messages: tentative });

    if (tentativeTokens <= effectiveBudget) {
      trimmedHead.push(message);
      continue;
    }

    if (canTrimMessage(message)) {
      prunedCount += 1;
      continue;
    }

    trimmedHead.push(message);
  }

  let finalMessages = [...trimmedHead, ...preservedTail];

  // Guard: if pruning removed the last user message before the preserved tail,
  // the tail may start with an assistant/tool turn — structurally invalid for
  // most upstream APIs (they require the first non-system message to be 'user').
  // Drop any leading orphaned assistant/tool turns to keep the structure valid.
  let leadingDropped = 0;
  while (
    finalMessages.length > 0 &&
    finalMessages[0].role !== 'system' &&
    finalMessages[0].role !== 'user'
  ) {
    finalMessages.shift();
    leadingDropped++;
  }

  const afterTokens = estimatePromptTokens({ system, messages: finalMessages });

  return {
    messages: finalMessages,
    pruned: prunedCount > 0 || leadingDropped > 0,
    prunedCount: prunedCount + leadingDropped,
    beforeTokens,
    afterTokens,
  };
}

function createCacheKey(payload, userId, providerId) {
  const scope = {
    userId: userId ? String(userId) : 'unknown',
    providerId: providerId || 'unknown',
    model: payload?.model || 'unknown',
    stream: !!payload?.stream,
    temperature: payload?.temperature,
    top_p: payload?.top_p,
    max_tokens: payload?.max_tokens,
    messages: payload?.messages,
    system: payload?.system,
    tools: payload?.tools,
    tool_choice: payload?.tool_choice,
  };

  try {
    return JSON.stringify(scope);
  } catch {
    return null;
  }
}

function readCachedResponse(cache, key, now = Date.now()) {
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function storeCachedResponse(cache, key, value, ttlMs, maxEntries = 200) {
  if (!key || !value || ttlMs <= 0) return;
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });

  if (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

module.exports = {
  estimatePromptTokens,
  pruneMessagesToBudget,
  summarizeMessagesToBudget,
  createCacheKey,
  readCachedResponse,
  storeCachedResponse,
};
