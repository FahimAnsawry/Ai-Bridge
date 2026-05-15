const FREEMODEL_RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
const FREEMODEL_RATE_LIMIT_MAX_WAIT_MS = 65_000;

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

function isBlazeApiProvider(providerOrBaseUrl) {
  const baseUrl = typeof providerOrBaseUrl === 'string'
    ? providerOrBaseUrl
    : providerOrBaseUrl?.baseUrl;
  return typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('blazeai.boxu.dev');
}

function isCpassProvider(providerOrBaseUrl) {
  const baseUrl = typeof providerOrBaseUrl === 'string'
    ? providerOrBaseUrl
    : providerOrBaseUrl?.baseUrl;
  const name = typeof providerOrBaseUrl === 'object'
    ? providerOrBaseUrl?.name || providerOrBaseUrl?.id || ''
    : '';
  return (typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('api.cpass.cc')) ||
    String(name).toLowerCase().includes('cpass');
}

function isAnthropicCompatibleProvider(providerOrBaseUrl) {
  const baseUrl = typeof providerOrBaseUrl === 'string'
    ? providerOrBaseUrl
    : providerOrBaseUrl?.baseUrl;
  return (typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('anthropic.com')) ||
    isCpassProvider(providerOrBaseUrl);
}

function normalizeBlazeApiBaseUrl(baseUrl) {
  const cleanBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  if (!cleanBaseUrl) return cleanBaseUrl;
  return cleanBaseUrl
    .replace(/\/api\/v1$/i, '/api')
    .replace(/\/v1$/i, '/api')
    .replace(/\/api$/i, '/api')
    .replace(/^(https?:\/\/blazeai\.boxu\.dev)$/i, '$1/api');
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

module.exports = {
  TIMY_SUPPORTED_MODELS,
  isTimyProvider,
  normalizeTimyModel,
  getTimyUnsupportedModelMessage,
  isFreeModelProvider,
  isBlazeApiProvider,
  isCpassProvider,
  isAnthropicCompatibleProvider,
  normalizeBlazeApiBaseUrl,
  isFreeModelPlaceholderApiKey,
  providerHasRealFreeModelApiKey,
  compactUpstreamErrorText,
  getRateLimitWaitMs,
};
