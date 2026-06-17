const { normalizeTokenUsage } = require('./token-usage');

function repairJsonText(text) {
  if (typeof text !== 'string') return text;
  try {
    JSON.parse(text);
    return text;
  } catch {
    const repaired = text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      return text;
    }
  }
}

function findBalancedJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return '';
}

function parseMalformedToolCallsFromText(text) {
  if (typeof text !== 'string' || !text.includes('"tool_calls"')) return [];

  const calls = [];
  const functionPattern = /"function"\s*:\s*\{/g;
  let match;
  while ((match = functionPattern.exec(text))) {
    const functionStart = match.index;
    const functionEnd = findBalancedJsonObject(text, text.indexOf('{', functionStart));
    if (!functionEnd) break;

    const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(functionEnd);
    const argsMatch = /"arguments"\s*:\s*"/.exec(functionEnd);
    if (!nameMatch || !argsMatch) {
      functionPattern.lastIndex = functionStart + functionEnd.length;
      continue;
    }

    const argsObjectStart = functionEnd.indexOf('{', argsMatch.index + argsMatch[0].length);
    const args = argsObjectStart >= 0
      ? findBalancedJsonObject(functionEnd, argsObjectStart)
      : '{}';

    calls.push(normalizeToolCallFromJsonText({
      function: {
        name: nameMatch[1],
        arguments: args || '{}',
      },
    }, calls.length));

    functionPattern.lastIndex = functionStart + functionEnd.length;
  }

  return calls.filter(Boolean);
}

function normalizeToolCallFromJsonText(toolCall, index = 0) {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const fn = toolCall.function && typeof toolCall.function === 'object'
    ? toolCall.function
    : toolCall;
  const name = typeof fn.name === 'string' && fn.name.trim()
    ? fn.name.trim()
    : '';
  if (!name) return null;

  const rawArguments = fn.arguments ?? fn.input ?? toolCall.arguments ?? {};
  const args = typeof rawArguments === 'string'
    ? repairJsonText(rawArguments)
    : JSON.stringify(rawArguments || {});

  return {
    id: toolCall.id || `call_text_${index}_${Math.random().toString(36).slice(2, 8)}`,
    index,
    type: 'function',
    function: {
      name,
      arguments: args || '{}',
    },
  };
}

function parseToolCallsFromJsonText(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const toolCalls = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []);
    return toolCalls
      .map((toolCall, index) => normalizeToolCallFromJsonText(toolCall, index))
      .filter(Boolean);
  } catch {
    return parseMalformedToolCallsFromText(trimmed);
  }
}

function tryParseToolCallsFromJsonText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { complete: false, toolCalls: [] };
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { complete: true, toolCalls: [] };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const toolCalls = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []);
    return {
      complete: true,
      toolCalls: toolCalls
        .map((toolCall, index) => normalizeToolCallFromJsonText(toolCall, index))
        .filter(Boolean),
    };
  } catch {
    const malformedToolCalls = parseMalformedToolCallsFromText(trimmed);
    return {
      complete: malformedToolCalls.length > 0,
      toolCalls: malformedToolCalls,
    };
  }
}

function extractOpenAITextContent(content) {
  if (typeof content === 'string') return content;
  if (!content) return '';

  if (Array.isArray(content)) {
    return content.map(extractOpenAITextContent).filter(Boolean).join('');
  }

  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (typeof content.value === 'string') return content.value;
    if (typeof content.output_text === 'string') return content.output_text;
    if (typeof content.delta === 'string') return content.delta;
    if (content.text && typeof content.text === 'object') return extractOpenAITextContent(content.text);
    if (content.content && typeof content.content === 'object') return extractOpenAITextContent(content.content);
  }

  return '';
}

function extractOpenAIChoiceText(choice) {
  return extractOpenAITextContent(choice?.delta?.content)
    || extractOpenAITextContent(choice?.delta?.text)
    || extractOpenAITextContent(choice?.delta?.output_text)
    || extractOpenAITextContent(choice?.text)
    || extractOpenAITextContent(choice?.message?.content)
    || extractOpenAITextContent(choice?.message?.output_text);
}

function extractOpenAIChoiceReasoning(choice) {
  return extractOpenAITextContent(choice?.delta?.reasoning_content)
    || extractOpenAITextContent(choice?.delta?.reasoning)
    || extractOpenAITextContent(choice?.delta?.reasoning_text)
    || extractOpenAITextContent(choice?.message?.reasoning_content)
    || extractOpenAITextContent(choice?.message?.reasoning)
    || extractOpenAITextContent(choice?.message?.reasoning_text);
}

/**
 * translateOpenAIToAnthropic — Converts OpenAI chat completion response
 * to Anthropic message response format.
 */
function translateOpenAIToAnthropic(openaiRes, model) {
  const choice = openaiRes.choices?.[0];
  const message = choice?.message;

  const content = [];
  const messageText = extractOpenAITextContent(message?.content) || extractOpenAIChoiceText(choice);
  const textToolCalls = parseToolCallsFromJsonText(messageText);
  if (messageText && textToolCalls.length === 0) {
    content.push({ type: 'text', text: messageText });
  }

  const toolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0
    ? message.tool_calls
    : textToolCalls;
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
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

    const { id, function: fn } = toolCall;
    const index = Number.isInteger(toolCall.index) ? toolCall.index : 0;
    
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

module.exports = {
  tryParseToolCallsFromJsonText,
  translateOpenAIToAnthropic,
  extractOpenAIChoiceReasoning,
  extractOpenAIChoiceText,
  AnthropicSSETranslator,
};
