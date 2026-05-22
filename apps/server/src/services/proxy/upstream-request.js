const http = require('http');
const https = require('https');
const {
  normalizeMessages,
  normalizeTools,
  normalizeToolChoice,
  normalizeSystemPrompt,
  sanitizeCpassAnthropicBody,
} = require('./message-normalization');
const {
  isFreeModelProvider,
  isCcFreeModelProvider,
  isBlazeApiProvider,
  isCpassProvider,
  normalizeBlazeApiBaseUrl,
  isFreeModelPlaceholderApiKey,
} = require('./provider-utils');

const DEFAULT_UPSTREAM_TIMEOUT_MS = 300_000;
const DEFAULT_CPASS_TIMEOUT_MS = Number(process.env.CPASS_UPSTREAM_TIMEOUT_MS || 45_000);

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
    headers['version'] = '0.107.0';
    headers['user-agent'] = 'codex_cli_rs/0.107.0';
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
  const isBlazeApi = isBlazeApiProvider(baseUrl);
  const isCopilotBridge = /\/copilot\/v1\/?$/i.test(baseUrl) || baseUrl.includes('/copilot/v1');
  const isCpassRequest = isCpassProvider({
    baseUrl,
    name: req.__upstreamProviderName,
    id: req.__upstreamProviderId,
  });
  const isAnthropicCompatible = isAnthropic || isCpassRequest || isCcFreeModelProvider(baseUrl);
  req.__upstreamProviderIsAnthropicCompatible = isAnthropicCompatible;
  if (isCopilotBridge) {
    headers['x-ai-bridge-upstream-hop'] = '1';
  }

  if (isAnthropicCompatible) {
    headers['anthropic-version'] = req.headers['anthropic-version'] || '2023-06-01';
    if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'];
    if (apiKey && !(isFreeModelProvider(baseUrl) && isFreeModelPlaceholderApiKey(apiKey))) {
      headers['x-api-key'] = apiKey;
    }
    headers['accept'] = req.body?.stream === true ? 'text/event-stream' : 'application/json';
  }

  if (upstreamPath.endsWith('/messages') && !isAnthropicCompatible && !isCopilotBridge) {
    // console.log(`[proxy] Mapping /messages → /chat/completions for ${isEcom ? 'ecom' : 'OpenAI-compatible'} upstream`);
    upstreamPath = upstreamPath.replace('/messages', '/chat/completions');
  }

  let cleanBaseUrl = isBlazeApi
    ? normalizeBlazeApiBaseUrl(baseUrl)
    : baseUrl.replace(/\/+$/, '');

  if (isBlazeApi) {
    upstreamPath = upstreamPath.replace(/^\/v1(?=\/|$)/i, '');
    upstreamPath = upstreamPath.replace(/^\/api(?=\/|$)/i, '');
    if (!upstreamPath.startsWith('/')) {
      upstreamPath = '/' + upstreamPath;
    }
  } else if (isGitHubModels) {
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
    if (isCpassRequest) {
      bodyData = sanitizeCpassAnthropicBody(bodyData);
    }
    // Normalization: Ensure valid messages for common upstreams
    if (!isAnthropicCompatible && bodyData.messages) {
      // Restore original (pre-normalization) messages on retry so we don't
      // double-normalize — previous calls may have mutated req.body.messages
      // in-place (e.g. injected synthetic tool responses).
      const rawMessages = req.__originalMessages || bodyData.messages;
      if (!req.__originalMessages) {
        // Deep-clone and stash once so every retry starts from clean client input
        try { req.__originalMessages = JSON.parse(JSON.stringify(bodyData.messages)); } catch { /* ignore */ }
      }
      bodyData.messages = JSON.parse(JSON.stringify(rawMessages));

      // 1. If upstream is not Anthropic-compatible, move the Anthropic 'system' field into the messages array first
      // so it can be normalized and merged by normalizeMessages.
      const systemPrompt = normalizeSystemPrompt(bodyData.system);
      if (systemPrompt) {
        bodyData.messages = [...bodyData.messages];
        bodyData.messages.unshift({ role: 'system', content: systemPrompt });
        delete bodyData.system;
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
    if (!isAnthropicCompatible) {
      if (bodyData.tools) {
        bodyData.tools = normalizeTools(bodyData.tools);
      }
      if (bodyData.tool_choice) {
        bodyData.tool_choice = normalizeToolChoice(bodyData.tool_choice);
      }
      
      // (bodyData.system already deleted above if present)
    }


    // Remove Anthropic-specific fields that cause 503 on non-Anthropic upstreams
    if (!isAnthropicCompatible) {
      const FIELDS_TO_REMOVE = [
        'thinking', 'betas', 'top_k', 'context_management', 'output_config', 'metadata'
      ];
      FIELDS_TO_REMOVE.forEach(f => delete bodyData[f]);
    }

    // FreeModel: strip tools and flatten tool-call history.
    // api.freemodel.dev is a free, limited API that rejects requests with tool
    // definitions or tool-call/tool-result turns. After the first response,
    // Claude CLI includes its built-in tools on every subsequent request, which
    // causes FreeModel to return an error. We strip all tool-related fields and
    // flatten tool turns into plain-text so the conversation history stays valid.
    if (isFreeModelProvider(baseUrl) && !isCcFreeModelProvider(baseUrl)) {
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

  if (
    bodyData?.stream === true &&
    upstreamPath.includes('/chat/completions') &&
    !isAnthropicCompatible
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
    timeout: isCpassRequest ? DEFAULT_CPASS_TIMEOUT_MS : DEFAULT_UPSTREAM_TIMEOUT_MS,
    // The local shell may set HTTP(S)_PROXY to 127.0.0.1:9 to disable tool
    // network access. Provider traffic must go direct unless explicitly coded.
    proxy: false,
    params: req.query,
    httpAgent: agent === httpAgent ? agent : undefined,
    httpsAgent: agent === httpsAgent ? agent : undefined,
  };
}

module.exports = {
  buildUpstreamRequest,
};
