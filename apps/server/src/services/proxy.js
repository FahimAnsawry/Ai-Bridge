/**
 * proxy.js — Core Proxy Logic
 * Forwards OpenAI-compatible requests to the configured upstream API,
 * supports streaming (SSE), and records latency + token counts.
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config/config');

const { addLog } = require('../middlewares/logger');
const {
  estimatePromptTokens,
  pruneMessagesToBudget,
  summarizeMessagesToBudget,
  createCacheKey,
  readCachedResponse,
  storeCachedResponse,
} = require('../utils/token-budget');
// Verbose debug logging removed for latency performance.
// Essential logs kept: request line, response status, errors, warnings.

// Connection pools for upstream requests - reuses TCP connections dramatically reducing latency
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketTimeout: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketTimeout: 30000,
});

const responseCache = new Map();
const RESPONSE_CACHE_MAX_ENTRIES = 200;
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
          function: function_call
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
        newMsg.tool_calls = newMsg.tool_calls.map(tc => ({
          ...tc,
          id: tc.id || `call_${Math.random().toString(36).slice(2, 11)}`
        }));
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

/**
 * translateOpenAIToAnthropic — Converts OpenAI chat completion response
 * to Anthropic message response format.
 */
function translateOpenAIToAnthropic(openaiRes, model) {
  const choice = openaiRes.choices?.[0];
  const message = choice?.message;
  
  const content = [];
  if (message?.content) {
    content.push({ type: 'text', text: message.content });
  }
  
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      try {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: typeof tc.function.arguments === 'string' 
            ? JSON.parse(tc.function.arguments || '{}') 
            : tc.function.arguments
        });
      } catch (e) {
        console.error('[proxy] Failed to parse tool arguments:', e.message);
      }
    }
  }
  
  let stopReason = 'end_turn';
  const fr = choice?.finish_reason;
  if (fr === 'tool_calls' || fr === 'function_call') stopReason = 'tool_use';
  else if (fr === 'stop') stopReason = 'end_turn';
  else if (fr === 'length') stopReason = 'max_tokens';

  return {
    id: openaiRes.id || `msg_local_${Math.random().toString(36).slice(2, 11)}`,
    type: 'message',
    role: 'assistant',
    model: model,
    content: content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiRes.usage?.prompt_tokens || 0,
      output_tokens: openaiRes.usage?.completion_tokens || 0
    }
  };
}


/**
 * AnthropicSSETranslator — Internal utility to map OpenAI-style SSE
 * chunk stream into the specific event sequence Anthropic clients expect.
 */
class AnthropicSSETranslator {
  constructor(res, model) {
    this.res = res;
    this.model = model;
    this.sentMessageStart = false;
    this.hasThinking = false;
    this.hasText = false;
    this.currentBlockIndex = 0;
    this.activeToolBlocks = new Map(); // index -> { id, name }
  }

  start() {
    if (this.sentMessageStart) return;
    // console.log('[SSE] → message_start');
    this.res.write('event: message_start\n');
    this.res.write(`data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: `msg_local_${Math.random().toString(36).slice(2, 11)}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })}\n\n`);

    // Claude CLI often requires an early ping
    this.res.write('event: ping\n');
    this.res.write('data: {"type": "ping"}\n\n');
    this.sentMessageStart = true;
  }

  pushDelta(text = '', thinking = '') {
    if (!this.sentMessageStart) this.start();

    // Convert thinking into normal text wrapped in <think> tags for client compatibility
    if (thinking) {
      if (!this.hasText) {
        this.res.write('event: content_block_start\n');
        this.res.write(`data: ${JSON.stringify({
          type: 'content_block_start',
          index: this.currentBlockIndex,
          content_block: { type: 'text', text: '' }
        })}\n\n`);
        this.hasText = true;
      }
      
      if (!this.hasThinking) {
        this.res.write('event: content_block_delta\n');
        this.res.write(`data: ${JSON.stringify({
          type: 'content_block_delta',
          index: this.currentBlockIndex,
          delta: { type: 'text_delta', text: '<think>\n' }
        })}\n\n`);
        this.hasThinking = true;
      }
      
      this.res.write('event: content_block_delta\n');
      this.res.write(`data: ${JSON.stringify({
        type: 'content_block_delta',
        index: this.currentBlockIndex,
        delta: { type: 'text_delta', text: thinking }
      })}\n\n`);
    }

    // Handle normal text
    if (text) {
      if (!this.hasText) {
        this.res.write('event: content_block_start\n');
        this.res.write(`data: ${JSON.stringify({
          type: 'content_block_start',
          index: this.currentBlockIndex,
          content_block: { type: 'text', text: '' }
        })}\n\n`);
        this.hasText = true;
      }
      
      if (this.hasThinking) {
        // Close thinking tag
        this.res.write('event: content_block_delta\n');
        this.res.write(`data: ${JSON.stringify({
          type: 'content_block_delta',
          index: this.currentBlockIndex,
          delta: { type: 'text_delta', text: '\n</think>\n\n' }
        })}\n\n`);
        this.hasThinking = false;
      }

      this.res.write('event: content_block_delta\n');
      this.res.write(`data: ${JSON.stringify({
        type: 'content_block_delta',
        index: this.currentBlockIndex,
        delta: { type: 'text_delta', text }
      })}\n\n`);
    }
  }

  pushToolCallDelta(toolCall) {
    if (!this.sentMessageStart) this.start();

    // If there is an active text/thinking block, it should be considered closed when tools arrive
    if (this.hasThinking || this.hasText) {
      this.res.write('event: content_block_stop\n');
      this.res.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: this.currentBlockIndex })}\n\n`);
      this.hasThinking = false;
      this.hasText = false;
    }

    const { index, id, function: fn } = toolCall;
    
    // Anthropic tool_use usually starts after text
    const anthropicIndex = index + this.currentBlockIndex + 1;

    if (!this.activeToolBlocks.has(index)) {
      const toolId = id || `toolu_local_${Math.random().toString(36).slice(2, 11)}`;
      const name = fn?.name || 'unknown_tool';
      
      this.activeToolBlocks.set(index, { id: toolId, name });

      this.res.write('event: content_block_start\n');
      this.res.write(`data: ${JSON.stringify({
        type: 'content_block_start',
        index: anthropicIndex,
        content_block: { type: 'tool_use', id: toolId, name, input: {} }
      })}\n\n`);
    }

    if (fn?.arguments) {
      this.res.write('event: content_block_delta\n');
      this.res.write(`data: ${JSON.stringify({
        type: 'content_block_delta',
        index: anthropicIndex,
        delta: { type: 'input_json_delta', partial_json: fn.arguments }
      })}\n\n`);
    }
  }

  finish(stopReason = 'end_turn') {
    if (!this.sentMessageStart) this.start();

    // Close thinking tag if it was left open!
    if (this.hasThinking) {
      this.res.write('event: content_block_delta\n');
      this.res.write(`data: ${JSON.stringify({
        type: 'content_block_delta',
        index: this.currentBlockIndex,
        delta: { type: 'text_delta', text: '\n</think>\n' }
      })}\n\n`);
      this.hasThinking = false;
    }

    // If we had tool calls, the stop reason should be 'tool_use'
    if (this.activeToolBlocks.size > 0 && stopReason === 'end_turn') {
      stopReason = 'tool_use';
    }

    if (this.hasThinking || this.hasText) {
      this.res.write('event: content_block_stop\n');
      this.res.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: this.currentBlockIndex })}\n\n`);
    }

    // Also stop any tool blocks
    for (const [index] of this.activeToolBlocks) {
      this.res.write('event: content_block_stop\n');
      this.res.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: index + this.currentBlockIndex + 1 })}\n\n`);
    }

    this.res.write('event: message_delta\n');
    this.res.write(`data: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 }
    })}\n\n`);

    this.res.write('event: message_stop\n');
    this.res.write('data: {"type": "message_stop"}\n\n');
    // console.log('[SSE] → message_stop');
  }
}


/**
 * Build Axios request options for the upstream API.
 * Always uses the active provider's baseUrl and apiKey.
 */
function buildUpstreamRequest(req, baseUrl, apiKey) {
  // Build CLEAN headers — do NOT spread req.headers.
  const headers = {
    'authorization': `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
  };

  // Bypassing AgentRouter 'unauthorized client' detection.
  if (baseUrl.includes('agentrouter')) {
    headers['originator'] = 'codex_cli_rs';
    headers['version'] = '0.101.0';
    headers['user-agent'] = 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464';
  }

  const isGitHubModels = baseUrl.includes('models.github.ai') || baseUrl.includes('models.inference.ai.azure.com') || (baseUrl.includes('api.github.com') && req.path.includes('/models'));

  // GitHub Models requires specific GitHub API headers
    if (isGitHubModels) {
      const isStreamingReq = req.body?.stream === true;
      headers['accept'] = isStreamingReq ? 'text/event-stream' : 'application/vnd.github+json';
      headers['x-github-api-version'] = '2022-11-28';
      // console.log(`[proxy] GitHub Models: adding GitHub API headers (streaming=${isStreamingReq})`);
    }

  // ── Path handling ───────────────────────────────────────────
  let upstreamPath = req.path; // e.g., "/messages" or "/chat/completions"
  
  // Normalization: Map Anthropic's /messages to OpenAI's /chat/completions if upstream is not Anthropic
  const isAnthropic = baseUrl.includes('anthropic.com');
  const isEcom = baseUrl.includes('ecom');

  if (upstreamPath.endsWith('/messages') && !isAnthropic) {
    // console.log(`[proxy] Mapping /messages → /chat/completions for ${isEcom ? 'ecom' : 'OpenAI-compatible'} upstream`);
    upstreamPath = upstreamPath.replace('/messages', '/chat/completions');
  }

  let cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  if (isGitHubModels) {
    // GitHub Models API uses /inference prefix instead of /v1
    // 1. Strip /v1 from baseUrl if it was accidentally included
    cleanBaseUrl = cleanBaseUrl.replace(/\/v1$/, '');

    // 2. Map /v1/... to /inference/...
    upstreamPath = upstreamPath.replace(/^\/v1/, '');
    if (!upstreamPath.startsWith('/inference')) {
      upstreamPath = '/inference' + (upstreamPath.startsWith('/') ? upstreamPath : '/' + upstreamPath);
    }
  } else if (!cleanBaseUrl.endsWith('/v1') && !upstreamPath.startsWith('/v1')) {
    // Prepend /v1 if it's missing from both baseUrl and the path
    upstreamPath = '/v1' + (upstreamPath.startsWith('/') ? upstreamPath : '/' + upstreamPath);
  } else if (!upstreamPath.startsWith('/')) {
    upstreamPath = '/' + upstreamPath;
  }

  const upstreamUrl = `${cleanBaseUrl}${upstreamPath}`;

  // ── Build / Sanitize Request Body ────────────────────────────────────────
  let bodyData = req.body;
  if (bodyData && typeof bodyData === 'object') {
    bodyData = { ...bodyData };
    // Normalization: Ensure valid messages for common upstreams
    if (bodyData.messages) {
      // Restore original (pre-normalization) messages on retry so we don't
      // double-normalize — previous calls may have mutated req.body.messages
      // in-place (e.g. injected synthetic tool responses).
      const rawMessages = req.__originalMessages || bodyData.messages;
      if (!req.__originalMessages) {
        // Deep-clone and stash once so every retry starts from clean client input
        try { req.__originalMessages = JSON.parse(JSON.stringify(bodyData.messages)); } catch { /* ignore */ }
      }
      bodyData.messages = JSON.parse(JSON.stringify(rawMessages));

      // 1. If upstream is not Anthropic, move the Anthropic 'system' field into the messages array first
      // so it can be normalized and merged by normalizeMessages.
      if (!baseUrl.includes('anthropic.com')) {
        const systemPrompt = normalizeSystemPrompt(bodyData.system);
        if (systemPrompt) {
          bodyData.messages = [...bodyData.messages];
          bodyData.messages.unshift({ role: 'system', content: systemPrompt });
          delete bodyData.system;
        }
      }

      // 2. Perform comprehensive normalization (alignment, turn merging, format conversion)
      const originalCount = bodyData.messages?.length || 0;
      bodyData.messages = normalizeMessages(bodyData.messages, bodyData.model);
      
      // DIAGNOSTIC LOGGING — enabled for any Gemini-routed request
      const isGeminiModel = bodyData.model && (
        bodyData.model.toLowerCase().includes('gemini') ||
        bodyData.model.toLowerCase().includes('google')
      );
      if (baseUrl.includes('qwqtao') || baseUrl.includes('tao') || isGeminiModel) {
        // console.log(`[proxy-debug] Upstream model: ${bodyData.model} → ${baseUrl}`);
        bodyData.messages.forEach((m, i) => {
          const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls.length : 0;
          const isTool = m.role === 'tool' ? 1 : 0;
          const tcIds = Array.isArray(m.tool_calls) ? m.tool_calls.map(tc => tc.id).join(',') : '';
          // console.log(`  msg[${i}] role=${m.role} content=${typeof m.content === 'string' ? m.content.slice(0, 30) + '...' : (m.content === null ? 'null' : '?')} tool_calls=${toolCalls}${tcIds ? ` [${tcIds}]` : ''} is_tool_resp=${isTool}${isTool ? ` id=${m.tool_call_id} name=${m.name}` : ''}`);
        });
      }
    }

    // Normalization: Convert tools and tool_choice if upstream is not Anthropic
    if (!baseUrl.includes('anthropic.com')) {
      if (bodyData.tools) {
        bodyData.tools = normalizeTools(bodyData.tools);
      }
      if (bodyData.tool_choice) {
        bodyData.tool_choice = normalizeToolChoice(bodyData.tool_choice);
      }
      
      // (bodyData.system already deleted above if present)
    }


    // Remove Anthropic-specific fields that cause 503 on non-Anthropic upstreams
    const FIELDS_TO_REMOVE = [
      'thinking', 'betas', 'top_k', 'context_management', 'output_config', 'metadata'
    ];
    FIELDS_TO_REMOVE.forEach(f => delete bodyData[f]);
  }

  // EcomAgent only supports: claude-opus-4-6, claude-opus-4.6, mmodel, claudex-4.7-5.4
  // Map ALL claude variants to claude-opus-4.6 (dot-notation required).
  // Sonnet, haiku, and any other claude model are NOT available on EcomAgent.
  if (isEcom && bodyData?.model) {
    const originalEcomModel = bodyData.model;
    // If it's any claude model that isn't already opus-4.6, remap to opus
    if (/claude/i.test(bodyData.model)) {
      bodyData.model = bodyData.model
        // First normalise hyphens → dots for opus-4.6
        .replace(/claude-opus-4-6/g, 'claude-opus-4.6')
        // Map claude-opus-4-7 / claude-opus-4.7 (new Opus 4.7 CLI default) → opus-4.6
        .replace(/claude-opus-4[-.]7[\w.-]*/g, 'claude-opus-4.6')
        // Map sonnet (any variant) → opus
        .replace(/claude-sonnet-4[-.]6/g, 'claude-opus-4.6')
        // Map haiku (any variant) → opus
        .replace(/claude-haiku[\w.-]*/g, 'claude-opus-4.6')
        // Map claude-3 legacy models → opus
        .replace(/claude-3[-\w.]*sonnet[\w.-]*/g, 'claude-opus-4.6')
        .replace(/claude-3[-\w.]*haiku[\w.-]*/g, 'claude-opus-4.6')
        .replace(/claude-3[-\w.]*opus[\w.-]*/g, 'claude-opus-4.6');
    }
    if (originalEcomModel !== bodyData.model) {
      // console.log(`[proxy] EcomAgent model remap: ${originalEcomModel} → ${bodyData.model}`);
    } else {
      // console.log(`[proxy] EcomAgent model name → ${bodyData.model}`);
    }
  }

  // Clamp max_tokens: some providers reject very large values
  if (bodyData?.max_tokens && bodyData.max_tokens > 8192) {
    bodyData.max_tokens = 8192;
  }


  // console.log(`[proxy] → ${req.method} ${upstreamUrl}${req.query ? '?' + new URLSearchParams(req.query) : ''}`);

  // Select agent based on URL protocol
  const agent = upstreamUrl.startsWith('http:') ? httpAgent : httpsAgent;

  return {
    method: req.method,
    url: upstreamUrl,
    headers,
    data: bodyData,
    responseType: 'stream',
    decompress: true,
    timeout: 120_000,
    params: req.query,
    httpAgent: agent === httpAgent ? agent : undefined,
    httpsAgent: agent === httpsAgent ? agent : undefined,
  };
}


function isChatGenerationRequest(req) {
  return req.path === '/messages' || req.path === '/chat/completions';
}

function initializeAttemptState(req, config) {
  if (req.__attemptState) return req.__attemptState;

  const applies = isChatGenerationRequest(req);
  const enabled = applies && config.request_minimization_enabled !== false;
  const parsedMaxAttempts = Number(config.chat_max_upstream_attempts);
  const maxAttempts = Number.isFinite(parsedMaxAttempts) && parsedMaxAttempts >= 1
    ? Math.floor(parsedMaxAttempts)
    : 4;

  req.__attemptState = {
    applies,
    enabled,
    maxAttempts,
    usedAttempts: 0,
  };

  return req.__attemptState;
}

function consumeAttempt(req) {
  const state = req.__attemptState;
  if (!state || !state.applies || !state.enabled) {
    return { allowed: true, state };
  }

  if (state.usedAttempts >= state.maxAttempts) {
    return { allowed: false, state };
  }

  state.usedAttempts += 1;
  return { allowed: true, state };
}

function canRetry(req) {
  const state = req.__attemptState;
  if (!state || !state.applies || !state.enabled) return true;
  return state.usedAttempts < state.maxAttempts;
}

function attemptLabel(req) {
  const state = req.__attemptState;
  if (!state || !state.applies || !state.enabled) return '';
  return ` (attempt ${state.usedAttempts}/${state.maxAttempts})`;
}

/**
 * Proxy middleware factory.
 * Forwards the request to upstream and streams the response back.
 */
async function proxyRequest(req, res) {
  const startTime = Date.now();
  const userId = req.user ? req.user._id : null;
  const accessKey = req.user ? req.user.accessKey : null;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: missing user context' });
  }

  const config = await loadConfig(userId);
  const attemptState = initializeAttemptState(req, config);
  const requestedModel = req.body?.model || 'unknown';

  const optimizationEnabled = true;
  const promptBudget = Number(config.prompt_budget_tokens) > 0 ? Number(config.prompt_budget_tokens) : 12000;
  const summarizationEnabled = true;
  const cacheEnabled = config.response_cache_enabled === true;
  const cacheTtlSeconds = Number(config.response_cache_ttl_seconds) > 0 ? Number(config.response_cache_ttl_seconds) : 30;
  const shouldOptimizePrompt = optimizationEnabled && isChatGenerationRequest(req) && req.body && Array.isArray(req.body.messages);

  let optimizationMeta = {
    enabled: optimizationEnabled,
    promptBudget,
    promptTokensBefore: null,
    promptTokensAfter: null,
    promptTokensAfterPrune: null,
    promptTokensAfterSummary: null,
    pruned: false,
    prunedCount: 0,
    summarized: false,
    summaryReplacedCount: 0,
    tokensSavedByPrune: 0,
    tokensSavedBySummary: 0,
    cacheEligible: false,
    cacheHit: false,
  };

  if (attemptState.applies && attemptState.enabled) {
    const { allowed, state } = consumeAttempt(req);
    if (!allowed) {
      const message = `Request attempt budget exhausted (${state.maxAttempts} max upstream attempts).`;
      console.warn(`[proxy] ${message}`);
      if (req.path.includes('/messages')) {
        return res.status(429).json({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message,
          }
        });
      }
      return res.status(429).json({
        error: {
          message,
          type: 'rate_limit_error',
          code: 'attempt_budget_exhausted',
        },
      });
    }
    // console.log(`[proxy] Outbound attempt ${state.usedAttempts}/${state.maxAttempts} for ${req.path}`);
  } else if (attemptState.applies) {
    // console.log('[proxy] Request minimization disabled for chat request');
  }

  if (shouldOptimizePrompt) {
    const preEstimate = estimatePromptTokens({
      system: req.body?.system,
      messages: req.body.messages,
    });
    optimizationMeta.promptTokensBefore = preEstimate;

    let currentTokens = preEstimate;

    if (promptBudget > 0 && preEstimate > promptBudget) {
      const pruneResult = pruneMessagesToBudget({
        messages: req.body.messages,
        system: req.body?.system,
        budget: promptBudget,
      });
      req.body.messages = pruneResult.messages;
      currentTokens = pruneResult.afterTokens;
      optimizationMeta.pruned = pruneResult.pruned;
      optimizationMeta.prunedCount = pruneResult.prunedCount;
      optimizationMeta.promptTokensAfterPrune = pruneResult.afterTokens;
      optimizationMeta.promptTokensAfterSummary = pruneResult.afterTokens;
      optimizationMeta.tokensSavedByPrune = Math.max(0, preEstimate - pruneResult.afterTokens);

      if (summarizationEnabled && pruneResult.afterTokens > promptBudget && !req.__summaryAttempted) {
        req.__summaryAttempted = true;
        const summaryResult = summarizeMessagesToBudget({
          messages: req.body.messages,
          system: req.body?.system,
          budget: promptBudget,
        });

        if (summaryResult.summarized) {
          req.body.messages = summaryResult.messages;
          currentTokens = summaryResult.afterTokens;
          optimizationMeta.summarized = true;
          optimizationMeta.summaryReplacedCount = summaryResult.replacedCount;
          optimizationMeta.promptTokensAfterSummary = summaryResult.afterTokens;
          optimizationMeta.tokensSavedBySummary = Math.max(0, pruneResult.afterTokens - summaryResult.afterTokens);
        } else {
          optimizationMeta.promptTokensAfterSummary = pruneResult.afterTokens;
        }
      }

      delete req.__originalMessages;
    } else {
      optimizationMeta.promptTokensAfterPrune = preEstimate;
      optimizationMeta.promptTokensAfterSummary = preEstimate;
    }

    optimizationMeta.promptTokensAfter = currentTokens;
  }

  // ── Short-Circuit: Serve /models locally from config ──────────────────────

  const cacheEligible = cacheEnabled && req.method === 'POST' && isChatGenerationRequest(req) && req.body?.stream !== true;
  optimizationMeta.cacheEligible = cacheEligible;

  let cacheKey = null;
  if (cacheEligible) {
    const requestedForCache = req.body?.model || '';
    const routedCacheUrl = config.model_routing && typeof config.model_routing === 'object'
      ? (config.model_routing[requestedForCache] || Object.entries(config.model_routing).find(([key]) => requestedForCache.startsWith(key))?.[1])
      : null;
    const cacheProviderId = req.__currentProviderId
      || (routedCacheUrl
        ? (Array.isArray(config.providers) ? config.providers.find((p) => p.baseUrl && p.baseUrl.replace(/\/+$/, '') === routedCacheUrl.replace(/\/+$/, ''))?.id : null)
        : null)
      || config.active_provider_id
      || 'active';

    cacheKey = createCacheKey(req.body, userId, cacheProviderId);
    const cached = readCachedResponse(responseCache, cacheKey);
    if (cached) {
      optimizationMeta.cacheHit = true;
      await addLog({
        method: req.method,
        path: req.path,
        model: requestedModel,
        status: 200,
        latencyMs: Date.now() - startTime,
        promptTokens: cached.usage?.prompt_tokens || 0,
        completionTokens: cached.usage?.completion_tokens || 0,
        streaming: false,
        provider: 'cache',
        optimization: optimizationMeta,
      }, userId, accessKey);
      return res.status(200).json(cached);
    }
  } else {
    optimizationMeta.cacheHit = false;
  }
  if (req.method === 'GET' && req.path === '/models') {
    const modelList = Array.isArray(config.model_catalogs) 
      ? config.model_catalogs.reduce((acc, cat) => acc.concat(cat.models || []), [])
      : [];
    const now = Math.floor(Date.now() / 1000);
    const data = modelList.map((m) => ({
      id: m.id,
      object: 'model',
      created: now,
      owned_by: m.owned_by || 'custom',
    }));
    return res.json({ object: 'list', data });
  }

  // ── Client-Requested Provider Override ────────────────────────────────
  // Allow clients to request a specific provider by ID or baseUrl match.
  // The override is respected only when the requested provider is actually
  // configured for this user. This lets the UI drive routing without
  // bypassing the user's saved provider list.
  const clientRequestedProviderId = req.body?.provider || req.query?.provider;
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const hasUsableProvider = (provider) => {
    if (!provider || typeof provider !== 'object') return false;
    const hasBaseUrl = typeof provider.baseUrl === 'string' && provider.baseUrl.trim().length > 0;
    const hasApiKey = Boolean(provider.apiKey) || (Array.isArray(provider.apiKeys) && provider.apiKeys.length > 0);
    return hasBaseUrl && hasApiKey;
  };

  let providerToUseId = config.active_provider_id;

  // req.__currentProviderId carries provider IDs set during auto-switch or
  // fallback retries — those take precedence over everything so we never
  // "undo" an automatic recovery decision.
  if (req.__currentProviderId) {
    providerToUseId = req.__currentProviderId;
  } else if (clientRequestedProviderId) {
    // Try to match by provider ID first, then by baseUrl suffix.
    const matchById = providers.find(
      (p) => p.id === clientRequestedProviderId
    );
    const matchByUrl = !matchById
      ? providers.find(
          (p) =>
            p.baseUrl &&
            p.baseUrl.replace(/\/+$/, '').endsWith(clientRequestedProviderId.replace(/\/+$/, ''))
        )
      : null;

    if (matchById || matchByUrl) {
      providerToUseId = (matchById || matchByUrl).id;
    }
  }

  const providerById = providers.find((p) => p.id === providerToUseId) || null;
  const firstUsableProvider = providers.find(hasUsableProvider) || null;
  const activeProvider = providerById && hasUsableProvider(providerById)
    ? providerById
    : (firstUsableProvider || providerById || providers[0] || null);
  let upstreamProvider = activeProvider;
  const providerName = activeProvider ? activeProvider.name : 'unknown';

  if (!activeProvider) {
    if (req.path.includes('/messages')) {
      return res.status(503).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'No provider configured. Please add a provider in Settings.'
        }
      });
    }
    return res.status(503).json({
      error: {
        message: 'No provider configured. Please add a provider in Settings.',
        type: 'server_error',
        code: 'no_provider',
      },
    });
  }

  let baseUrl = activeProvider.baseUrl;
  
  // ── API Key Selection ──────────────────────────────────────────────────────
  if (!req.__triedKeys) req.__triedKeys = {};
  if (!req.__triedKeys[activeProvider.id]) req.__triedKeys[activeProvider.id] = new Set();
  
  let apiKey = (activeProvider.apiKeys && activeProvider.apiKeys.length > 0)
    ? activeProvider.apiKeys.find(k => !req.__triedKeys[activeProvider.id].has(k))
    : activeProvider.apiKey;
  
  if (!apiKey && activeProvider.apiKey) apiKey = activeProvider.apiKey;
  apiKey = apiKey || '';

  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'none';
  // console.log(`[proxy] Active provider: ${activeProvider.name} (${baseUrl}) using key: ${maskedKey}`);

  // ── Model Routing Override ─────────────────────────────────────────────────
  // If config.model_routing maps the requested model to a specific baseUrl,
  // use that provider instead of the active one (allows per-model routing).
  // Note: We skip routing if we are in the middle of an auto-switch retry.
  const requestedModelForRouting = req.body?.model || '';
  if (!req.__currentProviderId && config.model_routing && typeof config.model_routing === 'object') {
    // Check exact match first, then prefix match (e.g. "gemini" covers all gemini-* models)
    const routeUrl =
      config.model_routing[requestedModelForRouting] ||
      Object.entries(config.model_routing).find(([key]) =>
        requestedModelForRouting.startsWith(key)
      )?.[1];

    if (routeUrl) {
      // Find the provider whose baseUrl matches so we can get its apiKey
      const routedProvider = providers.find(
        (p) => p.baseUrl && (p.baseUrl.replace(/\/+$/, '') === routeUrl.replace(/\/+$/, ''))
      );
      baseUrl = routeUrl;
      upstreamProvider = routedProvider || activeProvider;

      if (routedProvider) {
        if (!req.__triedKeys[routedProvider.id]) req.__triedKeys[routedProvider.id] = new Set();
        apiKey = (routedProvider.apiKeys && routedProvider.apiKeys.length > 0)
          ? routedProvider.apiKeys.find(k => !req.__triedKeys[routedProvider.id].has(k))
          : routedProvider.apiKey;
        if (!apiKey && routedProvider.apiKey) apiKey = routedProvider.apiKey;
      } else {
        apiKey = apiKey; // fall back to active key if not found
      }

      // console.log(
      //   `[proxy] model_routing: "${requestedModelForRouting}" → ${routeUrl}` +
      //   (routedProvider ? ` (${routedProvider.name})` : ' (key: inherited)')
      // );
    }
  }

  if (!apiKey) {
    console.error(`[proxy] ❌ No API key found for provider "${activeProvider.name}" (ID: ${activeProvider.id})`);
    if (req.path.includes('/messages')) {
      return res.status(503).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `No API key configured for provider "${activeProvider.name}". Please add one in the Dashboard Settings.`
        }
      });
    }
    return res.status(503).json({
      error: {
        message: `No API key configured for provider "${activeProvider.name}". Please add one in the Dashboard Settings.`,
        type: 'server_error',
        code: 'no_api_key',
      },
    });
  }

  // ── Model Mapping ──────────────────────────────────────────────────────────
  let targetModel = req.body?.model || 'unknown';

  // Sanitize: strip any leading slash from the model name (e.g. "/gemini-3.1-pro-preview" → "gemini-3.1-pro-preview")
  if (typeof targetModel === 'string' && targetModel.startsWith('/')) {
    const sanitized = targetModel.replace(/^\/+/, '');
    console.warn(`[proxy] ⚠ Model name had leading slash: "${targetModel}" → "${sanitized}"`);
    targetModel = sanitized;
    if (req.body) req.body.model = sanitized;
  }

  const originalModel = targetModel;
  if (config.model_mapping && config.model_mapping[targetModel]) {
    targetModel = config.model_mapping[targetModel];
    if (req.body) req.body.model = targetModel;
    // console.log(`[proxy] Mapping: ${originalModel} → ${targetModel}`);
  }

  // ── EcomAgent early model normalisation ───────────────────────────────────
  // EcomAgent only supports opus-class models (claude-opus-4-6, claude-opus-4.6).
  // Remap req.body.model NOW so that all downstream logic (isModelUnavailable,
  // provider auto-switch, buildUpstreamRequest) already sees the correct model.
  if (baseUrl.includes('ecom') && req.body?.model && /claude/i.test(req.body.model)) {
    const preEcom = req.body.model;
    req.body.model = req.body.model
      .replace(/claude-opus-4-6/g, 'claude-opus-4.6')
      // Map claude-opus-4-7 (Opus 4.7 — new CLI default) → opus-4.6
      .replace(/claude-opus-4[-.]7[\w.-]*/g, 'claude-opus-4.6')
      .replace(/claude-sonnet-[\w.-]+/g, 'claude-opus-4.6')
      .replace(/claude-haiku-[\w.-]+/g, 'claude-opus-4.6')
      .replace(/claude-3-[\w.-]+-sonnet[\w.-]*/g, 'claude-opus-4.6')
      .replace(/claude-3-[\w.-]+-haiku[\w.-]*/g, 'claude-opus-4.6')
      .replace(/claude-3-[\w.-]+-opus[\w.-]*/g, 'claude-opus-4.6');
    targetModel = req.body.model;
    if (preEcom !== req.body.model) {
      // console.log(`[proxy] EcomAgent early remap: ${preEcom} → ${req.body.model}`);
    }
  }

  const isStreaming = req.body?.stream === true;

  function pickFallbackModel(blockedModel, requestedModel) {
    const mapping = config.model_mapping && typeof config.model_mapping === 'object'
      ? config.model_mapping
      : {};
      const customModels = Array.isArray(config.model_catalogs)
        ? config.model_catalogs.reduce((acc, cat) => acc.concat(cat.models || []), []).map(m => m.id).filter(Boolean)
        : [];

    const isClaudeRequest = String(requestedModel || blockedModel || '').toLowerCase().startsWith('claude');

    const claudeCandidates = [
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-haiku-4-5-20251001',
    ];

    const candidates = isClaudeRequest
      ? [
          requestedModel,
          ...claudeCandidates,
          mapping[requestedModel],
          mapping['claude-opus-4-7'],
          mapping['claude-opus-4-6'],
          mapping['claude-sonnet-4-6'],
          mapping['claude-3-7-sonnet-20250219'],
          mapping['claude-3-5-sonnet-20241022'],
          mapping['claude-haiku-4-5-20251001'],
          ...customModels,
        ]
      : [
          requestedModel,
          mapping[requestedModel],
          ...Object.values(mapping),
          ...customModels,
        ];

    const resolveMappedModel = (modelId) => mapping[modelId] || modelId;
    const blockedResolvedModel = resolveMappedModel(blockedModel);

    const familyMatchers = [
      { name: 'zhipu', test: (s) => /(chatglm|glm|zhipu)/i.test(s) },
      { name: 'deepseek', test: (s) => /deepseek/i.test(s) },
      { name: 'qwen', test: (s) => /qwen/i.test(s) },
      { name: 'gpt', test: (s) => /(^|[^a-z])(gpt|o1|o3|o4)([^a-z]|$)/i.test(s) },
      { name: 'claude', test: (s) => /claude/i.test(s) },
    ];

    const referenceModel = String(requestedModel || blockedModel || '');
    const matchedFamily = familyMatchers.find((family) => family.test(referenceModel));
    const shouldRestrictToFamily = !isClaudeRequest && !!matchedFamily;

    const seenResolvedModels = new Set([blockedResolvedModel]);
    for (const modelId of candidates.filter(Boolean)) {
      const resolvedModel = resolveMappedModel(modelId);
      if (shouldRestrictToFamily && !matchedFamily.test(String(resolvedModel))) {
        continue;
      }
      if (seenResolvedModels.has(resolvedModel)) continue;
      seenResolvedModels.add(resolvedModel);
      return modelId;
    }

    return null;
  }

  // ── Optional Stub: short-circuit selected models when explicitly configured ──
  const stubModels = Array.isArray(config.stub_models) ? config.stub_models : [];
  if (stubModels.includes(targetModel)) {
    // console.log(`[proxy] STUB ACTIVE: Short-circuiting background request for: ${targetModel}`);
    const stubData = {
      id: `stub_${Math.random().toString(36).slice(2, 11)}`,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: [{ type: 'text', text: ' ' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }
    };
    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const events = [
        { event: 'message_start',       data: { type: 'message_start', message: stubData } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' ' } } },
        { event: 'content_block_stop',  data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta',       data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
        { event: 'message_stop',        data: { type: 'message_stop' } },
      ];
      events.forEach(ev => res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`));
      return res.end();
    }
    return res.json(stubData);
  }

  try {
    const axiosConfig = buildUpstreamRequest(req, baseUrl, apiKey);

    const upstreamRes = await axios(axiosConfig);

    // console.log(`[proxy] ← ${upstreamRes.status} ${upstreamRes.headers['content-type'] || 'unknown'}`);

    // Debug: capture and log non-2xx body from upstream
    if (upstreamRes.status >= 400) {
      const chunks = [];
      for await (const chunk of upstreamRes.data) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf-8');
      // Upstream error logged in catch block below
      const err = new Error(body);
      err.response = { status: upstreamRes.status, data: body };
      throw err;
    }


    // ── Detect request type ───────────────────────────────────────────────
    const isChatCompletions = req.path.includes('/chat/completions');
    const isMessages = req.path.includes('/messages');

    // Buffer if:
    // 1. Not streaming
    // 2. It's a non-completion route (e.g. /models)
    // 3. It IS a /messages route but we might need to translate (buffer to translate)
    const shouldBuffer = !isStreaming;

    if (!shouldBuffer) {
      res.status(upstreamRes.status);
      const forwardHeaders = ['content-type', 'transfer-encoding', 'cache-control', 'x-request-id'];
      forwardHeaders.forEach((h) => {
        if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
      });
    }

    // ── Body Handling ────────────────────────────────────────────────────
    let rawBody = '';
    let sseBuffer = ''; // for normalizing incomplete SSE lines in streaming mode
    let anthropicTranslator = null;
    if (isMessages && isStreaming) {
      anthropicTranslator = new AnthropicSSETranslator(res, requestedModel);
      anthropicTranslator.start();
    }

    upstreamRes.data.on('data', (chunk) => {
      const text = chunk.toString();
      rawBody += text;

      if (!shouldBuffer) {
        if (isStreaming) {
          sseBuffer += text;
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop(); // keep last incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') {
                if (!anthropicTranslator) res.write('data: [DONE]\n\n');
                // anthropicTranslator finishes on 'end' event below
                continue;
              }
              try {
                const obj = JSON.parse(payload);
                if (obj === null || typeof obj !== 'object') continue;

                if (anthropicTranslator) {
                  // If upstream is already Anthropic-format (has 'type' but no 'choices')
                  if (obj.type && !obj.choices) {
                    if (obj.type === 'message_start' || obj.type === 'ping') {
                      // Already sent our own or will handle it
                      continue;
                    }
                    if (obj.type === 'content_block_delta') {
                      anthropicTranslator.pushDelta(
                        obj.delta?.text || obj.delta?.text_delta?.text || '', 
                        obj.delta?.thinking || obj.delta?.thinking_delta?.thinking || ''
                      );
                    } else if (obj.type === 'message_delta') {
                       // Pass through usage if available, but let finish() handle the rest
                    }
                    continue;
                  }

                  // OpenAI-format translation
                  const choice = obj.choices?.[0];
                  const text = choice?.delta?.content || choice?.text || '';
                  const thinking = choice?.delta?.reasoning_content || '';
                  const toolCalls = choice?.delta?.tool_calls || [];
                  
                  if (text || thinking) {
                    anthropicTranslator.pushDelta(text, thinking);
                  }
                  
                  for (const tc of toolCalls) {
                    anthropicTranslator.pushToolCallDelta(tc);
                  }
                  continue;
                }

            // Strip null top-level fields (AgentRouter quirk)
            for (const key of Object.keys(obj)) {
              if (obj[key] === null) delete obj[key];
            }
            if (isChatCompletions && Array.isArray(obj.choices)) {
              obj.choices = obj.choices.map((c) => {
                if (!c || typeof c !== 'object') return c;
                const { flag, logprobs, ...rest } = c;
                return { ...rest, finish_reason: rest.finish_reason ?? null };
              });
            }
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
              } catch {
                if (!anthropicTranslator) res.write(`${line}\n`);
              }
        } else if (line.trim() !== '') {
          // Pass through 'event:', 'id:', 'retry:' etc
          res.write(`${line}\n`);
            }
          }
        } else {
          res.write(chunk);
        }
      }
    });

    upstreamRes.data.on('end', async () => {
      if (anthropicTranslator) {
        anthropicTranslator.finish();
      }

      let bufferedBody = null;
      if (shouldBuffer) {
        let finalBody = rawBody;
        let contentType = upstreamRes.headers['content-type'] || 'application/json';

        // Normalization: OpenAI clients expect /v1/models to return { data: [...] }
        if (req.path === '/models') {
          try {
            const parsed = JSON.parse(rawBody);
            let modelList = Array.isArray(parsed) ? parsed : (parsed.data || []);
            modelList = modelList.filter(m => m !== null);

            const customModels = Array.isArray(config.model_catalogs)
              ? config.model_catalogs.reduce((acc, cat) => acc.concat(cat.models || []), [])
              : [];

            if (customModels.length > 0) {
              modelList = [...modelList, ...customModels];
            }
            finalBody = JSON.stringify({ object: 'list', data: modelList });
          } catch (e) {
            console.error('[proxy] Failed to parse/normalize models:', e.message);
          }
        }

        // Normalization: Translate OpenAI /chat/completions to Anthropic /messages if requested
        if (isMessages) {
          try {
            const parsed = JSON.parse(rawBody);
            if (parsed.choices && Array.isArray(parsed.choices)) {
              // console.log('[proxy] Translating non-streaming OpenAI response to Anthropic format');
              const translated = translateOpenAIToAnthropic(parsed, requestedModel);
              finalBody = JSON.stringify(translated);
            }
          } catch (e) {
            console.error('[proxy] Failed to translate non-streaming response:', e.message);
          }
        }

        try {
          bufferedBody = JSON.parse(finalBody);
        } catch {
          bufferedBody = null;
        }

        res.status(upstreamRes.status);
        const forwardHeaders = ['content-type', 'cache-control', 'x-request-id'];
        forwardHeaders.forEach((h) => {
          if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
        });
        res.setHeader('content-type', contentType);
        res.setHeader('content-length', Buffer.byteLength(finalBody));
        res.write(finalBody);
      }

      res.end();

      let promptTokens = 0;
      let completionTokens = 0;
      try {
        if (isStreaming) {
          const lines = rawBody.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:') && !line.includes('[DONE]')) {
              const json = JSON.parse(line.slice(5).trim());
              if (json.usage) {
                promptTokens = json.usage.prompt_tokens || 0;
                completionTokens = json.usage.completion_tokens || 0;
              }
            }
          }
        } else {
          const json = bufferedBody || JSON.parse(rawBody);
          promptTokens = json.usage?.prompt_tokens || json.usage?.input_tokens || 0;
          completionTokens = json.usage?.completion_tokens || json.usage?.output_tokens || 0;
        }
      } catch {
        // Usage parse is best-effort
      }

      if (cacheEligible && !optimizationMeta.cacheHit && cacheKey && shouldBuffer && upstreamRes.status < 400 && bufferedBody) {
        storeCachedResponse(responseCache, cacheKey, bufferedBody, cacheTtlSeconds * 1000, RESPONSE_CACHE_MAX_ENTRIES);
      }

      await addLog({
        optimization: optimizationMeta,
        method: req.method,
        path: req.path,
        model: targetModel,
        status: upstreamRes.status,
        latencyMs: Date.now() - startTime,
        promptTokens,
        completionTokens,
        streaming: isStreaming,
        provider: providerName,
      }, userId, accessKey);
    });

    upstreamRes.data.on('error', async (err) => {
      console.error('[proxy] Stream error:', err.message);
      await addLog({
        method: req.method,
        path: req.path,
        model: targetModel,
        status: 500,
        latencyMs: Date.now() - startTime,
        streaming: isStreaming,
        provider: providerName,
        error: err.message,
        optimization: optimizationMeta,
      }, userId, accessKey);
      if (!res.headersSent) {
        if (req.path.includes('/messages')) {
          res.status(500).json({
            type: "error",
            error: {
              type: "api_error",
              message: err.message
            }
          });
        } else {
          res.status(500).json({
            error: {
              message: err.message,
              type: 'upstream_error',
              code: 'upstream_stream_error'
            }
          });
        }
      } else {
        if (isStreaming && req.path.includes('/messages')) {
          res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: err.message } })}\n\n`);
        }
        res.end();
      }
    });

    upstreamRes.data.on('close', () => {
      // console.log('[proxy] Upstream connection closed');
    });

  } catch (err) {
    const status = err.response?.status || 502;

    // When responseType:'stream', err.response.data is a Readable stream — NOT a
    // plain object. Calling JSON.stringify on it causes "circular structure" errors.
    // We must read the stream buffer to get the actual upstream error text.
    let message = err.message;
    if (err.response?.data && typeof err.response.data.pipe === 'function') {
      try {
        const chunks = [];
        for await (const chunk of err.response.data) chunks.push(chunk);
        message = Buffer.concat(chunks).toString('utf-8');
      } catch {
        message = err.message;
      }
    } else if (err.response?.data) {
      try { 
        message = typeof err.response.data === 'string' 
          ? err.response.data 
          : JSON.stringify(err.response.data); 
      } catch { message = err.message; }
    }

    try {
      const parsed = JSON.parse(message);
      if (parsed.error && parsed.error.message) {
        message = parsed.error.message;
      }
    } catch (e) {
      // Keep original message if it's not JSON
    }

    console.error(`[proxy] Upstream request failed (${status}): ${String(message).slice(0, 1200)}`);

    // Detect Gemini function-call/response parity error — retry with stripped tool history
    const isFunctionParityError =
      status === 400 &&
      /function response parts|function call parts/i.test(message);

    if (isFunctionParityError && !req.__functionParityRetried) {
      if (!canRetry(req)) {
        console.warn(`[proxy] ⚠ Gemini parity retry skipped: attempt budget exhausted${attemptLabel(req)}`);
      } else {
        req.__functionParityRetried = true;
        console.warn(`[proxy] ⚠ Gemini function-call/response parity error detected — retrying with stripped tool history${attemptLabel(req)}`);

      // Strip all tool-calling turns from the conversation, keeping only plain text turns.
      // This is a last-resort recovery so the user gets a response rather than a hard error.
      if (req.body && Array.isArray(req.body.messages)) {
        req.body.messages = req.body.messages.filter(m => {
          if (m.role === 'tool') return false;
          if ((m.role === 'assistant' || m.role === 'model') && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) return false;
          if ((m.role === 'assistant' || m.role === 'model') && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use')) return false;
          if (m.role === 'user' && Array.isArray(m.content) && m.content.every(b => b.type === 'tool_result')) return false;
          return true;
        });
        // Ensure there is at least one user message
        const hasUser = req.body.messages.some(m => m.role === 'user');
        if (!hasUser) {
          req.body.messages.push({ role: 'user', content: 'Please continue.' });
        }
        // Clear the snapshot so the cleaned messages are used as the new baseline
        delete req.__originalMessages;
      }
        return proxyRequest(req, res);
      }
    }

    // Detect EcomAgent "empty completion" error — transient, retry up to 2 times
    const isEmptyCompletionError =
      /model output must contain either output text or tool calls|model output error/i.test(message);

    if (isEmptyCompletionError) {
      if (!req.__emptyCompletionRetries) req.__emptyCompletionRetries = 0;
      if (req.__emptyCompletionRetries < 2) {
        if (!canRetry(req)) {
          console.warn(`[proxy] ⚠ Empty-completion retry skipped: attempt budget exhausted${attemptLabel(req)}`);
        } else {
          req.__emptyCompletionRetries++;
          console.warn(`[proxy] ⚠ Empty completion error from upstream — retrying (attempt ${req.__emptyCompletionRetries}/2)${attemptLabel(req)}`);
          return proxyRequest(req, res);
        }
      }
    }

    const isModelUnavailable =
      ((status === 400 || status === 403 || status === 404 || status === 503) &&
      /plan_model_forbidden|isn't available on your current plan|model.+not available|无可用渠道|no available channel/i.test(message)) ||
      (status === 500 && /sensitive words detected/i.test(message));

    // 0. Rate Limit Failover: Switch to next API key if available
    if (status === 429) {
      const currentProvider = providers.find(p => p.baseUrl && (baseUrl.replace(/\/+$/, '') === p.baseUrl.replace(/\/+$/, ''))) || activeProvider;
      if (!currentProvider?.id) {
        console.warn('[proxy] Rate limit handling skipped: no current provider context available.');
      } else {
        if (!req.__triedKeys) req.__triedKeys = {};
        if (!req.__triedKeys[currentProvider.id]) req.__triedKeys[currentProvider.id] = new Set();
        req.__triedKeys[currentProvider.id].add(apiKey);

        const nextKey = currentProvider.apiKeys?.find(k => !req.__triedKeys[currentProvider.id].has(k));
        if (nextKey) {
          if (!canRetry(req)) {
            console.warn(`[proxy] Rate-limit key-rotation retry skipped: attempt budget exhausted${attemptLabel(req)}`);
          } else {
            const maskedNextKey = `${nextKey.slice(0, 8)}...${nextKey.slice(-4)}`;
            console.warn(`[proxy] Rate limit (429) on ${currentProvider.name}; retrying with next API key: ${maskedNextKey}${attemptLabel(req)}`);
            return proxyRequest(req, res);
          }
        }
        console.warn(`[proxy] Rate limit (429) on ${currentProvider.name}; no more keys available.`);
      }
    }

    if (isModelUnavailable && req.body && req.body.model) {
      const blockedModel = req.body.model;

      // 1. Auto Provider Switch: Try other providers for the SAME model first
      if (!req.__triedProviders) req.__triedProviders = new Set();
      const failedProvider = upstreamProvider || activeProvider;
      if (failedProvider?.id) req.__triedProviders.add(failedProvider.id);

      const nextProvider = providers.find((p) => {
        const hasBaseUrl = typeof p.baseUrl === 'string' && p.baseUrl.trim().length > 0;
        const hasKey = p.apiKey || (p.apiKeys && p.apiKeys.length > 0);
        const isSameProvider = failedProvider?.id && p.id === failedProvider.id;
        return hasBaseUrl && hasKey && !isSameProvider && !req.__triedProviders.has(p.id);
      });
      
      if (nextProvider) {
        if (!canRetry(req)) {
          console.warn(`[proxy] Provider auto-switch retry skipped: attempt budget exhausted${attemptLabel(req)}`);
        } else {
          console.warn(`[proxy] Model ${blockedModel} unavailable on ${failedProvider?.name || activeProvider.name}; auto-switching to ${nextProvider.name}${attemptLabel(req)}`);
          req.__currentProviderId = nextProvider.id;
          // Keep the original requested model for the next provider
          return proxyRequest(req, res);
        }
      }

      // 2. Fallback Model: If ALL providers failed for this model, try a different model
      if (!req.__fallbackRetried) {
        const fallbackModel = pickFallbackModel(blockedModel, originalModel);

        if (fallbackModel) {
          if (!canRetry(req)) {
            console.warn(`[proxy] Fallback-model retry skipped: attempt budget exhausted${attemptLabel(req)}`);
          } else {
            console.warn(`[proxy] All providers denied model ${blockedModel}; retrying with fallback model ${fallbackModel}${attemptLabel(req)}`);
            req.__fallbackRetried = true;
            req.__triedProviders = new Set(); // Reset tried providers for the new model
            delete req.__currentProviderId;
            req.body.model = fallbackModel;
            return proxyRequest(req, res);
          }
        }
      }
    }

    await addLog({
      method: req.method,
      path: req.path,
      model: targetModel,
      status,
      latencyMs: Date.now() - startTime,
      streaming: isStreaming,
      provider: providerName,
      error: message,
      optimization: optimizationMeta,
    }, userId, accessKey);

    if (!res.headersSent) {
      const isUnauthorized = status === 401 || status === 403;
      const descriptiveMessage = isUnauthorized
        ? `Upstream provider "${providerName}" returned ${status} (Unauthorized). Verify the API key in Settings. Original error: ${message}`
        : message;

      if (req.path.includes('/messages')) {
        res.status(status).json({
          type: "error",
          error: {
            type: "api_error",
            message: descriptiveMessage
          }
        });
      } else {
        res.status(status).json({
          error: {
            message: descriptiveMessage,
            type: 'upstream_error',
            code: 'upstream_request_failed',
          },
        });
      }
    } else {
      if (isStreaming && req.path.includes('/messages')) {
        res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: message } })}\n\n`);
      }
      res.end();
    }
  }
}

module.exports = { proxyRequest };
