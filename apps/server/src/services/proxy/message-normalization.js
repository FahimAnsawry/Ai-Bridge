/**
 * normalizeMessages — Ensures the messages array conforms to expectations
 * of common OpenAI-style upstreams, even if the client is Anthropic-style.
 * Also handles turn-merging for Gemini-based upstreams.
 */
function normalizeMessages(messages, targetModel = '') {
  if (!Array.isArray(messages)) return messages;

  const isGemini = targetModel.toLowerCase().includes('gemini') || 
                   targetModel.toLowerCase().includes('google') ||
                   targetModel.toLowerCase().includes('google/');

  const stripCacheControl = (value) => {
    if (!value || typeof value !== 'object') return value;
    const cleanValue = { ...value };
    delete cleanValue.cache_control;
    return cleanValue;
  };

  // Phase 1: Basic cleaning and format conversion (Anthropic -> OpenAI & Legacy -> Modern)
  let cleaned = [];
  for (const msg of messages) {
    const cleanMsg = stripCacheControl(msg);
    if (Array.isArray(cleanMsg.content)) {
      cleanMsg.content = cleanMsg.content.map((block) => stripCacheControl(block));
    }
    if (Array.isArray(cleanMsg.tool_calls)) {
      cleanMsg.tool_calls = cleanMsg.tool_calls.map((toolCall) => {
        const cleanToolCall = stripCacheControl(toolCall);
        if (cleanToolCall?.function && typeof cleanToolCall.function === 'object') {
          cleanToolCall.function = stripCacheControl(cleanToolCall.function);
        }
        return cleanToolCall;
      });
    }

    const { role, content, tool_calls, function_call, name, tool_call_id } = cleanMsg;

    // 1. Anthropic-style assistant content array
    if ((role === 'assistant' || role === 'model') && Array.isArray(content)) {
      const textBlocks = content.filter(b => b.type === 'text');
      const toolUseBlocks = content.filter(b => b.type === 'tool_use');
      const thinkingBlocks = content.filter(b => b.type === 'thinking');

      let textContent = textBlocks.map(b => b.text).join('\n').trim();
      const thinkingContent = thinkingBlocks.map(b => b.thinking || b.text).join('\n').trim();
      
      if (thinkingContent) {
        textContent = `<think>\n${thinkingContent}\n</think>\n\n${textContent}`.trim();
      }

      const toolCalls = toolUseBlocks.map(b => ({
        id: b.id || `call_${Math.random().toString(36).slice(2, 11)}`,
        type: 'function',
        function: {
          name: b.name,
          arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {})
        }
      }));

      cleaned.push({
        role: 'assistant',
        content: toolCalls.length > 0 ? null : (textContent || ' '),
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoning_content: thinkingContent || undefined
      });
    } 
    // 2. Anthropic-style user tool_result
    else if (role === 'user' && Array.isArray(content) && content.some(b => b.type === 'tool_result')) {
      for (const block of content) {
        if (block.type === 'tool_result') {
          // Anthropic tool_result content can be a string OR an array of content blocks.
          // Extract plain text for maximum compatibility with OpenAI-compat upstreams.
          let toolContent;
          if (typeof block.content === 'string') {
            toolContent = block.content;
          } else if (Array.isArray(block.content)) {
            toolContent = block.content
              .map(b => (b && b.type === 'text' ? b.text : typeof b === 'string' ? b : JSON.stringify(b)))
              .join('\n');
          } else {
            toolContent = JSON.stringify(block.content || 'success');
          }
          cleaned.push({
            role: 'tool',
            tool_call_id: block.tool_use_id || `call_${Math.random().toString(36).slice(2, 11)}`,
            name: block.name || undefined,
            content: toolContent
          });
        }
      }
      const textBlocks = content.filter(b => b.type === 'text');
      if (textBlocks.length > 0) {
        cleaned.push({
          role: 'user',
          content: textBlocks.map(b => b.text).join('\n')
        });
      }
    }
    // 3. Legacy 'function' role or 'tool' role with missing fields
    else if (role === 'function' || role === 'tool') {
      cleaned.push({
        role: 'tool',
        tool_call_id: tool_call_id || name || `call_${Math.random().toString(36).slice(2, 11)}`,
        name: name,
        content: typeof content === 'string' ? content : JSON.stringify(content || 'success')
      });
    }
    // 4. Legacy 'assistant' with function_call -> tool_calls
    else if ((role === 'assistant' || role === 'model') && function_call && !tool_calls) {
      const callId = tool_call_id || function_call.name || `call_${Math.random().toString(36).slice(2, 11)}`;
      cleaned.push({
        role: 'assistant',
        content: null, // Gemini requirement: content must be null if tool_calls present
        tool_calls: [{
          id: callId,
          type: 'function',
          function: {
            ...function_call,
            arguments: typeof function_call.arguments === 'string' ? function_call.arguments : JSON.stringify(function_call.arguments || {})
          }
        }]
      });
    }
    // 5. Standard OpenAI format with minor fixes
    else {
      const newMsg = { ...cleanMsg };
      if (newMsg.role === 'model') newMsg.role = 'assistant';
      
      if (Array.isArray(newMsg.content) && newMsg.content.every(b => b.type === 'text')) {
        newMsg.content = newMsg.content.map(b => b.text).join('\n');
      }
      if (newMsg.role === 'assistant' && Array.isArray(newMsg.tool_calls) && newMsg.tool_calls.length > 0) {
        newMsg.content = null; 
        newMsg.tool_calls = newMsg.tool_calls.map(tc => {
          const tcArgs = tc?.function?.arguments;
          return {
            ...tc,
            id: tc.id || `call_${Math.random().toString(36).slice(2, 11)}`,
            function: tc.function ? {
              ...tc.function,
              arguments: typeof tcArgs === 'string' ? tcArgs : JSON.stringify(tcArgs || {})
            } : tc.function
          };
        });
      }
      if (newMsg.role === 'tool' && !newMsg.tool_call_id) {
        newMsg.tool_call_id = newMsg.name || `call_${Math.random().toString(36).slice(2, 11)}`;
      }
      cleaned.push(newMsg);
    }
  }

  // Phase 2: Merge Consecutive Same-Role Messages
  // CRITICAL: Do NOT merge an assistant turn that already has tool_calls with the
  // next assistant turn — Gemini requires exact 1:1 tool-call-to-response pairing
  // and merging would change the number of calls without changing the responses.
  const merged = [];
  for (const msg of cleaned) {
    const last = merged[merged.length - 1];

    // System messages: always merge
    if (last && last.role === 'system' && msg.role === 'system') {
      last.content = (last.content + '\n' + (msg.content || '')).trim();
      continue;
    }

    // Tool messages: never merge (each must stay paired with its call)
    if (msg.role === 'tool') {
      merged.push(msg);
      continue;
    }

    const canMerge =
      last &&
      last.role === msg.role &&
      last.role !== 'tool' &&
      // Do NOT merge if the previous assistant turn already has tool_calls
      !(last.role === 'assistant' && Array.isArray(last.tool_calls) && last.tool_calls.length > 0) &&
      // Do NOT merge if the incoming assistant turn has tool_calls (would create ambiguity)
      !(msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0);

    if (canMerge) {
      // Merge content
      if (msg.content) {
        if (typeof last.content === 'string' && typeof msg.content === 'string') {
          last.content = (last.content + '\n' + msg.content).trim();
        } else if (!last.content) {
          last.content = msg.content;
        }
      }
      // Merge tool_calls (only reached for non-assistant-with-tool_calls paths)
      if (Array.isArray(msg.tool_calls)) {
        last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls];
      }
      // Merge reasoning_content
      if (msg.reasoning_content) {
        last.reasoning_content = (last.reasoning_content ? last.reasoning_content + '\n' : '') + msg.reasoning_content;
      }
      continue;
    }

    merged.push(msg);
  }
  cleaned = merged;

  // Phase 2.5: Ensure system message is pushed to the front
  // If there are multiple system messages left somehow, combine them at the front.
  // Many models/routers reject requests if system messages are anywhere but the top.
  let systemContent = '';
  const withoutSystem = [];
  for (const msg of cleaned) {
    if (msg.role === 'system') {
      systemContent += (systemContent ? '\n' : '') + (msg.content || '');
    } else {
      withoutSystem.push(msg);
    }
  }

  if (systemContent) {
    cleaned = [{ role: 'system', content: systemContent }, ...withoutSystem];
  } else {
    cleaned = withoutSystem;
  }

  // Phase 2.6: Ensure conversation starts with a user message.
  // Pruning (or malformed client input) can leave the first non-system message as
  // 'assistant' or 'tool', which most upstream APIs reject — sometimes with 504
  // (gateway timeout) instead of a clean 400. Insert a lightweight bridge turn.
  {
    const firstNonSysIdx = cleaned.findIndex(m => m.role !== 'system');
    if (firstNonSysIdx >= 0 && cleaned[firstNonSysIdx].role !== 'user') {
      cleaned.splice(firstNonSysIdx, 0, {
        role: 'user',
        content: '[Earlier context was trimmed to fit within the context window]',
      });
    }
  }

  // Phase 3: Strict Tool Call/Response Alignment (Gemini-compatible)
  // Gemini requires that IMMEDIATELY after each assistant turn with N tool_calls,
  // there are exactly N tool response messages — one per call, in order.
  //
  // Strategy: walk cleaned[] in sequence. When we see an assistant+tool_calls turn,
  // we peek ahead at consecutive `tool` messages that follow it and match them to
  // tool_call IDs. We never pull responses from later turns.

  const finalMessages = [];
  let i = 0;

  const normalizeToolContent = (content) => {
    if (content === null || content === undefined) return '{"status": "success"}';
    if (typeof content !== 'string') return JSON.stringify(content);
    // If it's already valid JSON, keep it
    try { JSON.parse(content); return content; } catch { /* not JSON */ }
    // Wrap plain text in a JSON object
    return JSON.stringify({ result: content });
  };

  while (i < cleaned.length) {
    const msg = cleaned[i];

    // Sanitize tool_calls on assistant turns
    if ((msg.role === 'assistant' || msg.role === 'model') && Array.isArray(msg.tool_calls)) {
      msg.tool_calls = msg.tool_calls.filter(tc => tc && tc.id && tc.function && tc.function.name);
      if (msg.tool_calls.length === 0) delete msg.tool_calls;
    }

    finalMessages.push(msg);
    i++;

    // If this assistant turn has tool calls, collect the tool responses that follow
    if ((msg.role === 'assistant' || msg.role === 'model') && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Gather ALL consecutive tool messages that immediately follow (in order)
      const available = [];
      while (i < cleaned.length && cleaned[i].role === 'tool') {
        const r = { ...cleaned[i] };
        if (!r.name) r.name = 'unknown';
        r.content = normalizeToolContent(r.content);
        available.push(r);
        i++;
      }

      // For each tool call, match by tool_call_id first, then positionally
      const used = new Set();
      for (let callIdx = 0; callIdx < msg.tool_calls.length; callIdx++) {
        const tc = msg.tool_calls[callIdx];
        const id = tc.id;

        // Try exact ID match among available responses not yet used
        const matchIdx = available.findIndex((r, ri) => !used.has(ri) && r.tool_call_id === id);
        if (matchIdx >= 0) {
          used.add(matchIdx);
          // Ensure name matches the actual function name (tool_result blocks don't carry name)
          const matched = { ...available[matchIdx] };
          if (!matched.name || matched.name === 'unknown') {
            matched.name = tc.function?.name || 'unknown_function';
          }
          finalMessages.push(matched);
        } else {
          // Try positional fallback: take the callIdx-th unused available response
          let positionalFallback = -1;
          let count = 0;
          for (let ri = 0; ri < available.length; ri++) {
            if (!used.has(ri)) {
              if (count === callIdx) { positionalFallback = ri; break; }
              count++;
            }
          }
          if (positionalFallback >= 0) {
            // Fix up the tool_call_id to match this call so Gemini is happy
            const r = { ...available[positionalFallback], tool_call_id: id };
            if (!r.name) r.name = tc.function?.name || 'unknown';
            used.add(positionalFallback);
            console.warn(`[proxy] ⚠ Positional-matched tool response for id: "${id}" (name: ${tc.function?.name})`);
            finalMessages.push(r);
          } else {
            // No response at all — inject a synthetic one
            console.warn(`[proxy] ⚠ Injecting synthetic tool response for id: "${id}" (name: ${tc.function?.name})`);
            finalMessages.push({
              role: 'tool',
              tool_call_id: id,
              name: tc.function?.name || 'unknown_function',
              content: '{"status": "success"}'
            });
          }
        }
      }

      // Any leftover available tool responses that didn't match a call: drop them with a warning
      const orphaned = available.filter((_, ri) => !used.has(ri));
      if (orphaned.length > 0) {
        console.warn(`[proxy] ⚠ Dropping ${orphaned.length} orphaned tool response(s) after assistant turn`);
      }
    } else if (msg.role === 'tool') {
      // A tool message outside of an assistant+tool_calls context — drop it
      console.warn(`[proxy] ⚠ Dropping orphaned tool message (tool_call_id: ${msg.tool_call_id})`);
      finalMessages.pop(); // undo the push above
    }
  }

  // Phase 4: Final Parity Validation
  // Walk finalMessages and verify every assistant+tool_calls turn is immediately
  // followed by EXACTLY the right number of tool responses. This is the safety net
  // that catches any edge case the previous phases may have missed.
  const validated = [];
  let j = 0;
  while (j < finalMessages.length) {
    const m = finalMessages[j];
    validated.push(m);
    j++;

    if ((m.role === 'assistant' || m.role === 'model') && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const expectedCount = m.tool_calls.length;
      // Count how many consecutive tool messages follow in finalMessages
      let actualCount = 0;
      while (j + actualCount < finalMessages.length && finalMessages[j + actualCount].role === 'tool') {
        actualCount++;
      }

      if (actualCount === expectedCount) {
        // Perfect — push them all as-is
        for (let k = 0; k < actualCount; k++) validated.push(finalMessages[j + k]);
        j += actualCount;
      } else if (actualCount > expectedCount) {
        // Too many responses — keep only the first expectedCount
        console.warn(`[proxy] Phase4: trimming ${actualCount - expectedCount} excess tool response(s) for ${expectedCount} tool_calls`);
        for (let k = 0; k < expectedCount; k++) validated.push(finalMessages[j + k]);
        j += actualCount; // skip all
      } else {
        // Too few responses — push what we have and inject synthetics for the rest
        console.warn(`[proxy] Phase4: injecting ${expectedCount - actualCount} synthetic tool response(s) (have ${actualCount}, need ${expectedCount})`);
        for (let k = 0; k < actualCount; k++) validated.push(finalMessages[j + k]);
        j += actualCount;
        for (let k = actualCount; k < expectedCount; k++) {
          const tc = m.tool_calls[k];
          validated.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function?.name || 'unknown_function',
            content: '{"status": "success"}'
          });
        }
      }
    }
  }

  return validated;
}

/**
 * normalizeTools — Converts Anthropic-style tools to OpenAI-style tools
 */
function normalizeTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools
    .map((t) => {
      if (!t || typeof t !== 'object') return null;

      // Already OpenAI-style: keep as-is and only ensure defaults.
      if (t.type === 'function' && t.function && typeof t.function === 'object') {
        const fnName = t.function.name || t.name;
        if (!fnName) return null;
        return {
          ...t,
          function: {
            ...t.function,
            name: fnName,
            parameters: t.function.parameters || { type: 'object', properties: {} },
          },
        };
      }

      // OpenAI variant used by some clients: { type: 'function', name, parameters }
      if (t.type === 'function' && t.name) {
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters || t.input_schema || { type: 'object', properties: {} },
          },
        };
      }

      // Anthropic-style tool => convert to OpenAI function tool.
      if (t.name) {
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema || { type: 'object', properties: {} },
          },
        };
      }

      return null;
    })
    .filter(Boolean);
}

/**
 * normalizeToolChoice — Converts Anthropic-style tool_choice to OpenAI-style
 */
function normalizeToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any' || toolChoice.type === 'required') return 'required';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
}

/**
 * normalizeSystemPrompt — Converts Anthropic-style `system` into an
 * OpenAI-compatible system message for non-Anthropic upstreams.
 */
function normalizeSystemPrompt(system) {
  if (!system) return null;

  if (typeof system === 'string') {
    return system.trim() ? system : null;
  }

  if (Array.isArray(system)) {
    const text = system
      .map((block) => (block && typeof block === 'object' ? block.text || '' : ''))
      .join('')
      .trim();
    return text || null;
  }

  return null;
}

function stripCacheControlDeep(value) {
  if (Array.isArray(value)) return value.map(stripCacheControlDeep);
  if (!value || typeof value !== 'object') return value;

  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'cache_control') continue;
    clean[key] = stripCacheControlDeep(entry);
  }
  return clean;
}

function sanitizeCpassAnthropicBody(bodyData) {
  if (!bodyData || typeof bodyData !== 'object') return bodyData;

  const clean = stripCacheControlDeep(bodyData);
  const systemPrompt = normalizeSystemPrompt(clean.system);
  if (systemPrompt) clean.system = systemPrompt;

  delete clean.betas;
  delete clean.context_management;
  delete clean.output_config;
  delete clean.metadata;

  return clean;
}

module.exports = {
  normalizeMessages,
  normalizeTools,
  normalizeToolChoice,
  normalizeSystemPrompt,
  sanitizeCpassAnthropicBody,
};
