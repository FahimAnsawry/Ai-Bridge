
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
const {
  isNvidiaNimProvider,
  isNvidiaNimValue,
} = require('../utils/provider-detection');
const { sanitizeNvidiaNimRequestBody } = require('../utils/nvidia-nim');

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
  timeout: 300000,
  freeSocketTimeout: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 300000,
  freeSocketTimeout: 30000,
});

// Lazy connection warmup for NVIDIA NIM — pre-opens a TCP+TLS socket to
// integrate.api.nvidia.com so the first real request skips DNS + TLS handshake.
let nvidiaNimWarmedUp = false;
function warmupNvidiaNimConnection() {
  if (nvidiaNimWarmedUp) return;
  nvidiaNimWarmedUp = true;
  const req = https.request(
    'https://integrate.api.nvidia.com/v1/models',
    { method: 'GET', agent: httpsAgent, timeout: 10000 },
    (res) => { res.resume(); }
  );
  req.on('error', () => {});
  req.on('timeout', () => { req.destroy(); });
  req.end();
}

const responseCache = new Map();
const RESPONSE_CACHE_MAX_ENTRIES = 200;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 300_000;
const DEFAULT_NVIDIA_NIM_TIMEOUT_MS = DEFAULT_UPSTREAM_TIMEOUT_MS;
const DEFAULT_NVIDIA_NIM_SLOW_LOG_MS = 15_000;
const FREEMODEL_RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
const FREEMODEL_RATE_LIMIT_MAX_WAIT_MS = 65_000;
const FREEMODEL_RATE_LIMIT_MAX_RETRIES = 2;
const claudeSettingsCache = new Map();

// ── NVIDIA NIM Client-Side Rate Limiter ──────────────────────────────────────
// Proactively enforces RPM limit per model so requests never reach the
// upstream quota wall. Limit is configurable via env var; default is 35 RPM.
const NVIDIA_NIM_RPM_LIMIT = (() => { const v = parseInt(process.env.NVIDIA_NIM_RPM_LIMIT, 10); return Number.isFinite(v) && v > 0 ? v : 35; })();

class NvidiaNimRateLimiter {
  constructor(rpmLimit) {
    this.rpmLimit = rpmLimit;
    this._rpm = new Map(); // model -> sorted ms timestamps (last 60s)
  }

  _get(map, model, cutoff) {
    const times = (map.get(model) || []).filter(t => t > cutoff);
    map.set(model, times);
    return times;
  }

  /**
   * Acquire a rate-limit slot for the given model.
   * - If the per-minute quota is full: waits transparently until the next slot
   *   opens, then records and returns { blocked: false }.
   * - Otherwise: records immediately and returns { blocked: false }.
   */
  async acquire(model) {
    // Loop until a slot is available — handles concurrent waiters that all
    // wake up at the same time and would otherwise all push past the limit.
    while (true) {
      const rpm = this._get(this._rpm, model, Date.now() - 60_000);
      if (rpm.length < this.rpmLimit) break;
      const waitMs = Math.min(rpm[0] + 60_000 - Date.now() + 150, 65_000);
      console.warn(
        `[nvidia-nim-limiter] RPM limit (${this.rpmLimit}/min) reached for "${model}"; ` +
        `queuing request for ${(waitMs / 1000).toFixed(1)}s`
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    const ts = Date.now();
    this._get(this._rpm, model, ts - 60_000).push(ts);
    return { blocked: false };
  }

  /** Returns current usage stats for a model (for logging / debugging). */
  stats(model) {
    const now = Date.now();
    return {
      rpmUsed:  this._get(this._rpm, model, now - 60_000).length,
      rpmLimit: this.rpmLimit,
    };
  }
}

const nvidiaNimLimiter = new NvidiaNimRateLimiter(NVIDIA_NIM_RPM_LIMIT);

function getClaudeSettingsPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR ||
    (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.claude') : null) ||
    (process.env.HOME ? path.join(process.env.HOME, '.claude') : null);
  return configDir ? path.join(configDir, 'settings.json') : null;
}

function readClaudeSettings() {
  const settingsPath = getClaudeSettingsPath();
  if (!settingsPath) return null;

  let stat;
  try {
    stat = fs.statSync(settingsPath);
  } catch {
    claudeSettingsCache.delete(settingsPath);
    return null;
  }

  const cached = claudeSettingsCache.get(settingsPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.settings;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    claudeSettingsCache.set(settingsPath, { mtimeMs: stat.mtimeMs, settings });
    return settings;
  } catch (err) {
    console.warn(`[proxy] Failed to read Claude settings from ${settingsPath}: ${err.message}`);
    claudeSettingsCache.set(settingsPath, { mtimeMs: stat.mtimeMs, settings: null });
    return null;
  }
}

function writeClaudeSelectedModel(accessKey, model) {
  const settingsPath = getClaudeSettingsPath();
  const settings = readClaudeSettings();
  if (!settingsPath || !settings || typeof settings !== 'object') return false;

  const settingsToken = settings.env?.ANTHROPIC_AUTH_TOKEN;
  if (!accessKey || settingsToken !== accessKey) return false;

  const selectedModel = typeof model === 'string' ? model.trim() : '';
  if (!selectedModel) return false;

  settings.model = selectedModel;

  try {
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    const stat = fs.statSync(settingsPath);
    claudeSettingsCache.set(settingsPath, { mtimeMs: stat.mtimeMs, settings });
    return true;
  } catch (err) {
    console.warn(`[proxy] Failed to write Claude selected model to ${settingsPath}: ${err.message}`);
    claudeSettingsCache.delete(settingsPath);
    return false;
  }
}

function resolveClaudeSelectedModel(accessKey) {
  const settings = readClaudeSettings();
  if (!settings || typeof settings !== 'object') return null;

  const settingsToken = settings.env?.ANTHROPIC_AUTH_TOKEN;
  if (!accessKey || settingsToken !== accessKey) return null;

  const model = typeof settings.model === 'string' ? settings.model.trim() : '';
  return normalizeClaudeModelAlias(model) || null;
}

function normalizeClaudeModelAlias(model) {
  if (!model || typeof model !== 'string') return model;

  const normalized = model.trim();

  // Short alias: --model sonnet  →  claude-sonnet-4-6 (standard)
  if (/^\.?sonnet$/i.test(normalized)) {
    return 'claude-sonnet-4-6';
  }

  // 1M-context alias: --model sonnet[1m]  →  claude-sonnet-4.6
  if (/^\.?sonnet\[1m\]$/i.test(normalized)) {
    return 'claude-sonnet-4.6';
  }

  // Claude Code /model → Sonnet 4.6 (standard): claude-sonnet-4-6, claude-sonnet-4.6, claude-sonnet-4-6-20250514
  if (/^claude-sonnet-4[-.]6(?:-\d{8})?$/i.test(normalized)) {
    return 'claude-sonnet-4-6';
  }

  // Claude Code /model → Sonnet 4.6 (1M): claude-sonnet-4-6-20250514-1k, claude-sonnet-4.6-1m
  if (/^claude-sonnet-4[-.]6(?:-\d{8})?-1[km]$/i.test(normalized)) {
    return 'claude-sonnet-4.6';
  }

  // Map claude-opus-4.7 to claude-opus-4.6
  // if (/^claude-opus-4[-.]7$/i.test(normalized)) {
  //   return 'claude-opus-4.6';
  // }

  return model;
}

function getPositiveEnvMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getNvidiaNimTimeoutMs() {
  return getPositiveEnvMs('NVIDIA_NIM_MAX_LOCAL_WAIT_MS', DEFAULT_NVIDIA_NIM_TIMEOUT_MS);
}

function getNvidiaNimSlowLogMs() {
  return getPositiveEnvMs('NVIDIA_NIM_SLOW_LOG_MS', DEFAULT_NVIDIA_NIM_SLOW_LOG_MS);
}

function warnSlowNvidiaNimRequest({ phase, elapsedMs, model, providerName }) {
  const thresholdMs = getNvidiaNimSlowLogMs();
  if (!Number.isFinite(elapsedMs) || elapsedMs < thresholdMs) return;
  console.warn(
    `[proxy] Slow NVIDIA NIM ${phase}: ${elapsedMs}ms` +
    ` for model "${model || 'unknown'}"` +
    ` on ${providerName || 'NVIDIA NIM'}`
  );
}

function toTokenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function firstTokenCount(...values) {
  for (const value of values) {
    const count = toTokenCount(value);
    if (count !== null) return count;
  }
  return null;
}

function hasTokenUsageFields(usage) {
  if (!usage || typeof usage !== 'object') return false;
  return firstTokenCount(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.inputTokens,
    usage.completion_tokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.outputTokens,
    usage.total_tokens,
    usage.totalTokens
  ) !== null;
}

function normalizeTokenUsage(source = {}) {
  const usage = [
    source?.usage,
    source?.message?.usage,
    source?.choices?.[0]?.usage,
    source,
  ].find(hasTokenUsageFields) || {};

  const promptTokens = firstTokenCount(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.inputTokens
  );
  const completionTokens = firstTokenCount(
    usage.completion_tokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.outputTokens
  );
  const explicitTotal = firstTokenCount(usage.total_tokens, usage.totalTokens);
  const hasSplitUsage = promptTokens !== null || completionTokens !== null;
  const totalTokens = explicitTotal ?? (hasSplitUsage ? (promptTokens || 0) + (completionTokens || 0) : 0);

  return {
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    totalTokens,
    hasUsage: explicitTotal !== null || hasSplitUsage,
    hasExplicitTotal: explicitTotal !== null,
  };
}

function mergeTokenUsage(current, next) {
  if (!next?.hasUsage) return current;
  const promptTokens = next.promptTokens || current.promptTokens || 0;
  const completionTokens = next.completionTokens || current.completionTokens || 0;
  const splitTotal = promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens: next.hasExplicitTotal ? next.totalTokens : Math.max(splitTotal, next.totalTokens || 0, current.totalTokens || 0),
    hasUsage: true,
    hasExplicitTotal: next.hasExplicitTotal || current.hasExplicitTotal || false,
  };
}
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
    usage: (() => {
      const usage = normalizeTokenUsage(openaiRes);
      return {
        input_tokens: usage.promptTokens,
        output_tokens: usage.completionTokens,
      };
    })()
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

  finish(stopReason = 'end_turn', usage = {}) {
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
      usage: {
        input_tokens: usage.promptTokens || 0,
        output_tokens: usage.completionTokens || 0,
      }
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
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
  };

  if (apiKey && !(isFreeModelProvider(baseUrl) && isFreeModelPlaceholderApiKey(apiKey))) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

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
  const isCopilotBridge = /\/copilot\/v1\/?$/i.test(baseUrl) || baseUrl.includes('/copilot/v1');
  const isNvidiaNimRequest = req.__startedOnNvidiaNim === true ||
    req.__upstreamProviderIsNvidiaNim === true ||
    isNvidiaNimValue(baseUrl);
  // NIM is OpenAI-compatible for chat generation. Sending Anthropic /messages
  // payloads through unchanged can surface Python/vLLM errors such as
  // "unhashable type: 'dict'" when fields like tool_choice are objects.
  const useNativeNvidiaMessages = false;
  req.__nativeNvidiaNimMessages = useNativeNvidiaMessages;
  if (isCopilotBridge) {
    headers['x-ai-bridge-upstream-hop'] = '1';
  }

  if (upstreamPath.endsWith('/messages') && !isAnthropic && !isCopilotBridge && !useNativeNvidiaMessages) {
    // console.log(`[proxy] Mapping /messages → /chat/completions for ${isEcom ? 'ecom' : 'OpenAI-compatible'} upstream`);
    upstreamPath = upstreamPath.replace('/messages', '/chat/completions');
  }

  let cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  if (isNvidiaNimRequest) {
    cleanBaseUrl = cleanBaseUrl
      .replace(/\/v1\/chat\/completions$/i, '/v1')
      .replace(/\/chat\/completions$/i, '');
  }

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
    if (!useNativeNvidiaMessages && bodyData.messages) {
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
    if (!useNativeNvidiaMessages && !baseUrl.includes('anthropic.com')) {
      if (bodyData.tools) {
        bodyData.tools = normalizeTools(bodyData.tools);
      }
      if (bodyData.tool_choice) {
        bodyData.tool_choice = normalizeToolChoice(bodyData.tool_choice);
      }
      
      // (bodyData.system already deleted above if present)
    }


    // Remove Anthropic-specific fields that cause 503 on non-Anthropic upstreams
    if (!useNativeNvidiaMessages) {
      const FIELDS_TO_REMOVE = [
        'thinking', 'betas', 'top_k', 'context_management', 'output_config', 'metadata'
      ];
      FIELDS_TO_REMOVE.forEach(f => delete bodyData[f]);
    }

    if (isNvidiaNimRequest && !useNativeNvidiaMessages) {
      sanitizeNvidiaNimRequestBody(bodyData, { preserveTools: req.__nvidiaNimStripTools !== true });
    }

    // FreeModel: strip tools and flatten tool-call history.
    // api.freemodel.dev is a free, limited API that rejects requests with tool
    // definitions or tool-call/tool-result turns. After the first response,
    // Claude CLI includes its built-in tools on every subsequent request, which
    // causes FreeModel to return an error. We strip all tool-related fields and
    // flatten tool turns into plain-text so the conversation history stays valid.
    if (isFreeModelProvider(baseUrl)) {
      // FreeModel returns 401 on streaming requests — force non-streaming
      bodyData.stream = false;
      delete bodyData.tools;
      delete bodyData.tool_choice;
      if (Array.isArray(bodyData.messages)) {
        // Pass 1: Remove tool-role messages and flatten tool_calls turns
        bodyData.messages = bodyData.messages
          .map((msg) => {
            if (!msg || typeof msg !== 'object') return null;
            // Drop pure tool-result turns (role === 'tool')
            if (msg.role === 'tool') return null;

            // Handle Anthropic-format: assistant with content array containing tool_use blocks
            if ((msg.role === 'assistant' || msg.role === 'model') && Array.isArray(msg.content)) {
              const textBlocks = msg.content.filter(b => b && b.type === 'text');
              const hasToolUse = msg.content.some(b => b && b.type === 'tool_use');
              if (hasToolUse) {
                const textContent = textBlocks.map(b => b.text).join('\n').trim();
                return {
                  role: 'assistant',
                  content: textContent || '[tool call omitted]',
                };
              }
            }

            // Handle Anthropic-format: user with content array containing tool_result blocks.
            // Keep any text blocks; if nothing remains, drop the message entirely.
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              const hasToolResult = msg.content.some(b => b && b.type === 'tool_result');
              if (hasToolResult) {
                const textBlocks = msg.content.filter(b => b && b.type === 'text');
                if (textBlocks.length === 0) return null;
                return { role: 'user', content: textBlocks.map(b => b.text).join('\n').trim() };
              }
              // Flatten plain text-only content arrays to a string
              const allText = msg.content.every(b => b && b.type === 'text');
              if (allText) {
                return { role: 'user', content: msg.content.map(b => b.text).join('\n').trim() };
              }
            }

            // Handle OpenAI-format: assistant turns with tool_calls array
            if ((msg.role === 'assistant' || msg.role === 'model') &&
                Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
              const textContent = typeof msg.content === 'string' ? msg.content.trim() : '';
              return {
                role: 'assistant',
                content: textContent || '[tool call omitted]',
              };
            }
            // Strip tool_calls from assistant turns that have both text + tool calls
            if (msg.tool_calls) {
              const { tool_calls, ...rest } = msg;
              return rest;
            }
            return msg;
          })
          .filter(Boolean);

        // Pass 2: Collapse consecutive same-role turns (stripping can create them)
        const collapsed = [];
        for (const msg of bodyData.messages) {
          const last = collapsed[collapsed.length - 1];
          if (last && last.role === msg.role && msg.role !== 'tool' && typeof last.content === 'string' && typeof msg.content === 'string') {
            last.content = (last.content + '\n' + msg.content).trim();
          } else {
            collapsed.push({ ...msg });
          }
        }
        bodyData.messages = collapsed;

        // Pass 3: Ensure conversation starts with a user message (not assistant)
        const firstNonSys = bodyData.messages.findIndex(m => m.role !== 'system');
        if (firstNonSys >= 0 && bodyData.messages[firstNonSys].role !== 'user') {
          bodyData.messages.splice(firstNonSys, 0, {
            role: 'user',
            content: '[Context continued]',
          });
        }

        // Pass 4: Ensure messages array is non-empty
        // Note: Do NOT add a fake user message at the end - this corrupts conversation history
        // and causes FreeModel to stop responding after the first turn.
        if (bodyData.messages.length === 0) {
          bodyData.messages = [{ role: 'user', content: 'Hello' }];
        }
      }
    }
  }

  // EcomAgent only supports: claude-opus-4-6, claude-opus-4.6, mmodel, claudex-4.7-5.4
  // Map ALL claude variants to claude-opus-4.6 (dot-notation required).
  // Sonnet, haiku, and any other claude model are NOT available on EcomAgent.
  if (isEcom && bodyData?.model && req.__skipModelMappingForRateLimitFallback !== true && req.__strictProviderRouting !== true) {
    const originalEcomModel = bodyData.model;
    // If it's any claude model that isn't already opus-4.6, remap to opus
    if (/claude/i.test(bodyData.model)) {
      bodyData.model = bodyData.model
        // First normalise hyphens → dots for opus-4.6
        .replace(/claude-opus-4-6/g, 'claude-opus-4.6')
        // Map claude-opus-4-7 / claude-opus-4.7 (new Opus 4.7 CLI default) → opus-4.6
        .replace(/claude-opus-4[-.]7[\w.-]*/g, 'claude-opus-4.6')
        // Map sonnet (any variant) → opus
        .replace(/claude-sonnet-[\w.-]+/g, 'claude-opus-4.6')
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

  // Clamp max_tokens for NVIDIA NIM only — NIM rejects very large values
  // Kimi K2 supports up to 131072 output tokens; other NIM models cap at 8192
  if (isNvidiaNimRequest && bodyData?.max_tokens) {
    const isKimiModel = typeof bodyData.model === 'string' && /kimi/i.test(bodyData.model);
    const nimMaxTokens = isKimiModel ? 131072 : 8192;
    if (bodyData.max_tokens > nimMaxTokens) bodyData.max_tokens = nimMaxTokens;
  }

  if (
    bodyData?.stream === true &&
    upstreamPath.includes('/chat/completions') &&
    !isAnthropic &&
    !useNativeNvidiaMessages
  ) {
    bodyData.stream_options = {
      ...(bodyData.stream_options || {}),
      include_usage: true,
    };
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
    timeout: isNvidiaNimRequest ? getNvidiaNimTimeoutMs() : DEFAULT_UPSTREAM_TIMEOUT_MS,
    params: req.query,
    httpAgent: agent === httpAgent ? agent : undefined,
    httpsAgent: agent === httpsAgent ? agent : undefined,
  };
}


function isChatGenerationRequest(req) {
  return req.path === '/messages' || req.path === '/chat/completions' || req.path === '/responses';
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

function maskApiKey(apiKey) {
  const value = String(apiKey || '');
  if (!value) return 'none';
  if (value.length <= 12) return `${value.slice(0, 4)}...`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function getProviderApiKeys(provider) {
  const keys = [];
  const addKey = (key) => {
    if (typeof key !== 'string' || !key.trim()) return;
    if (!keys.includes(key)) keys.push(key);
  };

  if (Array.isArray(provider?.apiKeys)) {
    provider.apiKeys.forEach(addKey);
  }
  addKey(provider?.apiKey);

  return keys;
}

function isRetryableApiKeyFailure(status, message, rawUpstreamMessage, upstreamErrorCode, err) {
  if (!err?.response) return true;
  if ([401, 403, 408, 409, 425, 429].includes(status) || status >= 500) return true;

  const text = `${upstreamErrorCode || ''}\n${message || ''}\n${rawUpstreamMessage || ''}`;
  return /rate[-_\s]?limit|too many requests|quota|insufficient[-_\s]?(credit|credits|balance|funds)|credits?\s+exhausted|balance\s+exhausted|limit\s+exceeded|exceeded\s+quota|resource_exhausted/i.test(text);
}

async function retryWithNextProviderApiKey(req, res, provider, apiKey, details) {
  if (!provider?.id) {
    console.warn('[proxy] API-key failover skipped: no current provider context available.');
    return null;
  }

  const {
    status,
    message,
    rawUpstreamMessage,
    upstreamErrorCode,
    err,
  } = details || {};

  if (!isRetryableApiKeyFailure(status, message, rawUpstreamMessage, upstreamErrorCode, err)) {
    return null;
  }

  if (!req.__triedKeys) req.__triedKeys = {};
  if (!req.__triedKeys[provider.id]) req.__triedKeys[provider.id] = new Set();
  if (apiKey) req.__triedKeys[provider.id].add(apiKey);

  const keys = getProviderApiKeys(provider);
  const nextKey = keys.find(k => !req.__triedKeys[provider.id].has(k));
  const providerLabel = provider.name || provider.id;
  const reason = status ? `status ${status}` : 'network error';

  if (!nextKey) {
    req.__sameProviderKeyFailoverExhausted = true;
    console.warn(
      `[proxy] ${providerLabel} returned ${reason}; all API keys for this provider are exhausted. ` +
      'Provider fallback is skipped for API-key failover.'
    );
    return null;
  }

  if (!canRetry(req)) {
    console.warn(`[proxy] API-key failover retry skipped for ${providerLabel}: attempt budget exhausted${attemptLabel(req)}`);
    return sendAttemptBudgetExhausted(req, res);
  }

  req.__sameProviderRetryProviderId = provider.id;
  req.__sameProviderKeyFailoverExhausted = false;
  console.warn(
    `[proxy] ${providerLabel} returned ${reason} with API key ${maskApiKey(apiKey)}; ` +
    `retrying same provider with next API key ${maskApiKey(nextKey)}${attemptLabel(req)}`
  );
  await proxyRequest(req, res);
  return true;
}

function providerHasBaseUrlAndKey(provider) {
  if (!provider || typeof provider !== 'object') return false;
  const hasBaseUrl = typeof provider.baseUrl === 'string' && provider.baseUrl.trim().length > 0;
  const hasApiKey = isFreeModelProvider(provider)
    ? providerHasRealFreeModelApiKey(provider)
    : Boolean(provider.apiKey) || (Array.isArray(provider.apiKeys) && provider.apiKeys.length > 0);
  return hasBaseUrl && hasApiKey;
}

function normalizeBaseUrlForMatch(value) {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : '';
}

function normalizeRouteTargets(routeValue) {
  if (typeof routeValue === 'string') {
    const target = routeValue.trim();
    return target ? { legacyFixed: true, targets: [{ target, priority: 1 }] } : null;
  }

  if (!routeValue || typeof routeValue !== 'object' || Array.isArray(routeValue) || !Array.isArray(routeValue.providers)) {
    return null;
  }

  const targets = routeValue.providers
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const target = entry.trim();
        return target ? { target, priority: index + 1, index } : null;
      }

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const target = String(entry.target || entry.providerId || entry.baseUrl || '').trim();
      if (!target) return null;
      const parsedPriority = Number(entry.priority);
      return {
        target,
        priority: Number.isFinite(parsedPriority) && parsedPriority > 0 ? parsedPriority : index + 1,
        index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ target }, index) => ({ target, priority: index + 1 }));

  return targets.length > 0 ? { legacyFixed: false, targets } : null;
}

function buildModelRoute(model, key, routeValue, exact) {
  const route = normalizeRouteTargets(routeValue);
  if (!route) return null;
  return { model: key || model, exact, ...route };
}

function findModelRoute(model, modelRouting) {
  if (!model || !modelRouting || typeof modelRouting !== 'object' || Array.isArray(modelRouting)) return null;
  const requestedModel = String(model);
  const exactRoute = buildModelRoute(requestedModel, requestedModel, modelRouting[requestedModel], true);
  if (exactRoute) return exactRoute;

  // Fallback: Try matching without vendor prefix (e.g. "qwen/" in "qwen/qwen3.5-397b-a17b")
  if (requestedModel.includes('/')) {
    const requestedModelNoPrefix = requestedModel.split('/').slice(1).join('/');
    const noPrefixRoute = buildModelRoute(requestedModel, requestedModelNoPrefix, modelRouting[requestedModelNoPrefix], true);
    if (noPrefixRoute) return noPrefixRoute;
  }

  // Fallback 2: Try matching after normalizing both requested model and routing keys
  const requestedNormalized = normalizeClaudeModelAlias(requestedModel);
  for (const [key, routeValue] of Object.entries(modelRouting)) {
    if (normalizeClaudeModelAlias(key) === requestedNormalized) {
      const normalizedRoute = buildModelRoute(requestedModel, key, routeValue, true);
      if (normalizedRoute) return normalizedRoute;
    }
  }

  return Object.entries(modelRouting)
    .map(([key, routeValue]) => {
      if (!key || !requestedModel.startsWith(key)) return null;
      return buildModelRoute(requestedModel, key, routeValue, false);
    })
    .filter(Boolean)
    .sort((a, b) => b.model.length - a.model.length)
    [0] || null;
}

function resolveRoutedProvider(routeTarget, providers) {
  const target = String(routeTarget || '').trim();
  if (!target) return null;

  return (Array.isArray(providers) ? providers : []).find((provider) => {
    if (!provider) return false;
    if (provider.id === target) return true;
    const providerBaseUrl = normalizeBaseUrlForMatch(provider.baseUrl);
    const targetBaseUrl = normalizeBaseUrlForMatch(target);
    return providerBaseUrl && targetBaseUrl && providerBaseUrl === targetBaseUrl;
  }) || null;
}

function resolveRoutedProviders(route, providers) {
  if (!route?.targets) return [];
  const seenProviderIds = new Set();

  return route.targets
    .map((entry) => {
      const provider = resolveRoutedProvider(entry.target, providers);
      return provider ? { ...entry, provider } : { ...entry, provider: null };
    })
    .filter((entry) => {
      if (!entry.provider?.id) return true;
      if (seenProviderIds.has(entry.provider.id)) return false;
      seenProviderIds.add(entry.provider.id);
      return true;
    });
}

function getUsableRouteCandidates(route, providers) {
  return resolveRoutedProviders(route, providers)
    .filter((entry) => entry.provider && providerHasBaseUrlAndKey(entry.provider));
}

function getRouteTargetLabel(route) {
  return (route?.targets || []).map((entry) => entry.target).join(' → ');
}

function getRouteCacheProviderId(route) {
  if (!route || route.legacyFixed) return null;
  const signature = (route.targets || []).map((entry) => entry.target).join('>');
  return signature ? `route:${route.model}:${signature}` : null;
}

function getNextRouteProvider(req, failedProviderId) {
  const route = req.__modelRoute;
  if (!route || route.legacyFixed || !Array.isArray(route.candidates)) return null;

  if (!req.__triedProviders) req.__triedProviders = new Set();
  if (failedProviderId) req.__triedProviders.add(failedProviderId);

  const nextCandidate = route.candidates.find((candidate) => {
    const id = candidate.provider?.id;
    return id && !req.__triedProviders.has(id);
  });

  return nextCandidate?.provider || null;
}

function shouldRouteFailover(status, err, isModelUnavailable) {
  if (isModelUnavailable) return true;
  if (!err?.response) return true;
  if (status === 429) return true;
  return [500, 502, 503, 504].includes(status);
}

function sendModelRouteConfigError(req, res, message, code = 'invalid_model_route') {
  console.warn(`[proxy] ${message}`);

  if (req.path.includes('/messages')) {
    return res.status(503).json({
      type: 'error',
      error: {
        type: 'api_error',
        message,
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  }

  return res.status(503).json({
    error: {
      message,
      type: 'server_error',
      code,
    },
  });
}

function providerCanPreserveModelForRateLimitFallback(provider, model) {
  if (!providerHasBaseUrlAndKey(provider)) return false;
  if (!model || typeof model !== 'string') return true;

  // EcomAgent remaps Claude-family models in buildUpstreamRequest. A 429 fallback
  // must preserve the exact requested model to avoid changing output quality.
  if (provider.baseUrl && provider.baseUrl.toLowerCase().includes('ecom') && /claude/i.test(model)) {
    return false;
  }

  if (isTimyProvider(provider) && normalizeTimyModel(model) !== model) {
    return false;
  }

  return true;
}

function sendAttemptBudgetExhausted(req, res) {
  const state = req.__attemptState;
  const maxAttempts = state?.maxAttempts || 0;
  const message = `Request attempt budget exhausted (${maxAttempts} max upstream attempts).`;
  console.warn(`[proxy] ${message}`);

  if (req.path.includes('/messages')) {
    return res.status(429).json({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message,
      },
      usage: { input_tokens: 0, output_tokens: 0 },
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

const TIMY_SUPPORTED_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-7',
];

function isTimyProvider(providerOrBaseUrl) {
  const baseUrl = typeof providerOrBaseUrl === 'string'
    ? providerOrBaseUrl
    : providerOrBaseUrl?.baseUrl;
  return typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('timyai.com');
}

function normalizeTimyModel(model) {
  if (!model || typeof model !== 'string') return model;
  return model
    .replace(/^claude-sonnet-4\.6$/i, 'claude-sonnet-4-6')
    .replace(/^claude-opus-4\.6$/i, 'claude-opus-4-6')
    .replace(/^claude-opus-4\.7$/i, 'claude-opus-4-7');
}

function getTimyUnsupportedModelMessage(model) {
  return `Timy only supports these model ids: ${TIMY_SUPPORTED_MODELS.join(', ')}. Requested model: "${model || 'unknown'}".`;
}

function isFreeModelProvider(providerOrBaseUrl) {
  const baseUrl = typeof providerOrBaseUrl === 'string'
    ? providerOrBaseUrl
    : providerOrBaseUrl?.baseUrl;
  return typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('freemodel.dev');
}

function isFreeModelPlaceholderApiKey(apiKey) {
  return String(apiKey || '').trim().toLowerCase() === 'freemodel';
}

function providerHasRealFreeModelApiKey(provider) {
  if (!provider || typeof provider !== 'object') return false;
  const keys = Array.isArray(provider.apiKeys) && provider.apiKeys.length > 0
    ? provider.apiKeys
    : [provider.apiKey];
  return keys.some((key) => key && !isFreeModelPlaceholderApiKey(key));
}

function compactUpstreamErrorText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function getRateLimitWaitMs(retryAfterRaw, defaultWaitMs = FREEMODEL_RATE_LIMIT_DEFAULT_WAIT_MS) {
  if (retryAfterRaw) {
    const retryAfter = String(retryAfterRaw).trim();
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, FREEMODEL_RATE_LIMIT_MAX_WAIT_MS);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      const waitMs = retryAt - Date.now();
      if (waitMs > 0) return Math.min(waitMs, FREEMODEL_RATE_LIMIT_MAX_WAIT_MS);
    }
  }

  return defaultWaitMs;
}

function sendFreeModelRateLimitError(req, res) {
  const retries = req.__freeModelRateLimitRetries || 0;
  const message = `FreeModel is rate limited. Retried ${retries} time(s); please wait and try again.`;

  if (req.path.includes('/messages')) {
    return res.status(429).json({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message,
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  }

  return res.status(429).json({
    error: {
      message,
      type: 'rate_limit_error',
      code: 'freemodel_rate_limited',
    },
  });
}

function normalizeRemovedClaudeHaikuModel(model) {
  if (!model || typeof model !== 'string') return model;
  if (/^claude(?:\s+|-)haiku(?:\s+|-)4[.-]5(?:-[\w.-]+)?$/i.test(model)) {
    return 'claude-sonnet-4-6';
  }
  return model;
}

/**
 * parseKimiToolCallTokens — Parses moonshotai/kimi-style tool-call special tokens
 * embedded inside choice.delta.content into a standard tool_calls array.
 *
 * Kimi format (streamed as plain content text, not as tool_calls):
 *   <|tool_calls_section_begin|>
 *   <|tool_call_begin|>functions.Agent:0<|tool_call_argument_begin|>{...}<|tool_call_end|>
 *   <|tool_calls_section_end|>
 *
 * Returns { preSectionText, toolCalls } where toolCalls is an array compatible
 * with AnthropicSSETranslator.pushToolCallDelta().
 */
function parseKimiToolCallTokens(text) {
  const sectionStart = '<|tool_calls_section_begin|>';
  const sectionEnd   = '<|tool_calls_section_end|>';
  const callBegin    = '<|tool_call_begin|>';
  const argBegin     = '<|tool_call_argument_begin|>';
  const callEnd      = '<|tool_call_end|>';

  const secStartIdx = text.indexOf(sectionStart);
  const secEndIdx   = text.indexOf(sectionEnd);
  if (secStartIdx === -1 || secEndIdx === -1) return null;

  const preSectionText  = text.slice(0, secStartIdx);
  const postSectionText = text.slice(secEndIdx + sectionEnd.length);
  const sectionBody     = text.slice(secStartIdx + sectionStart.length, secEndIdx);

  const toolCalls = [];
  let searchPos = 0;
  let callIndex = 0;

  while (true) {
    const cbIdx = sectionBody.indexOf(callBegin, searchPos);
    if (cbIdx === -1) break;

    const afterCallBegin = cbIdx + callBegin.length;
    const argIdx = sectionBody.indexOf(argBegin, afterCallBegin);
    if (argIdx === -1) break;

    const ceIdx = sectionBody.indexOf(callEnd, argIdx + argBegin.length);
    if (ceIdx === -1) break;

    const funcRef   = sectionBody.slice(afterCallBegin, argIdx).trim();
    const argsRaw   = sectionBody.slice(argIdx + argBegin.length, ceIdx).trim();

    // funcRef format: "functions.FunctionName:index" or just "FunctionName"
    // Strip the namespace prefix and the trailing :index
    const funcName = funcRef
      .replace(/^[^.]+\./, '')  // remove "functions." prefix
      .replace(/:\d+$/, '');    // remove ":0", ":1" suffix

    toolCalls.push({
      index: callIndex,
      id: `toolu_kimi_${callIndex}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: {
        name: funcName || 'unknown_tool',
        arguments: argsRaw,
      },
    });

    callIndex++;
    searchPos = ceIdx + callEnd.length;
  }

  return { preSectionText, postSectionText, toolCalls };
}

/**
 * Proxy middleware factory.
 * Forwards the request to upstream and streams the response back.
 */
async function proxyRequest(req, res) {
  const startTime = Date.now();
  const userId = req.user ? req.user._id : null;
  const accessKey = req.user ? req.user.accessKey : null;
  const timing = {
    authMs: Number.isFinite(req.__authTimingMs) ? req.__authTimingMs : null,
    authCacheHit: req.__authCacheHit === true,
    configMs: null,
    requestBuildMs: null,
    upstreamHeadersMs: null,
    firstChunkMs: null,
    streamDrainMs: null,
  };

  if (!userId) {
    if (req.path.includes('/messages')) {
      return res.status(401).json({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Unauthorized: missing user context',
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }
    return res.status(401).json({ error: 'Unauthorized: missing user context' });
  }

  const configStart = Date.now();
  const config = await loadConfig(userId, { includeCatalogs: true });
  timing.configMs = Date.now() - configStart;
  const strictProviderRouting = isChatGenerationRequest(req);
  req.__strictProviderRouting = strictProviderRouting;
  if (strictProviderRouting && req.body && typeof req.body === 'object') {
    const requestModel = typeof req.body.model === 'string'
      ? normalizeClaudeModelAlias(req.body.model.trim())
      : '';
    const selectedModel = resolveClaudeSelectedModel(accessKey);

    if (selectedModel) {
      // Enforce the stored model selection for ALL requests.
      // Claude CLI sends background requests (tool calls, context compression, etc.)
      // with its own default model (e.g. claude-sonnet-4-6) even when the user
      // explicitly passed --model gpt-5.5. Without this guard those background
      // requests would silently overwrite the user's selection in settings.json
      // and all subsequent requests would switch to claude-sonnet-4-6.
      req.body.model = selectedModel;
    } else if (requestModel) {
      // No stored selection yet — use the request model and persist it.
      req.body.model = requestModel;
      writeClaudeSelectedModel(accessKey, requestModel);
    }
  }
  if (req.body?.model) {
    const normalizedAliasModel = normalizeClaudeModelAlias(req.body.model);
    if (normalizedAliasModel !== req.body.model) {
      req.body.model = normalizedAliasModel;
    }
    if (typeof req.body.model === 'string' && req.body.model.startsWith('/')) {
      req.body.model = req.body.model.replace(/^\/+/, '');
    }
  }
  const attemptState = initializeAttemptState(req, config);
  if (!strictProviderRouting && req.body?.model) {
    const normalizedModel = normalizeRemovedClaudeHaikuModel(req.body.model);
    if (normalizedModel !== req.body.model) {
      req.body.model = normalizedModel;
    }
  }
  const requestedModel = req.body?.model || 'unknown';

  // ── Model-Route Gate ──────────────────────────────────────────────────────
  // If model_routing has entries, only allow models that have a route defined.
  // Non-chat requests (embeddings, /models, audio, etc.) are exempt.
  if (isChatGenerationRequest(req) && req.body?.model) {
    const routing = config.model_routing;
    const hasAnyRoutes = routing && typeof routing === 'object' && !Array.isArray(routing) && Object.keys(routing).length > 0;
    if (hasAnyRoutes) {
      const route = findModelRoute(requestedModel, routing);
      if (!route) {
        const modelId = requestedModel;
        const message = `Model "${modelId}" is not added to model routes. Please add it in Settings → Model Routing before using it.`;
        console.warn(`[proxy] Model-route gate blocked: ${message}`);
        if (req.path.includes('/messages')) {
          return res.status(400).json({
            type: 'error',
            error: { type: 'invalid_request_error', message },
            usage: { input_tokens: 0, output_tokens: 0 }
          });
        }
        return res.status(400).json({
          error: { message, type: 'invalid_request_error', code: 'model_not_in_routes' },
        });
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const optimizationEnabled = config.token_optimization_enabled === true;
  const promptBudget = Number(config.prompt_budget_tokens) > 0 ? Number(config.prompt_budget_tokens) : 12000;
  const summarizationEnabled = config.token_summarization_enabled === true;
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
    const { allowed } = consumeAttempt(req);
    if (!allowed) {
      return sendAttemptBudgetExhausted(req, res);
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
  const configuredProviders = Array.isArray(config.providers) ? config.providers : [];
  const selectedProvidersForCache = configuredProviders.filter((p) => p?.isActive !== false);
  const eligibleProvidersForCache = selectedProvidersForCache;
  const preCacheModelRoute = findModelRoute(req.body?.model || '', config.model_routing);
  if (preCacheModelRoute) {
    const preCacheRouteCandidates = resolveRoutedProviders(preCacheModelRoute, configuredProviders);
    const preCacheUsableCandidates = preCacheRouteCandidates.filter((entry) => entry.provider && providerHasBaseUrlAndKey(entry.provider));
    if (preCacheModelRoute.legacyFixed) {
      const preCacheTarget = preCacheModelRoute.targets[0]?.target || '';
      const preCacheRoutedProvider = preCacheRouteCandidates[0]?.provider || null;
      if (!preCacheRoutedProvider) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${preCacheModelRoute.model}" points to provider "${preCacheTarget}", but that provider is not configured.`
        );
      }
      if (!providerHasBaseUrlAndKey(preCacheRoutedProvider)) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${preCacheModelRoute.model}" points to provider "${preCacheRoutedProvider.name || preCacheRoutedProvider.id}", but it is missing a base URL or API key.`,
          'model_route_provider_not_ready'
        );
      }
    } else if (preCacheUsableCandidates.length === 0) {
      return sendModelRouteConfigError(
        req,
        res,
        `Model route "${preCacheModelRoute.model}" has no usable configured providers. Targets: ${getRouteTargetLabel(preCacheModelRoute) || 'none'}.`,
        'model_route_provider_not_ready'
      );
    }
  }

  let cacheKey = null;
  if (cacheEligible) {
    const requestedForCache = req.body?.model || '';
    const routedCacheRoute = findModelRoute(requestedForCache, config.model_routing);
    const routedCacheTarget = routedCacheRoute?.legacyFixed ? routedCacheRoute.targets[0]?.target : null;
    const routedCacheProvider = routedCacheTarget
      ? resolveRoutedProvider(routedCacheTarget, configuredProviders)
      : null;
    const cacheProviderId = req.__currentProviderId
      || getRouteCacheProviderId(routedCacheRoute)
      || routedCacheProvider?.id
      || config.active_provider_id
      || 'active';

    cacheKey = createCacheKey(req.body, userId, cacheProviderId);
    const cached = readCachedResponse(responseCache, cacheKey);
    if (cached) {
      optimizationMeta.cacheHit = true;
      const cachedUsage = normalizeTokenUsage(cached);
      await addLog({
        method: req.method,
        path: req.path,
        model: requestedModel,
        status: 200,
        latencyMs: Date.now() - startTime,
        promptTokens: cachedUsage.promptTokens,
        completionTokens: cachedUsage.completionTokens,
        totalTokens: cachedUsage.totalTokens,
        streaming: false,
        provider: 'cache',
        optimization: optimizationMeta,
        performance: timing,
      }, userId, accessKey);
      return res.status(200).json(cached);
    }
  } else {
    optimizationMeta.cacheHit = false;
  }
  if (req.method === 'GET' && req.path === '/models') {
    const modelCatalogs = Array.isArray(config.model_catalogs) ? config.model_catalogs : [];
    const activeProviderForModels = configuredProviders.find((p) => p.id === config.active_provider_id) || null;
    const activeProviderIsNvidiaNim = isNvidiaNimProvider(activeProviderForModels);
    const activeCatalog = activeProviderForModels
      ? modelCatalogs.find((cat) => cat.providerId === activeProviderForModels.id)
      : null;
    const modelList = activeProviderIsNvidiaNim
      ? (activeCatalog?.models || [])
      : modelCatalogs.reduce((acc, cat) => acc.concat(cat.models || []), []);
    const now = Math.floor(Date.now() / 1000);
    const seenModelIds = new Set();
    const data = modelList
      .filter((m) => {
        if (!m?.id || seenModelIds.has(m.id)) return false;
        seenModelIds.add(m.id);
        return true;
      })
      .map((m) => ({
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
  const providers = configuredProviders;
  const selectedProviders = providers.filter((p) => p?.isActive !== false);
  const eligibleProviders = selectedProviders;
  const hasUsableProvider = providerHasBaseUrlAndKey;
  const requestedModelForRouting = req.body?.model || '';
  const fixedModelRoute = findModelRoute(requestedModelForRouting, config.model_routing);
  let fixedRouteProvider = null;
  let routeCandidates = [];

  if (fixedModelRoute) {
    // Fixed routes search ALL configured providers, not just the active/default one.
    // isActive on a provider only controls default-provider behavior and fallback eligibility,
    // not whether it can be explicitly targeted by a model route.
    routeCandidates = resolveRoutedProviders(fixedModelRoute, configuredProviders);

    if (fixedModelRoute.legacyFixed) {
      const routeTarget = fixedModelRoute.targets[0]?.target || '';
      fixedRouteProvider = routeCandidates[0]?.provider || null;
      if (!fixedRouteProvider) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${fixedModelRoute.model}" points to provider "${routeTarget}", but that provider is not configured.`
        );
      }
      if (!providerHasBaseUrlAndKey(fixedRouteProvider)) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${fixedModelRoute.model}" points to provider "${fixedRouteProvider.name || fixedRouteProvider.id}", but it is missing a base URL or API key.`,
          'model_route_provider_not_ready'
        );
      }
      req.__fixedModelRouteProviderId = fixedRouteProvider.id;
      req.__fixedModelRouteKey = fixedModelRoute.model;
    } else {
      routeCandidates = routeCandidates.filter((entry) => entry.provider && providerHasBaseUrlAndKey(entry.provider));
      if (routeCandidates.length === 0) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${fixedModelRoute.model}" has no usable configured providers. Targets: ${getRouteTargetLabel(fixedModelRoute) || 'none'}.`,
          'model_route_provider_not_ready'
        );
      }
      req.__modelRoute = {
        key: fixedModelRoute.model,
        legacyFixed: false,
        candidates: routeCandidates,
      };
      const routeProviderId = req.__sameProviderRetryProviderId || req.__currentProviderId;
      fixedRouteProvider = routeCandidates.find((entry) => entry.provider.id === routeProviderId)?.provider
        || routeCandidates[0].provider;
    }
  }

  const configuredActiveProvider = eligibleProviders.find((p) => p.id === config.active_provider_id) || null;
  const configuredActiveProviderIsNvidiaNim = isNvidiaNimProvider(configuredActiveProvider);
  let providerToUseId = fixedRouteProvider?.id || config.active_provider_id;

  // req.__currentProviderId carries provider IDs set during auto-switch or
  // fallback retries — those take precedence over everything so we never
  // "undo" an automatic recovery decision.
  if (fixedRouteProvider) {
    providerToUseId = fixedRouteProvider.id;
  } else if (req.__sameProviderRetryProviderId) {
    providerToUseId = req.__sameProviderRetryProviderId;
  } else if (req.__currentProviderId && !strictProviderRouting) {
    providerToUseId = req.__currentProviderId;
  } else if (clientRequestedProviderId && !configuredActiveProviderIsNvidiaNim && !strictProviderRouting) {
    // Try to match by provider ID first, then by baseUrl suffix.
    const matchById = eligibleProviders.find(
      (p) => p.id === clientRequestedProviderId
    );
    const matchByUrl = !matchById
      ? eligibleProviders.find(
          (p) =>
            p.baseUrl &&
            p.baseUrl.replace(/\/+$/, '').endsWith(clientRequestedProviderId.replace(/\/+$/, ''))
        )
      : null;

    if (matchById || matchByUrl) {
      providerToUseId = (matchById || matchByUrl).id;
    }
  } else if (strictProviderRouting && !fixedRouteProvider && requestedModelForRouting) {
    // Auto-detect provider from model catalogs when the selected model isn't in model_routing.
    // This ensures `claude --model gpt-5.5` routes to the provider that actually offers gpt-5.5,
    // rather than always falling back to the active provider.
    const modelCatalogs = Array.isArray(config.model_catalogs) ? config.model_catalogs : [];
    for (const catalog of modelCatalogs) {
      if (!catalog.providerId || !Array.isArray(catalog.models)) continue;
      const found = catalog.models.some(
        (m) => m && typeof m.id === 'string' && m.id === requestedModelForRouting
      );
      if (found) {
        // Only auto-route to providers that are configured and usable
        const catalogProvider = configuredProviders.find((p) => p.id === catalog.providerId);
        if (catalogProvider && providerHasBaseUrlAndKey(catalogProvider)) {
          providerToUseId = catalog.providerId;
          // console.log(`[proxy] Auto-routed model "${requestedModelForRouting}" → provider "${catalog.providerId}" via catalog`);
        }
        break;
      }
    }
  }

  // For fixed model routes, use the already-resolved fixedRouteProvider directly (it was resolved
  // from all configuredProviders). For other requests, look up in eligibleProviders as usual.
  const providerById = fixedRouteProvider || eligibleProviders.find((p) => p.id === providerToUseId) || null;
  const firstUsableProvider = eligibleProviders.find(hasUsableProvider) || null;
  
  const isNvidiaNimActive = isNvidiaNimProvider(providerById);

  const activeProvider = strictProviderRouting
    ? providerById
    : (providerById && hasUsableProvider(providerById)
      ? providerById
      : (isNvidiaNimActive ? providerById : (firstUsableProvider || providerById || eligibleProviders[0] || null)));
  const requestStartedOnNvidiaNim = isNvidiaNimProvider(activeProvider);
  req.__startedOnNvidiaNim = requestStartedOnNvidiaNim;
  if (requestStartedOnNvidiaNim) warmupNvidiaNimConnection();
    
  let upstreamProvider = activeProvider;
  let providerName = activeProvider ? activeProvider.name : 'unknown';

  if (!activeProvider) {
    if (req.path.includes('/messages')) {
      return res.status(503).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'No provider configured. Please add a provider in Settings.'
        },
        usage: { input_tokens: 0, output_tokens: 0 },
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
  if (isFreeModelProvider(activeProvider) && isFreeModelPlaceholderApiKey(apiKey)) {
    apiKey = '';
  }

  const maskedKey = maskApiKey(apiKey);
  // console.log(`[proxy] Active provider: ${activeProvider.name} (${baseUrl}) using key: ${maskedKey}`);

  if (!apiKey && !isFreeModelProvider(activeProvider)) {
    console.error(`[proxy] ❌ No API key found for provider "${activeProvider.name}" (ID: ${activeProvider.id})`);
    if (req.path.includes('/messages')) {
      return res.status(503).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `No API key configured for provider "${activeProvider.name}". Please add one in the Dashboard Settings.`
        },
        usage: { input_tokens: 0, output_tokens: 0 },
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

  // ── Model Selection ────────────────────────────────────────────────────────
  let targetModel = req.body?.model || 'unknown';

  // Sanitize: strip any leading slash from the model name (e.g. "/gemini-3.1-pro-preview" → "gemini-3.1-pro-preview")
  if (typeof targetModel === 'string' && targetModel.startsWith('/')) {
    const sanitized = targetModel.replace(/^\/+/, '');
    console.warn(`[proxy] ⚠ Model name had leading slash: "${targetModel}" → "${sanitized}"`);
    targetModel = sanitized;
    if (req.body) req.body.model = sanitized;
  }

  const originalModel = targetModel;
  const isCopilotProvider = /\/copilot\/v1\/?$/i.test(baseUrl) || baseUrl.includes('/copilot/v1');
  const isNvidiaNimUpstream = requestStartedOnNvidiaNim ||
    isNvidiaNimProvider(upstreamProvider) ||
    isNvidiaNimValue(providerName) ||
    isNvidiaNimValue(baseUrl);
  req.__upstreamProviderIsNvidiaNim = isNvidiaNimUpstream;

  if (isNvidiaNimUpstream && (!targetModel || targetModel === 'unknown' || /^claude[-.]/i.test(targetModel))) {
    let examples = [];
    try {
      const activeCatalog = (config.model_catalogs || []).find(
        (catalog) => catalog.providerId === upstreamProvider?.id || catalog.providerId === activeProvider?.id
      );
      examples = (activeCatalog?.models || [])
        .map((model) => model?.id)
        .filter(Boolean)
        .slice(0, 3);
    } catch {
      examples = [];
    }

    const exampleText = examples.length
      ? ` Try one of these synced NIM model ids: ${examples.join(', ')}.`
      : ' Sync NVIDIA NIM models in the dashboard, then set your client to one of those model ids.';
    const message = `NVIDIA NIM is active, but the client requested "${targetModel}". Set the client model to an NVIDIA NIM model id; the proxy will not substitute a default model.${exampleText}`;
    console.warn(`[proxy] ${message}`);

    if (req.path.includes('/messages')) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message,
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }

    return res.status(400).json({
      error: {
        message,
        type: 'invalid_request_error',
        code: 'invalid_nvidia_nim_model',
      },
    });
  }

  const skipModelMappingForRateLimitFallback = req.__skipModelMappingForRateLimitFallback === true;

  const normalizedRemovedModel = strictProviderRouting ? targetModel : normalizeRemovedClaudeHaikuModel(targetModel);
  if (normalizedRemovedModel !== targetModel) {
    targetModel = normalizedRemovedModel;
    if (req.body) req.body.model = targetModel;
  }

  if (!strictProviderRouting && isTimyProvider(baseUrl)) {
    const normalizedTimyModel = normalizeTimyModel(targetModel);
    if (normalizedTimyModel !== targetModel) {
      targetModel = normalizedTimyModel;
      if (req.body) req.body.model = normalizedTimyModel;
    }

    if (!TIMY_SUPPORTED_MODELS.includes(targetModel)) {
      const message = getTimyUnsupportedModelMessage(targetModel);
      console.warn(`[proxy] ${message}`);

      if (req.path.includes('/messages')) {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message,
          },
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      }

      return res.status(400).json({
        error: {
          message,
          type: 'invalid_request_error',
          code: 'invalid_timy_model',
        },
      });
    }
  }

  // ── EcomAgent early model normalisation ───────────────────────────────────
  // EcomAgent only supports opus-class models (claude-opus-4-6, claude-opus-4.6).
  // Remap req.body.model NOW so that all downstream logic (isModelUnavailable,
  // provider auto-switch, buildUpstreamRequest) already sees the correct model.
  if (!strictProviderRouting && !skipModelMappingForRateLimitFallback && baseUrl.includes('ecom') && req.body?.model && /claude/i.test(req.body.model)) {
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
        { event: 'message_delta',       data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 1, output_tokens: 1 } } },
        { event: 'message_stop',        data: { type: 'message_stop' } },
      ];
      events.forEach(ev => res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`));
      return res.end();
    }
    return res.json(stubData);
  }

  // ── NVIDIA NIM: proactive client-side rate limiting ───────────────────────
  // Enforce RPM limit before the upstream request to avoid hitting the
  // NVIDIA NIM quota wall and receiving a 429. The acquire() call waits
  // transparently when the per-minute bucket is full.
  if (isNvidiaNimUpstream && targetModel && targetModel !== 'unknown') {
    await nvidiaNimLimiter.acquire(targetModel);
    const { rpmUsed, rpmLimit } = nvidiaNimLimiter.stats(targetModel);
    console.log(`[nvidia-nim-limiter] Slot acquired for "${targetModel}" — RPM: ${rpmUsed}/${rpmLimit}`);
  }

  try {
    const buildStart = Date.now();
    const axiosConfig = buildUpstreamRequest(req, baseUrl, apiKey);
    timing.requestBuildMs = Date.now() - buildStart;

    const upstreamStart = Date.now();
    const upstreamRes = await axios(axiosConfig);
    timing.upstreamHeadersMs = Date.now() - upstreamStart;
    if (isNvidiaNimUpstream) {
      warnSlowNvidiaNimRequest({
        phase: 'headers',
        elapsedMs: timing.upstreamHeadersMs,
        model: targetModel,
        providerName,
      });
    }

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

    // FreeModel: log errors immediately before streaming starts
    // This ensures errors are captured even if the stream fails mid-response
    if (upstreamRes.status >= 400 && isFreeModelProvider(baseUrl)) {
      console.warn(`[proxy] FreeModel error: ${upstreamRes.status}`);
    }


    // ── Detect request type ───────────────────────────────────────────────
    const isChatCompletions = req.path.includes('/chat/completions');
    const isMessages = req.path.includes('/messages');
    const isNativeNvidiaNimMessages = req.__nativeNvidiaNimMessages === true;

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
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let capturedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, hasUsage: false };
    const captureUsage = (json) => {
      capturedUsage = mergeTokenUsage(capturedUsage, normalizeTokenUsage(json));
      promptTokens = capturedUsage.promptTokens;
      completionTokens = capturedUsage.completionTokens;
      totalTokens = capturedUsage.totalTokens;
    };
    let anthropicTranslator = null;
    if (isMessages && isStreaming && !isNativeNvidiaNimMessages) {
      anthropicTranslator = new AnthropicSSETranslator(res, requestedModel);
      anthropicTranslator.start();
    }
    // Buffer for NVIDIA NIM / Kimi models that embed tool calls as special tokens
    // inside choice.delta.content instead of using the standard tool_calls array.
    // Only activated when the upstream is NVIDIA NIM — zero effect on other providers.
    let kimiTextBuffer = '';

    upstreamRes.data.on('data', (chunk) => {
      if (timing.firstChunkMs === null) {
        timing.firstChunkMs = Date.now() - startTime;
        if (isNvidiaNimUpstream) {
          warnSlowNvidiaNimRequest({
            phase: 'first chunk',
            elapsedMs: timing.firstChunkMs,
            model: targetModel,
            providerName,
          });
        }
      }
      const text = chunk.toString();
      if (shouldBuffer) rawBody += text;

      if (!shouldBuffer) {
        if (isStreaming && isNativeNvidiaNimMessages) {
          res.write(chunk);
          return;
        }

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
                captureUsage(obj);

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
                  const deltaText = choice?.delta?.content || choice?.text || '';
                  const thinking = choice?.delta?.reasoning_content || '';
                  const toolCalls = choice?.delta?.tool_calls || [];

                  // NVIDIA NIM / Kimi: intercept tool-call special tokens that arrive
                  // as plain content text instead of in the tool_calls delta array.
                  // Also strip Kimi-internal special tokens (e.g. <|Memory|>, <|im_start|>)
                  // that leak into delta.content — these are model-internal context markers
                  // and must never be rendered as user-visible text.
                  if (isNvidiaNimUpstream && deltaText) {
                    // Strip any <|...|> special tokens that are NOT tool-call section markers.
                    // Tool-call markers are preserved so parseKimiToolCallTokens() can handle them.
                    const KIMI_TOOL_MARKERS = [
                      '<|tool_calls_section_begin|>',
                      '<|tool_calls_section_end|>',
                      '<|tool_call_begin|>',
                      '<|tool_call_argument_begin|>',
                      '<|tool_call_end|>',
                    ];
                    const cleanedDeltaText = deltaText.replace(/<\|[^|]+\|>/g, (token) =>
                      KIMI_TOOL_MARKERS.includes(token) ? token : ''
                    );
                    kimiTextBuffer += cleanedDeltaText;

                    if (kimiTextBuffer.includes('<|tool_calls_section_begin|>')) {
                      // Hold text until the closing marker arrives
                      if (kimiTextBuffer.includes('<|tool_calls_section_end|>')) {
                        const parsed = parseKimiToolCallTokens(kimiTextBuffer);
                        if (parsed && parsed.toolCalls.length > 0) {
                          if (parsed.preSectionText) {
                            anthropicTranslator.pushDelta(parsed.preSectionText, thinking);
                          }
                          for (const tc of parsed.toolCalls) {
                            anthropicTranslator.pushToolCallDelta(tc);
                          }
                          if (parsed.postSectionText) {
                            anthropicTranslator.pushDelta(parsed.postSectionText, '');
                          }
                        } else {
                          // Parse failed — emit the buffer as raw text so nothing is lost
                          anthropicTranslator.pushDelta(kimiTextBuffer, thinking);
                        }
                        kimiTextBuffer = '';
                      }
                      // else: still waiting for section_end — don't emit yet
                    } else {
                      // No Kimi tool tokens — safe to emit immediately
                      anthropicTranslator.pushDelta(kimiTextBuffer, thinking);
                      kimiTextBuffer = '';
                    }
                  } else {
                    if (deltaText || thinking) {
                      anthropicTranslator.pushDelta(deltaText, thinking);
                    }
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
      timing.streamDrainMs = timing.firstChunkMs === null
        ? null
        : Date.now() - startTime - timing.firstChunkMs;

      // Flush any Kimi content that was held waiting for a tool section that
      // never completed (e.g. model stopped mid-generation).
      if (anthropicTranslator && kimiTextBuffer) {
        anthropicTranslator.pushDelta(kimiTextBuffer, '');
        kimiTextBuffer = '';
      }

      if (anthropicTranslator) {
        anthropicTranslator.finish('end_turn', capturedUsage);
      }

      // FreeModel: ensure logging happens even for streaming responses
      // that may not trigger the normal error paths
      const isFreeModel = isFreeModelProvider(baseUrl);
      if (isFreeModel && upstreamRes.status >= 400) {
        console.warn(`[proxy] FreeModel streaming error: ${upstreamRes.status}`);
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
            captureUsage(parsed);
            if (parsed.choices && Array.isArray(parsed.choices)) {
              // console.log('[proxy] Translating non-streaming OpenAI response to Anthropic format');
              const translated = translateOpenAIToAnthropic(parsed, requestedModel);
              finalBody = JSON.stringify(translated);
            } else {
              // Ensure usage exists even if not translated
              const parsedFinal = JSON.parse(finalBody);
              if (parsedFinal && !parsedFinal.usage) {
                const usage = normalizeTokenUsage(parsedFinal);
                parsedFinal.usage = {
                  input_tokens: usage.promptTokens || 0,
                  output_tokens: usage.completionTokens || 0,
                };
                finalBody = JSON.stringify(parsedFinal);
              }
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

      try {
        if (!isStreaming) {
          const json = bufferedBody || JSON.parse(rawBody);
          captureUsage(json);
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
        totalTokens,
        streaming: isStreaming,
        provider: providerName,
        performance: timing,
      }, userId, accessKey);
    });

    upstreamRes.data.on('error', async (err) => {
      // 'aborted' means the client closed the connection before the upstream finished —
      // this is normal (Ctrl+C, tab close, CLI cancellation) and not a real server error.
      if (err.message === 'aborted' || err.code === 'ECONNRESET') {
        return; // client disconnected mid-stream — expected, no logging needed
      }
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
        performance: timing,
      }, userId, accessKey);
      if (!res.headersSent) {
        if (req.path.includes('/messages')) {
          res.status(500).json({
            type: "error",
            error: {
              type: "api_error",
              message: err.message
            },
            usage: { input_tokens: 0, output_tokens: 0 }
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
          res.write(`event: error\ndata: ${JSON.stringify({
            type: "error",
            error: { type: "api_error", message: err.message },
            usage: { input_tokens: 0, output_tokens: 0 },
          })}\n\n`);
        }
        res.end();
      }
    });

    upstreamRes.data.on('close', () => {
      // console.log('[proxy] Upstream connection closed');
    });

  } catch (err) {
    const status = err.response?.status || 502;
    // Capture retry-after header early — needed for NVIDIA NIM 429 backoff below.
    const retryAfterRaw = err.response?.headers?.['retry-after'] || err.response?.headers?.['x-ratelimit-reset-requests'] || '';
    const retryAfterSeconds = (() => {
      const val = parseInt(retryAfterRaw, 10);
      if (Number.isFinite(val) && val > 0) return Math.min(val, 65);
      // retry-after can also be an HTTP-date; treat it as unknown → use default
      return null;
    })();

    // When responseType:'stream', err.response.data is a Readable stream — NOT a
    // plain object. Calling JSON.stringify on it causes "circular structure" errors.
    // We must read the stream buffer to get the actual upstream error text.
    let message = err.message;
    let upstreamErrorCode = '';
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

    const rawUpstreamMessage = message;
    try {
      const parsed = JSON.parse(message);
      upstreamErrorCode = parsed.code || parsed.error?.code || '';
      if (parsed.error && parsed.error.message) {
        message = parsed.error.message;
      } else if (typeof parsed.error === 'string') {
        message = parsed.error;
      } else if (typeof parsed.message === 'string') {
        message = parsed.message;
      } else if (typeof parsed.title === 'string') {
        message = typeof parsed.detail === 'string' && parsed.detail.trim()
          ? `${parsed.title}: ${parsed.detail}`
          : parsed.title;
      }
    } catch (e) {
      // Keep original message if it's not JSON
    }

    const currentProvider = activeProvider?.id
      ? activeProvider
      : eligibleProviders.find(
          p => normalizeBaseUrlForMatch(p.baseUrl) && normalizeBaseUrlForMatch(baseUrl) === normalizeBaseUrlForMatch(p.baseUrl)
        ) || activeProvider;

    if (isFreeModelProvider(baseUrl)) {
      console.warn(`[proxy] FreeModel upstream status ${status}: ${compactUpstreamErrorText(message || rawUpstreamMessage)}`);
    } else {
      console.error(`[proxy] Upstream request failed (${status}): ${String(message).slice(0, 1200)}`);
    }

    const isNvidiaNimDictHashError =
      isNvidiaNimUpstream &&
      status >= 500 &&
      /unhashable type:\s*['"]dict['"]/i.test(`${message}\n${rawUpstreamMessage}`);

    if (isNvidiaNimDictHashError && !req.__nvidiaNimUnhashableRetried) {
      if (!canRetry(req)) {
        console.warn(`[proxy] NVIDIA NIM dict-hash retry skipped: attempt budget exhausted${attemptLabel(req)}`);
      } else {
        req.__nvidiaNimUnhashableRetried = true;
        req.__nvidiaNimStripTools = true;
        console.warn(`[proxy] NVIDIA NIM rejected a tool-preserving request with a dict-hash error; retrying once without tools${attemptLabel(req)}`);
        return proxyRequest(req, res);
      }
    }

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
      (/model_not_found|model_not_available|plan_model_forbidden/i.test(upstreamErrorCode) ||
      /plan_model_forbidden|isn't available on your current plan|model.+not available|model.+not found|model_not_found|无可用渠道|no available channel/i.test(message) ||
      /model_not_found|model_not_available|model.+not found|model.+not available/i.test(rawUpstreamMessage))) ||
      (status === 500 && /sensitive words detected/i.test(message));

    const keyFailoverResult = await retryWithNextProviderApiKey(req, res, currentProvider, apiKey, {
      status,
      message,
      rawUpstreamMessage,
      upstreamErrorCode,
      err,
    });
    if (keyFailoverResult) return keyFailoverResult;

    // 0. Rate Limit Failover: Provider-specific handling after same-provider keys are exhausted.
    if (status === 429) {
      if (isFreeModelProvider(currentProvider) || isFreeModelProvider(baseUrl)) {
        req.__freeModelRateLimitRetries = req.__freeModelRateLimitRetries || 0;
        if (req.__freeModelRateLimitRetries < FREEMODEL_RATE_LIMIT_MAX_RETRIES && canRetry(req)) {
          req.__freeModelRateLimitRetries++;
          const waitMs = getRateLimitWaitMs(retryAfterRaw);
          console.warn(
            `[proxy] FreeModel rate limit (429); waiting ${Math.round(waitMs / 1000)}s then retrying ` +
            `(${req.__freeModelRateLimitRetries}/${FREEMODEL_RATE_LIMIT_MAX_RETRIES})${retryAfterRaw ? '' : ' (no retry-after header)'}${attemptLabel(req)}`
          );
          await new Promise(resolve => setTimeout(resolve, waitMs));
          return proxyRequest(req, res);
        }

        if (!canRetry(req)) {
          console.warn(`[proxy] FreeModel rate-limit retry skipped: attempt budget exhausted${attemptLabel(req)}`);
        } else {
          console.warn(`[proxy] FreeModel rate limit (429); retry limit reached.`);
        }
        await addLog({
          method: req.method,
          path: req.path,
          model: targetModel,
          status,
          latencyMs: Date.now() - startTime,
          streaming: isStreaming,
          provider: providerName,
          error: 'FreeModel rate limited',
          optimization: optimizationMeta,
          performance: timing,
        }, userId, accessKey);
        return sendFreeModelRateLimitError(req, res);
      }

      const currentProviderIsNvidiaNim = req.__upstreamProviderIsNvidiaNim === true ||
        req.__startedOnNvidiaNim === true ||
        isNvidiaNimProvider(currentProvider) ||
        isNvidiaNimValue(providerName) ||
        isNvidiaNimValue(baseUrl);

      if (req.__fixedModelRouteProviderId) {
        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; fixed model route "${req.__fixedModelRouteKey}" is enabled, so provider fallback is skipped.`
        );
      } else if (req.__modelRoute && !req.__modelRoute.legacyFixed) {
        if (!req.__triedProviders) req.__triedProviders = new Set();
        if (currentProvider?.id) req.__triedProviders.add(currentProvider.id);

        const currentModelForFallback = req.body?.model || targetModel;
        const nextProvider = getNextRouteProvider(req, currentProvider?.id);
        if (nextProvider && providerCanPreserveModelForRateLimitFallback(nextProvider, currentModelForFallback)) {
          if (!canRetry(req)) {
            console.warn(`[proxy] Route provider fallback skipped: attempt budget exhausted${attemptLabel(req)}`);
            return sendAttemptBudgetExhausted(req, res);
          }
          console.warn(
            `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; ` +
            `retrying route "${req.__modelRoute.key}" with provider ${nextProvider.name || nextProvider.id}${attemptLabel(req)}`
          );
          req.__currentProviderId = nextProvider.id;
          req.__sameProviderKeyFailoverExhausted = false;
          req.__skipModelMappingForRateLimitFallback = true;
          if (req.body && currentModelForFallback) req.body.model = currentModelForFallback;
          return proxyRequest(req, res);
        }

        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; no route fallback provider remains for "${req.__modelRoute.key}".`
        );
      } else if (strictProviderRouting) {
        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; strict selected-provider routing is enabled, so provider fallback is skipped.`
        );
      } else if (currentProviderIsNvidiaNim) {
        // NVIDIA NIM 429: wait for retry-after (or a short default) and retry transparently.
        // The client never sees the error — it just experiences a brief pause.
        if (!req.__nvidiaNimRateLimitRetried) {
          if (!canRetry(req)) {
            console.warn(`[proxy] NVIDIA NIM rate-limit retry skipped: attempt budget exhausted${attemptLabel(req)}`);
          } else {
            req.__nvidiaNimRateLimitRetried = true;
            const waitMs = (retryAfterSeconds !== null ? retryAfterSeconds : 5) * 1000;
            console.warn(
              `[proxy] Rate limit (429) on NVIDIA NIM for model "${req.body?.model || targetModel}"; ` +
              `waiting ${waitMs / 1000}s then retrying${retryAfterSeconds === null ? ' (no retry-after header, using 5s default)' : ''}${attemptLabel(req)}`
            );
            await new Promise(resolve => setTimeout(resolve, waitMs));
            return proxyRequest(req, res);
          }
        } else {
          console.warn(
            `[proxy] Rate limit (429) on NVIDIA NIM; already retried once, giving up for model "${req.body?.model || targetModel}".`
          );
        }
      } else if (req.__sameProviderKeyFailoverExhausted) {
        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; same-provider API keys are exhausted, so provider fallback is skipped.`
        );
      } else {
        if (!req.__triedProviders) req.__triedProviders = new Set();
        if (currentProvider?.id) req.__triedProviders.add(currentProvider.id);

        const currentModelForFallback = req.body?.model || targetModel;
        const nextProvider = eligibleProviders.find((p) => {
          const isSameProvider = currentProvider?.id && p.id === currentProvider.id;
          return p.id &&
            !isSameProvider &&
            !req.__triedProviders.has(p.id) &&
            providerCanPreserveModelForRateLimitFallback(p, currentModelForFallback);
        });

        if (nextProvider) {
          if (!canRetry(req)) {
            console.warn(`[proxy] Rate-limit provider fallback skipped: attempt budget exhausted${attemptLabel(req)}`);
            return sendAttemptBudgetExhausted(req, res);
          } else {
            console.warn(
              `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; ` +
              `retrying same model "${currentModelForFallback}" with provider ${nextProvider.name || nextProvider.id}${attemptLabel(req)}`
            );
            req.__currentProviderId = nextProvider.id;
            req.__skipModelMappingForRateLimitFallback = true;
            if (req.body && currentModelForFallback) req.body.model = currentModelForFallback;
            return proxyRequest(req, res);
          }
        } else {
          console.warn(
            `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; no selected fallback provider can preserve model "${currentModelForFallback}".`
          );
        }
      }
    }

    if (req.__modelRoute && !req.__modelRoute.legacyFixed && shouldRouteFailover(status, err, isModelUnavailable)) {
      if (!req.__triedProviders) req.__triedProviders = new Set();
      const failedProvider = upstreamProvider || activeProvider || currentProvider;
      if (failedProvider?.id) req.__triedProviders.add(failedProvider.id);

      const nextProvider = getNextRouteProvider(req, failedProvider?.id);
      if (nextProvider) {
        if (!canRetry(req)) {
          console.warn(`[proxy] Route provider fallback skipped: attempt budget exhausted${attemptLabel(req)}`);
          return sendAttemptBudgetExhausted(req, res);
        }

        console.warn(
          `[proxy] Provider error (${status}) on ${failedProvider?.name || providerName}; ` +
          `retrying route "${req.__modelRoute.key}" with provider ${nextProvider.name || nextProvider.id}${attemptLabel(req)}`
        );
        req.__currentProviderId = nextProvider.id;
        req.__sameProviderKeyFailoverExhausted = false;
        return proxyRequest(req, res);
      }

      console.warn(
        `[proxy] Provider error (${status}) on ${failedProvider?.name || providerName}; no route fallback provider remains for "${req.__modelRoute.key}".`
      );
    }

    if (isModelUnavailable && req.body && req.body.model) {
      const blockedModel = req.body.model;

      // 1. Auto Provider Switch: Try other providers for the SAME model first
      if (!req.__triedProviders) req.__triedProviders = new Set();
      const failedProvider = upstreamProvider || activeProvider;
      if (failedProvider?.id) req.__triedProviders.add(failedProvider.id);

      const isNvidiaNim = req.__startedOnNvidiaNim === true ||
        isNvidiaNimProvider(activeProvider) ||
        isNvidiaNimProvider(upstreamProvider) ||
        isNvidiaNimValue(providerName) ||
        isNvidiaNimValue(baseUrl);

      const nextProvider = (req.__fixedModelRouteProviderId || strictProviderRouting || isNvidiaNim || req.__sameProviderKeyFailoverExhausted)
        ? null
        : eligibleProviders.find((p) => {
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
      } else {
        console.warn(
          `[proxy] Model ${blockedModel} unavailable on ${failedProvider?.name || activeProvider.name}; no selected fallback provider found. ` +
          `Selected providers: ${eligibleProviders.map((p) => p.name || p.id).join(', ') || 'none'}`
        );
      }

      // No fallback model substitution: return the provider error if the requested
      // model is unavailable after same-model provider failover.
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
      performance: timing,
    }, userId, accessKey);

    if (!res.headersSent) {
      const isUnauthorized = status === 401 || status === 403;
      const descriptiveMessage = isUnauthorized
        ? (isTimyProvider(baseUrl)
          ? `Upstream provider "${providerName}" returned ${status}. Original error: ${message}`
          : `Upstream provider "${providerName}" returned ${status} (Unauthorized). Verify the API key in Settings. Original error: ${message}`)
        : message;

      if (req.path.includes('/messages')) {
        res.status(status).json({
          type: "error",
          error: {
            type: "api_error",
            message: descriptiveMessage
          },
          usage: { input_tokens: 0, output_tokens: 0 }
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
        res.write(`event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "api_error", message: message },
          usage: { input_tokens: 0, output_tokens: 0 },
        })}\n\n`);
      }
      res.end();
    }
  }
}

module.exports = { proxyRequest, warmupNvidiaNimConnection };
