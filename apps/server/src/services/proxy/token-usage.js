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

function extractCompletionTextForUsage(source = {}) {
  if (!source || typeof source !== 'object') return '';

  const parts = [];
  const appendContent = (content) => {
    if (typeof content === 'string') {
      parts.push(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
      } else if (typeof block?.text === 'string') {
        parts.push(block.text);
      } else if (block?.type === 'text' && typeof block?.text === 'string') {
        parts.push(block.text);
      }
    }
  };

  if (Array.isArray(source.choices)) {
    for (const choice of source.choices) {
      appendContent(choice?.message?.content);
      appendContent(choice?.delta?.content);
      if (typeof choice?.text === 'string') parts.push(choice.text);
    }
  }

  appendContent(source.content);
  appendContent(source.message?.content);
  if (typeof source.output_text === 'string') parts.push(source.output_text);

  return parts.join('');
}

module.exports = {
  normalizeTokenUsage,
  mergeTokenUsage,
  extractCompletionTextForUsage,
};
