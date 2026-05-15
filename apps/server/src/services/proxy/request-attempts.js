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
    : 30;

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

module.exports = {
  isChatGenerationRequest,
  initializeAttemptState,
  consumeAttempt,
  canRetry,
  attemptLabel,
};
