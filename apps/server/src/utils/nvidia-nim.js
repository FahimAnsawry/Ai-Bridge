function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringifyJsonish(value, fallback = '{}') {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenMessageContentForNvidiaNim(content) {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return ' ';

  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'tool_result') return stringifyJsonish(block.content || 'success', 'success');
        if (typeof block.text === 'string') return block.text;
        if (typeof block.input_text === 'string') return block.input_text;
        if (typeof block.content === 'string') return block.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    return text || ' ';
  }

  if (typeof content === 'object') return stringifyJsonish(content, ' ');
  return String(content);
}

function sanitizeToolParameters(parameters) {
  if (!isPlainObject(parameters)) {
    return { type: 'object', properties: {} };
  }

  return parameters;
}

function sanitizeNvidiaNimTool(tool) {
  if (!tool || typeof tool !== 'object') return null;

  const fn = isPlainObject(tool.function) ? tool.function : tool;
  const name = typeof fn.name === 'string' && fn.name.trim()
    ? fn.name.trim()
    : (typeof tool.name === 'string' && tool.name.trim() ? tool.name.trim() : '');
  if (!name) return null;

  const description = typeof fn.description === 'string'
    ? fn.description
    : (typeof tool.description === 'string' ? tool.description : undefined);
  const parameters = sanitizeToolParameters(fn.parameters || fn.input_schema || tool.parameters || tool.input_schema);

  return {
    type: 'function',
    function: {
      name,
      ...(description ? { description } : {}),
      parameters,
    },
  };
}

function sanitizeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const fn = isPlainObject(toolCall.function) ? toolCall.function : toolCall;
  const name = typeof fn.name === 'string' && fn.name.trim()
    ? fn.name.trim()
    : (typeof toolCall.name === 'string' && toolCall.name.trim() ? toolCall.name.trim() : '');
  if (!name) return null;

  return {
    id: toolCall.id || `call_${Math.random().toString(36).slice(2, 11)}`,
    type: 'function',
    function: {
      name,
      arguments: stringifyJsonish(fn.arguments || fn.input || toolCall.arguments || {}, '{}'),
    },
  };
}

function normalizeNvidiaNimToolChoice(toolChoice, hasTools) {
  if (!hasTools) return undefined;
  if (!toolChoice) return undefined;
  if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') return toolChoice;
  if (typeof toolChoice === 'string') return 'auto';
  if (!isPlainObject(toolChoice)) return 'auto';

  const choiceType = toolChoice.type;
  if (choiceType === 'none') return 'none';
  if (choiceType === 'auto') return 'auto';
  if (
    choiceType === 'any' ||
    choiceType === 'required' ||
    choiceType === 'tool' ||
    choiceType === 'function' ||
    isPlainObject(toolChoice.function)
  ) {
    return 'required';
  }
  return 'auto';
}

function sanitizeStop(stop) {
  if (typeof stop === 'string') return stop;
  if (Array.isArray(stop)) {
    const values = stop
      .map((value) => (typeof value === 'string' ? value : null))
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function sanitizeNvidiaNimMessage(message, preserveTools) {
  if (!message || typeof message !== 'object') return null;
  if (!preserveTools && message.role === 'tool') return null;

  const hadToolCall = Array.isArray(message.tool_calls) || Boolean(message.function_call);
  const role = message.role === 'model' ? 'assistant' : message.role;
  const cleaned = {
    role,
    content: preserveTools && hadToolCall && (message.content === null || message.content === undefined)
      ? null
      : flattenMessageContentForNvidiaNim(message.content),
  };

  if (typeof message.name === 'string' && message.name.trim()) cleaned.name = message.name;
  if (role === 'tool' && typeof message.tool_call_id === 'string' && message.tool_call_id.trim()) {
    cleaned.tool_call_id = message.tool_call_id;
  }

  if (preserveTools) {
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map(sanitizeToolCall).filter(Boolean)
      : (message.function_call ? [sanitizeToolCall(message.function_call)].filter(Boolean) : []);
    if (toolCalls.length > 0) {
      cleaned.tool_calls = toolCalls;
      cleaned.content = null;
    }
  }

  if (!preserveTools && hadToolCall && !String(cleaned.content || '').trim()) return null;
  return cleaned;
}

function sanitizeNvidiaNimRequestBody(bodyData, options = {}) {
  if (!bodyData || typeof bodyData !== 'object') return bodyData;

  const preserveTools = options.preserveTools === true;

  if (bodyData.stop === undefined && bodyData.stop_sequences !== undefined) {
    bodyData.stop = bodyData.stop_sequences;
  }

  const sanitized = {};
  const copyScalar = (field) => {
    if (bodyData[field] !== undefined && !isPlainObject(bodyData[field])) sanitized[field] = bodyData[field];
  };

  [
    'model',
    'temperature',
    'top_p',
    'max_tokens',
    'max_completion_tokens',
    'stream',
    'n',
    'presence_penalty',
    'frequency_penalty',
    'seed',
    'user',
  ].forEach(copyScalar);

  // Inject chat_template_kwargs for Kimi K2 models — required for extended thinking/tool use.
  // Pass through any client-provided value; otherwise inject the default for kimi models.
  const isKimiModel = typeof bodyData.model === 'string' && /kimi/i.test(bodyData.model);
  if (bodyData.chat_template_kwargs !== undefined) {
    sanitized.chat_template_kwargs = bodyData.chat_template_kwargs;
  } else if (isKimiModel) {
    sanitized.chat_template_kwargs = { thinking: true };
  }

  const stop = sanitizeStop(bodyData.stop);
  if (stop !== undefined) sanitized.stop = stop;

  if (Array.isArray(bodyData.messages)) {
    sanitized.messages = bodyData.messages
      .map((message) => sanitizeNvidiaNimMessage(message, preserveTools))
      .filter(Boolean);

    if (!sanitized.messages.some((message) => message?.role === 'user')) {
      sanitized.messages.push({ role: 'user', content: 'Please continue.' });
    }
  }

  if (preserveTools) {
    const tools = Array.isArray(bodyData.tools)
      ? bodyData.tools.map(sanitizeNvidiaNimTool).filter(Boolean)
      : [];
    if (tools.length > 0) {
      sanitized.tools = tools;
      const toolChoice = normalizeNvidiaNimToolChoice(bodyData.tool_choice, true);
      if (toolChoice) sanitized.tool_choice = toolChoice;
    }
  }

  Object.keys(bodyData).forEach((key) => {
    delete bodyData[key];
  });
  Object.assign(bodyData, sanitized);
  return bodyData;
}

module.exports = {
  flattenMessageContentForNvidiaNim,
  sanitizeNvidiaNimRequestBody,
  sanitizeNvidiaNimTool,
  sanitizeToolCall,
  normalizeNvidiaNimToolChoice,
};
