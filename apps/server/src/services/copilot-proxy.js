/**
 * services/copilot-proxy.js
 *
 * Forwards OpenAI-compatible requests to the GitHub Copilot API.
 * Handles:
 *   - Injecting required Copilot headers
 *   - Streaming and non-streaming responses
 *   - Dynamic model routing (Anthropic vs OpenAI format)
 *   - Auto token refresh via copilot-auth
 */

const https = require('https');
const { getCopilotToken } = require('./copilot-auth');

const COPILOT_API_HOST = 'api.githubcopilot.com';
const copilotAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60_000,
});

// Models that use Anthropic message format via Copilot
const ANTHROPIC_MODELS = [
  'claude-3.5-sonnet',
  'claude-3.5-haiku',
  'claude-3.7-sonnet',
  'claude-sonnet-4',
  'claude-opus-4',
];

// ── Model routing helpers ──────────────────────────────────────────────────────
function isAnthropicModel(modelId) {
  if (!modelId) return false;
  const lc = modelId.toLowerCase();
  return ANTHROPIC_MODELS.some((m) => lc.includes(m));
}

function contentToText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  return content
    .map((block) => {
      if (!block) return '';
      if (typeof block === 'string') return block;
      if (block.type === 'text') return block.text || '';
      if (block.text) return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toolResultToText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return contentToText(content);
  return JSON.stringify(content);
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;

  return tools
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return null;

      if (tool.type === 'function' && tool.function) {
        const name = tool.function.name || tool.name;
        if (!name) return null;
        return {
          type: 'function',
          function: {
            ...tool.function,
            name,
            parameters: tool.function.parameters || tool.parameters || { type: 'object', properties: {} },
          },
        };
      }

      const name = tool.name;
      if (!name) return null;
      return {
        type: 'function',
        function: {
          name,
          description: tool.description,
          parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
        },
      };
    })
    .filter(Boolean);
}

function normalizeToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any' || toolChoice.type === 'required') return 'required';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    };
  }
  return toolChoice;
}

function openAIFinishToAnthropic(finishReason) {
  if (finishReason === 'tool_calls' || finishReason === 'function_call') return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  if (finishReason === 'content_filter') return 'stop_sequence';
  return 'end_turn';
}

/**
 * Map Anthropic /v1/messages body → OpenAI /chat/completions body
 * (Copilot's Claude models accept OpenAI format via the chat/completions endpoint)
 */
function anthropicToOpenAI(body) {
  const messages = [];

  // Convert system prompt
  if (body.system) {
    const systemContent = contentToText(body.system);
    messages.push({ role: 'system', content: systemContent });
  }

  // Convert messages
  for (const msg of (body.messages || [])) {
    if (!msg || typeof msg !== 'object') continue;

    if (msg.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: msg.tool_call_id || msg.name || `call_${Math.random().toString(36).slice(2, 11)}`,
        name: msg.name,
        content: toolResultToText(msg.content || ''),
      });
      continue;
    }

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });
      continue;
    }

    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: contentToText(msg.content) });
      continue;
    }

    if (msg.role === 'assistant') {
      const textContent = contentToText(msg.content.filter((b) => b && b.type === 'text'));
      const toolCalls = msg.content
        .filter((b) => b && b.type === 'tool_use')
        .map((block) => ({
          id: block.id || `call_${Math.random().toString(36).slice(2, 11)}`,
          type: 'function',
          function: {
            name: block.name || 'unknown_tool',
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
          },
        }));

      messages.push({
        role: 'assistant',
        content: toolCalls.length > 0 ? (textContent || null) : textContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
      continue;
    }

    if (msg.role === 'user' && msg.content.some((b) => b && b.type === 'tool_result')) {
      for (const block of msg.content) {
        if (!block || block.type !== 'tool_result') continue;
        messages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id || `call_${Math.random().toString(36).slice(2, 11)}`,
          content: toolResultToText(block.content || ''),
        });
      }

      const textContent = contentToText(msg.content.filter((b) => b && b.type === 'text'));
      if (textContent) messages.push({ role: 'user', content: textContent });
      continue;
    }

    messages.push({ role: msg.role, content: contentToText(msg.content) });
  }

  const openAIBody = {
    model: body.model,
    messages,
    stream: body.stream || false,
  };

  if (body.max_tokens) openAIBody.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) openAIBody.temperature = body.temperature;
  if (body.top_p !== undefined) openAIBody.top_p = body.top_p;
  if (body.stop) openAIBody.stop = body.stop;
  if (body.tools) openAIBody.tools = normalizeTools(body.tools);
  if (body.tool_choice) openAIBody.tool_choice = normalizeToolChoice(body.tool_choice);

  return openAIBody;
}

/**
 * Map OpenAI chat/completions response → Anthropic /v1/messages response
 */
function openAIToAnthropic(openAIResponse, originalModel) {
  const choice = openAIResponse.choices?.[0];
  const content = choice?.message?.content || '';
  const toolCalls = choice?.message?.tool_calls || [];
  const contentBlocks = [];

  if (content) {
    contentBlocks.push({ type: 'text', text: content });
  }

  for (const toolCall of toolCalls) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function?.name || 'unknown_tool',
      input: safeJsonParse(toolCall.function?.arguments),
    });
  }

  return {
    id: openAIResponse.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    model: originalModel,
    stop_reason: openAIFinishToAnthropic(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openAIResponse.usage?.prompt_tokens || 0,
      output_tokens: openAIResponse.usage?.completion_tokens || 0,
    },
  };
}

class AnthropicSSETranslator {
  constructor(res, model) {
    this.res = res;
    this.model = model;
    this.sentMessageStart = false;
    this.hasTextBlock = false;
    this.textBlockIndex = 0;
    this.toolBlocks = new Map();
    this.stopReason = 'end_turn';
  }

  write(event, data) {
    this.res.write(`event: ${event}\n`);
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  start() {
    if (this.sentMessageStart) return;
    this.write('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    this.write('ping', { type: 'ping' });
    this.sentMessageStart = true;
  }

  pushText(text) {
    if (!text) return;
    this.start();
    if (!this.hasTextBlock) {
      this.write('content_block_start', {
        type: 'content_block_start',
        index: this.textBlockIndex,
        content_block: { type: 'text', text: '' },
      });
      this.hasTextBlock = true;
    }
    this.write('content_block_delta', {
      type: 'content_block_delta',
      index: this.textBlockIndex,
      delta: { type: 'text_delta', text },
    });
  }

  closeTextBlock() {
    if (!this.hasTextBlock) return;
    this.write('content_block_stop', {
      type: 'content_block_stop',
      index: this.textBlockIndex,
    });
    this.hasTextBlock = false;
  }

  pushToolCallDelta(toolCall) {
    if (!toolCall) return;
    this.start();
    this.closeTextBlock();

    const index = Number.isInteger(toolCall.index) ? toolCall.index : this.toolBlocks.size;
    const blockIndex = this.textBlockIndex + 1 + index;
    const fn = toolCall.function || {};

    if (!this.toolBlocks.has(index)) {
      const toolId = toolCall.id || `toolu_${Math.random().toString(36).slice(2, 11)}`;
      const name = fn.name || 'unknown_tool';
      this.toolBlocks.set(index, { blockIndex, id: toolId, name });
      this.write('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'tool_use', id: toolId, name, input: {} },
      });
    }

    if (fn.arguments) {
      this.write('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: fn.arguments },
      });
    }
  }

  finish(stopReason = this.stopReason) {
    this.start();
    this.closeTextBlock();

    for (const { blockIndex } of this.toolBlocks.values()) {
      this.write('content_block_stop', {
        type: 'content_block_stop',
        index: blockIndex,
      });
    }

    const finalStopReason = this.toolBlocks.size > 0 && stopReason === 'end_turn'
      ? 'tool_use'
      : stopReason;

    this.write('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: finalStopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    this.write('message_stop', { type: 'message_stop' });
  }
}

function writeAnthropicError(res, statusCode, message) {
  if (res.headersSent) {
    res.write(`event: error\ndata: ${JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message },
    })}\n\n`);
    return res.end();
  }

  return res.status(statusCode).json({
    type: 'error',
    error: { type: 'api_error', message },
  });
}

// ── Core proxy function ────────────────────────────────────────────────────────
async function proxyCopilotRequest(req, res, targetPath, requestBody, transformOptions = {}) {
  const token = await getCopilotToken(req.user?._id, req.user);
  const bodyStr = JSON.stringify(requestBody);
  const isStream = Boolean(requestBody.stream);
  const anthropicStreamModel = transformOptions.anthropicStreamModel || null;

  const requestOptions = {
    hostname: COPILOT_API_HOST,
    path: targetPath,
    method: 'POST',
    agent: copilotAgent,
    headers: {
      'Authorization':          `Bearer ${token}`,
      'Content-Type':           'application/json',
      'Content-Length':         Buffer.byteLength(bodyStr),
      'User-Agent':             'GitHubCopilotChat/0.26.7',
      'Editor-Version':         'vscode/1.99.0',
      'Editor-Plugin-Version':  'copilot-chat/0.26.7',
      'Copilot-Integration-Id': 'vscode-chat',
      'x-initiator':            'user',
      'openai-intent':          'conversation-edits',
      'Accept':                 isStream ? 'text/event-stream' : 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const upstream = https.request(requestOptions, (upstreamRes) => {
      const { statusCode } = upstreamRes;

      if (isStream) {
        if (anthropicStreamModel) {
          if (statusCode >= 400) {
            let data = '';
            upstreamRes.on('data', (chunk) => { data += chunk; });
            upstreamRes.on('end', () => {
              writeAnthropicError(res, statusCode, data || `Copilot upstream returned ${statusCode}`);
              resolve();
            });
            upstreamRes.on('error', reject);
            return;
          }

          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.status(statusCode);

          const translator = new AnthropicSSETranslator(res, anthropicStreamModel);
          translator.start();

          let buffer = '';
          upstreamRes.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;

              try {
                const obj = JSON.parse(payload);
                const choice = obj.choices?.[0];
                if (!choice) continue;

                const text = choice.delta?.content || choice.text || '';
                const reasoning = choice.delta?.reasoning_content || '';
                translator.pushText(reasoning ? `<think>\n${reasoning}\n</think>\n` : '');
                translator.pushText(text);

                for (const toolCall of (choice.delta?.tool_calls || [])) {
                  translator.pushToolCallDelta(toolCall);
                }

                if (choice.finish_reason) {
                  translator.stopReason = openAIFinishToAnthropic(choice.finish_reason);
                }
              } catch {
                // Ignore malformed keepalive lines.
              }
            }
          });
          upstreamRes.on('end', () => {
            translator.finish();
            res.end();
            resolve();
          });
          upstreamRes.on('error', reject);
          return;
        }

        // Stream SSE back to client
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(statusCode);
        upstreamRes.pipe(res);
        upstreamRes.on('end', resolve);
        upstreamRes.on('error', reject);
      } else {
        // Buffer non-streaming response
        let data = '';
        upstreamRes.on('data', (chunk) => { data += chunk; });
        upstreamRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            res.status(statusCode).json(parsed);
            resolve();
          } catch {
            res.status(statusCode).send(data);
            resolve();
          }
        });
        upstreamRes.on('error', reject);
      }
    });

    upstream.on('error', (err) => {
      console.error('[copilot-proxy] Upstream error:', err.message);
      reject(err);
    });

    upstream.write(bodyStr);
    upstream.end();
  });
}

// ── GET /models from Copilot ───────────────────────────────────────────────────
async function fetchCopilotModels(user = null) {
  const token = await getCopilotToken(user?._id, user);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: COPILOT_API_HOST,
      path: '/models',
      method: 'GET',
      agent: copilotAgent,
      headers: {
        'Authorization':          `Bearer ${token}`,
        'User-Agent':             'GitHubCopilotChat/0.26.7',
        'Editor-Version':         'vscode/1.99.0',
        'Editor-Plugin-Version':  'copilot-chat/0.26.7',
        'Copilot-Integration-Id': 'vscode-chat',
        'Accept':                 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Express route handlers ─────────────────────────────────────────────────────

/**
 * Handle POST /copilot/v1/chat/completions
 * Standard OpenAI-format requests — forwarded directly.
 */
async function handleChatCompletions(req, res) {
  try {
    await proxyCopilotRequest(req, res, '/chat/completions', req.body);
  } catch (err) {
    console.error('[copilot-proxy] chat/completions error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Copilot upstream error', message: err.message });
    }
  }
}

/**
 * Handle POST /copilot/v1/messages  (Anthropic format)
 * Converts Anthropic → OpenAI, proxies, converts response back.
 */
async function handleMessages(req, res) {
  try {
    const originalModel = req.body.model;
    const openAIBody = anthropicToOpenAI(req.body);
    const isStream = Boolean(req.body.stream);

    if (isStream) {
      const isInternalProxyHop = req.headers['x-ai-bridge-upstream-hop'] === '1';
      await proxyCopilotRequest(
        req,
        res,
        '/chat/completions',
        openAIBody,
        isInternalProxyHop ? {} : { anthropicStreamModel: originalModel }
      );
    } else {
      // Non-streaming: capture, convert, respond
      const token = await getCopilotToken(req.user?._id, req.user);
      const bodyStr = JSON.stringify(openAIBody);

      const result = await new Promise((resolve, reject) => {
        const options = {
          hostname: COPILOT_API_HOST,
          path: '/chat/completions',
          method: 'POST',
          agent: copilotAgent,
          headers: {
            'Authorization':          `Bearer ${token}`,
            'Content-Type':           'application/json',
            'Content-Length':         Buffer.byteLength(bodyStr),
            'User-Agent':             'GitHubCopilotChat/0.26.7',
            'Editor-Version':         'vscode/1.99.0',
            'Editor-Plugin-Version':  'copilot-chat/0.26.7',
            'Copilot-Integration-Id': 'vscode-chat',
            'x-initiator':            'user',
            'Accept':                 'application/json',
          },
        };

        const upstream = https.request(options, (upstreamRes) => {
          let data = '';
          upstreamRes.on('data', (c) => { data += c; });
          upstreamRes.on('end', () => {
            try { resolve({ status: upstreamRes.statusCode, data: JSON.parse(data) }); }
            catch { resolve({ status: upstreamRes.statusCode, data }); }
          });
          upstreamRes.on('error', reject);
        });

        upstream.on('error', reject);
        upstream.write(bodyStr);
        upstream.end();
      });

      const anthropicResp = openAIToAnthropic(result.data, originalModel);
      res.status(result.status).json(anthropicResp);
    }
  } catch (err) {
    console.error('[copilot-proxy] /messages error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Copilot upstream error', message: err.message });
    }
  }
}

/**
 * Handle GET /copilot/v1/models
 */
async function handleModels(req, res) {
  try {
    const { status, data } = await fetchCopilotModels(req.user);
    res.status(status).json(data);
  } catch (err) {
    console.error('[copilot-proxy] /models error:', err.message);
    res.status(502).json({ error: 'Failed to fetch Copilot models', message: err.message });
  }
}

module.exports = {
  handleChatCompletions,
  handleMessages,
  handleModels,
  fetchCopilotModels,
  isAnthropicModel,
};
