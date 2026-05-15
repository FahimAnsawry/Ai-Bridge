function sendAnthropicProxyError(req, res, status, errorType, message) {
  const payload = {
    type: 'error',
    error: {
      type: errorType || 'api_error',
      message,
    },
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  if (req.path.includes('/messages') && req.body?.stream === true) {
    if (!res.headersSent) return res.status(status).json(payload);
    res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
    return res.end();
  }

  return res.status(status).json(payload);
}

function sendModelRouteConfigError(req, res, message, code = 'invalid_model_route') {
  console.warn(`[proxy] ${message}`);

  if (req.path.includes('/messages')) {
    return sendAnthropicProxyError(req, res, 503, 'api_error', message);
  }

  return res.status(503).json({
    error: {
      message,
      type: 'server_error',
      code,
    },
  });
}

function sendAttemptBudgetExhausted(req, res) {
  const state = req.__attemptState;
  const maxAttempts = state?.maxAttempts || 0;
  const message = `Request attempt budget exhausted (${maxAttempts} max upstream attempts).`;
  console.warn(`[proxy] ${message}`);

  if (req.path.includes('/messages')) {
    return sendAnthropicProxyError(req, res, 429, 'rate_limit_error', message);
  }

  return res.status(429).json({
    error: {
      message,
      type: 'rate_limit_error',
      code: 'attempt_budget_exhausted',
    },
  });
}

function sendFreeModelRateLimitError(req, res) {
  const retries = req.__freeModelRateLimitRetries || 0;
  const message = `FreeModel is rate limited. Retried ${retries} time(s); please wait and try again.`;

  if (req.path.includes('/messages')) {
    return sendAnthropicProxyError(req, res, 429, 'rate_limit_error', message);
  }

  return res.status(429).json({
    error: {
      message,
      type: 'rate_limit_error',
      code: 'freemodel_rate_limited',
    },
  });
}

module.exports = {
  sendAnthropicProxyError,
  sendModelRouteConfigError,
  sendAttemptBudgetExhausted,
  sendFreeModelRateLimitError,
};
