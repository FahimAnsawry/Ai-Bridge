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
    usage.promptTokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.input_tokens,
    usage.completionTokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.output_tokens,
    usage.totalTokens,
    usage.total_tokens
  ) !== null;
}

export function getTokenUsage(log = {}) {
  const usage = [
    log?.usage,
    log?.message?.usage,
    log?.choices?.[0]?.usage,
    log,
  ].find(hasTokenUsageFields) || {};
  const promptTokens = firstTokenCount(
    usage.promptTokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.input_tokens
  );
  const completionTokens = firstTokenCount(
    usage.completionTokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.output_tokens
  );
  const explicitTotal = firstTokenCount(usage.totalTokens, usage.total_tokens);
  const hasSplitUsage = promptTokens !== null || completionTokens !== null;
  const totalTokens = explicitTotal ?? (hasSplitUsage ? (promptTokens || 0) + (completionTokens || 0) : 0);

  return {
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    totalTokens,
    hasUsage: explicitTotal !== null || hasSplitUsage,
  };
}

export function getTokenTotal(log = {}) {
  return getTokenUsage(log).totalTokens;
}
