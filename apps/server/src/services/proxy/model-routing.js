const { normalizeClaudeModelAlias } = require('./claude-settings');
const {
  isFreeModelProvider,
  isTimyProvider,
  normalizeTimyModel,
  providerHasRealFreeModelApiKey,
} = require('./provider-utils');

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

function shouldRouteFailover(status, err, isModelUnavailable, isRetryableProviderFailure = false) {
  if (isModelUnavailable) return true;
  if (isRetryableProviderFailure) return true;
  if (!err?.response) return true;
  if (status === 429) return true;
  return [500, 502, 503, 504].includes(status);
}

function switchToFallbackProvider(req, providerId) {
  req.__currentProviderId = providerId;
  delete req.__sameProviderRetryProviderId;
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

module.exports = {
  providerHasBaseUrlAndKey,
  normalizeBaseUrlForMatch,
  findModelRoute,
  resolveRoutedProvider,
  resolveRoutedProviders,
  getUsableRouteCandidates,
  getRouteTargetLabel,
  getRouteCacheProviderId,
  getNextRouteProvider,
  shouldRouteFailover,
  switchToFallbackProvider,
  providerCanPreserveModelForRateLimitFallback,
};
