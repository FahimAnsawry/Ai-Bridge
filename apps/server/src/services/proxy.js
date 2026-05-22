
/**
 * proxy.js — Core Proxy Logic
 * Forwards OpenAI-compatible requests to the configured upstream API,
 * supports streaming (SSE), and records latency + token counts.
 */

const axios = require('axios');
const { loadConfig } = require('../config/config');
const { buildUpstreamRequest } = require('./proxy/upstream-request');
const {
  isChatGenerationRequest,
  initializeAttemptState,
  consumeAttempt,
  canRetry,
  attemptLabel,
} = require('./proxy/request-attempts');
const {
  sendAnthropicProxyError,
  sendModelRouteConfigError,
  sendAttemptBudgetExhausted,
  sendFreeModelRateLimitError,
} = require('./proxy/proxy-errors');
const {
  providerHasBaseUrlAndKey,
  normalizeBaseUrlForMatch,
  findModelRoute,
  resolveRoutedProvider,
  resolveRoutedProviders,
  getRouteTargetLabel,
  getRouteCacheProviderId,
  getNextRouteProvider,
  shouldRouteFailover,
  switchToFallbackProvider,
  providerCanPreserveModelForRateLimitFallback,
} = require('./proxy/model-routing');
const {
  writeClaudeSelectedModel,
  resolveClaudeSelectedModel,
  normalizeClaudeModelAlias,
} = require('./proxy/claude-settings');
const {
  normalizeTokenUsage,
  mergeTokenUsage,
  extractCompletionTextForUsage,
} = require('./proxy/token-usage');
const {
  tryParseToolCallsFromJsonText,
  translateOpenAIToAnthropic,
  AnthropicSSETranslator,
} = require('./proxy/anthropic-translation');
const {
  TIMY_SUPPORTED_MODELS,
  isTimyProvider,
  normalizeTimyModel,
  getTimyUnsupportedModelMessage,
  isFreeModelProvider,
  isBlazeApiProvider,
  isCpassProvider,
  isAnthropicCompatibleProvider,
  isFreeModelPlaceholderApiKey,
  providerHasRealFreeModelApiKey,
  compactUpstreamErrorText,
  getRateLimitWaitMs,
} = require('./proxy/provider-utils');

const { addLog } = require('../middleware/logger');
const {
  estimateTextTokens,
  estimatePromptTokens,
  pruneMessagesToBudget,
  summarizeMessagesToBudget,
  createCacheKey,
  readCachedResponse,
  storeCachedResponse,
} = require('../utils/token-budget');
// Verbose debug logging removed for latency performance.
// Essential logs kept: request line, response status, errors, warnings.

const responseCache = new Map();
const RESPONSE_CACHE_MAX_ENTRIES = 200;
const FREEMODEL_RATE_LIMIT_MAX_RETRIES = 2;

function maskApiKey(apiKey) {
  const value = String(apiKey || '');
  if (!value) return 'none';
  if (value.length <= 12) return `${value.slice(0, 4)}...`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function getProviderApiKeys(provider) {
  const keys = [];
  const addKey = (key) => {
    if (typeof key !== 'string' || !key.trim()) return;
    if (!keys.includes(key)) keys.push(key);
  };

  if (Array.isArray(provider?.apiKeys)) {
    provider.apiKeys.forEach(addKey);
  }
  addKey(provider?.apiKey);

  return keys;
}

function isRetryableApiKeyFailure(status, message, rawUpstreamMessage, upstreamErrorCode, err) {
  if (!err?.response) return false;
  if ([401, 403, 408, 409, 425, 429].includes(status)) return true;
  if (status >= 500) return false;

  const text = `${upstreamErrorCode || ''}\n${message || ''}\n${rawUpstreamMessage || ''}`;
  return /rate[-_\s]?limit|too many requests|quota|insufficient[-_\s]?(credit|credits|balance|funds)|credits?\s+exhausted|balance\s+exhausted|limit\s+exceeded|exceeded\s+quota|resource_exhausted/i.test(text);
}

async function retryWithNextProviderApiKey(req, res, provider, apiKey, details) {
  if (!provider?.id) {
    console.warn('[proxy] API-key failover skipped: no current provider context available.');
    return null;
  }

  const {
    status,
    message,
    rawUpstreamMessage,
    upstreamErrorCode,
    err,
  } = details || {};

  if (!isRetryableApiKeyFailure(status, message, rawUpstreamMessage, upstreamErrorCode, err)) {
    return null;
  }

  if (!req.__triedKeys) req.__triedKeys = {};
  if (!req.__triedKeys[provider.id]) req.__triedKeys[provider.id] = new Set();
  if (apiKey) req.__triedKeys[provider.id].add(apiKey);

  const keys = getProviderApiKeys(provider);
  const nextKey = keys.find(k => !req.__triedKeys[provider.id].has(k));
  const providerLabel = provider.name || provider.id;
  const reason = status ? `status ${status}` : 'network error';

  if (!nextKey) {
    req.__sameProviderKeyFailoverExhausted = true;
    console.warn(
      `[proxy] ${providerLabel} returned ${reason}; all API keys for this provider are exhausted. ` +
      'Provider fallback is skipped for API-key failover.'
    );
    return null;
  }

  if (!canRetry(req)) {
    console.warn(`[proxy] API-key failover retry skipped for ${providerLabel}: attempt budget exhausted${attemptLabel(req)}`);
    return sendAttemptBudgetExhausted(req, res);
  }

  req.__sameProviderRetryProviderId = provider.id;
  req.__sameProviderKeyFailoverExhausted = false;
  console.warn(
    `[proxy] ${providerLabel} returned ${reason} with API key ${maskApiKey(apiKey)}; ` +
    `retrying same provider with next API key ${maskApiKey(nextKey)}${attemptLabel(req)}`
  );
  await proxyRequest(req, res);
  return true;
}

function normalizeRemovedClaudeHaikuModel(model) {
  if (!model || typeof model !== 'string') return model;
  if (/^claude(?:\s+|-)haiku(?:\s+|-)4[.-]5(?:-[\w.-]+)?$/i.test(model)) {
    return 'claude-sonnet-4-6';
  }
  return model;
}

/**
 * Proxy middleware factory.
 * Forwards the request to upstream and streams the response back.
 */
async function proxyRequest(req, res) {
  const startTime = Date.now();
  const userId = req.user ? req.user._id : null;
  const accessKey = req.user ? req.user.accessKey : null;
  const timing = {
    authMs: Number.isFinite(req.__authTimingMs) ? req.__authTimingMs : null,
    authCacheHit: req.__authCacheHit === true,
    configMs: null,
    requestBuildMs: null,
    upstreamHeadersMs: null,
    firstChunkMs: null,
    streamDrainMs: null,
  };

  if (!userId) {
    if (req.path.includes('/messages')) {
      return res.status(401).json({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Unauthorized: missing user context',
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }
    return res.status(401).json({ error: 'Unauthorized: missing user context' });
  }

  const configStart = Date.now();
  const config = await loadConfig(userId, { includeCatalogs: true });
  timing.configMs = Date.now() - configStart;
  const strictProviderRouting = isChatGenerationRequest(req);
  req.__strictProviderRouting = strictProviderRouting;
  if (strictProviderRouting && req.body && typeof req.body === 'object') {
    const requestModel = typeof req.body.model === 'string'
      ? normalizeClaudeModelAlias(req.body.model.trim())
      : '';
    const selectedModel = resolveClaudeSelectedModel(accessKey);

    if (selectedModel) {
      // Enforce the stored model selection for ALL requests.
      // Claude CLI sends background requests (tool calls, context compression, etc.)
      // with its own default model (e.g. claude-sonnet-4-6) even when the user
      // explicitly passed --model gpt-5.5. Without this guard those background
      // requests would silently overwrite the user's selection in settings.json
      // and all subsequent requests would switch to claude-sonnet-4-6.
      req.body.model = selectedModel;
    } else if (requestModel) {
      // No stored selection yet — use the request model and persist it.
      req.body.model = requestModel;
      writeClaudeSelectedModel(accessKey, requestModel);
    }
  }
  if (req.body?.model) {
    const normalizedAliasModel = normalizeClaudeModelAlias(req.body.model);
    if (normalizedAliasModel !== req.body.model) {
      req.body.model = normalizedAliasModel;
    }
    if (typeof req.body.model === 'string' && req.body.model.startsWith('/')) {
      req.body.model = req.body.model.replace(/^\/+/, '');
    }
  }
  const attemptState = initializeAttemptState(req, config);
  if (!strictProviderRouting && req.body?.model) {
    const normalizedModel = normalizeRemovedClaudeHaikuModel(req.body.model);
    if (normalizedModel !== req.body.model) {
      req.body.model = normalizedModel;
    }
  }
  const requestedModel = req.body?.model || 'unknown';

  // ── Model-Route Gate ──────────────────────────────────────────────────────
  // If model_routing has entries, only allow models that have a route defined.
  // Non-chat requests (embeddings, /models, audio, etc.) are exempt.
  if (isChatGenerationRequest(req) && req.body?.model) {
    const routing = config.model_routing;
    const hasAnyRoutes = routing && typeof routing === 'object' && !Array.isArray(routing) && Object.keys(routing).length > 0;
    if (hasAnyRoutes) {
      const route = findModelRoute(requestedModel, routing);
      if (!route) {
        const modelId = requestedModel;
        const message = `Model "${modelId}" is not added to model routes. Please add it in Settings → Model Routing before using it.`;
        console.warn(`[proxy] Model-route gate blocked: ${message}`);
        if (req.path.includes('/messages')) {
          return sendAnthropicProxyError(req, res, 400, 'invalid_request_error', message);
        }
        return res.status(400).json({
          error: { message, type: 'invalid_request_error', code: 'model_not_in_routes' },
        });
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const optimizationEnabled = config.token_optimization_enabled === true;
  const promptBudget = Number(config.prompt_budget_tokens) > 0 ? Number(config.prompt_budget_tokens) : 12000;
  const summarizationEnabled = config.token_summarization_enabled === true;
  const cacheEnabled = config.response_cache_enabled === true;
  const cacheTtlSeconds = Number(config.response_cache_ttl_seconds) > 0 ? Number(config.response_cache_ttl_seconds) : 30;
  const shouldOptimizePrompt = optimizationEnabled && isChatGenerationRequest(req) && req.body && Array.isArray(req.body.messages);

  let optimizationMeta = {
    enabled: optimizationEnabled,
    promptBudget,
    promptTokensBefore: null,
    promptTokensAfter: null,
    promptTokensAfterPrune: null,
    promptTokensAfterSummary: null,
    pruned: false,
    prunedCount: 0,
    summarized: false,
    summaryReplacedCount: 0,
    tokensSavedByPrune: 0,
    tokensSavedBySummary: 0,
    cacheEligible: false,
    cacheHit: false,
  };

  if (attemptState.applies && attemptState.enabled) {
    const { allowed } = consumeAttempt(req);
    if (!allowed) {
      return sendAttemptBudgetExhausted(req, res);
    }
    // console.log(`[proxy] Outbound attempt ${state.usedAttempts}/${state.maxAttempts} for ${req.path}`);
  } else if (attemptState.applies) {
    // console.log('[proxy] Request minimization disabled for chat request');
  }

  if (shouldOptimizePrompt) {
    const preEstimate = estimatePromptTokens({
      system: req.body?.system,
      messages: req.body.messages,
    });
    optimizationMeta.promptTokensBefore = preEstimate;

    let currentTokens = preEstimate;

    if (promptBudget > 0 && preEstimate > promptBudget) {
      const pruneResult = pruneMessagesToBudget({
        messages: req.body.messages,
        system: req.body?.system,
        budget: promptBudget,
      });
      req.body.messages = pruneResult.messages;
      currentTokens = pruneResult.afterTokens;
      optimizationMeta.pruned = pruneResult.pruned;
      optimizationMeta.prunedCount = pruneResult.prunedCount;
      optimizationMeta.promptTokensAfterPrune = pruneResult.afterTokens;
      optimizationMeta.promptTokensAfterSummary = pruneResult.afterTokens;
      optimizationMeta.tokensSavedByPrune = Math.max(0, preEstimate - pruneResult.afterTokens);

      if (summarizationEnabled && pruneResult.afterTokens > promptBudget && !req.__summaryAttempted) {
        req.__summaryAttempted = true;
        const summaryResult = summarizeMessagesToBudget({
          messages: req.body.messages,
          system: req.body?.system,
          budget: promptBudget,
        });

        if (summaryResult.summarized) {
          req.body.messages = summaryResult.messages;
          currentTokens = summaryResult.afterTokens;
          optimizationMeta.summarized = true;
          optimizationMeta.summaryReplacedCount = summaryResult.replacedCount;
          optimizationMeta.promptTokensAfterSummary = summaryResult.afterTokens;
          optimizationMeta.tokensSavedBySummary = Math.max(0, pruneResult.afterTokens - summaryResult.afterTokens);
        } else {
          optimizationMeta.promptTokensAfterSummary = pruneResult.afterTokens;
        }
      }

      delete req.__originalMessages;
    } else {
      optimizationMeta.promptTokensAfterPrune = preEstimate;
      optimizationMeta.promptTokensAfterSummary = preEstimate;
    }

    optimizationMeta.promptTokensAfter = currentTokens;
  }

  // ── Short-Circuit: Serve /models locally from config ──────────────────────

  const cacheEligible = cacheEnabled && req.method === 'POST' && isChatGenerationRequest(req) && req.body?.stream !== true;
  optimizationMeta.cacheEligible = cacheEligible;
  const configuredProviders = Array.isArray(config.providers) ? config.providers : [];
  const selectedProvidersForCache = configuredProviders.filter((p) => p?.isActive !== false);
  const eligibleProvidersForCache = selectedProvidersForCache;
  const preCacheModelRoute = findModelRoute(req.body?.model || '', config.model_routing);
  if (preCacheModelRoute) {
    const preCacheRouteCandidates = resolveRoutedProviders(preCacheModelRoute, configuredProviders);
    const preCacheUsableCandidates = preCacheRouteCandidates.filter((entry) => entry.provider && providerHasBaseUrlAndKey(entry.provider));
    if (preCacheModelRoute.legacyFixed) {
      const preCacheTarget = preCacheModelRoute.targets[0]?.target || '';
      const preCacheRoutedProvider = preCacheRouteCandidates[0]?.provider || null;
      if (!preCacheRoutedProvider) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${preCacheModelRoute.model}" points to provider "${preCacheTarget}", but that provider is not configured.`
        );
      }
      if (!providerHasBaseUrlAndKey(preCacheRoutedProvider)) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${preCacheModelRoute.model}" points to provider "${preCacheRoutedProvider.name || preCacheRoutedProvider.id}", but it is missing a base URL or API key.`,
          'model_route_provider_not_ready'
        );
      }
    } else if (preCacheUsableCandidates.length === 0) {
      return sendModelRouteConfigError(
        req,
        res,
        `Model route "${preCacheModelRoute.model}" has no usable configured providers. Targets: ${getRouteTargetLabel(preCacheModelRoute) || 'none'}.`,
        'model_route_provider_not_ready'
      );
    }
  }

  let cacheKey = null;
  if (cacheEligible) {
    const requestedForCache = req.body?.model || '';
    const routedCacheRoute = findModelRoute(requestedForCache, config.model_routing);
    const routedCacheTarget = routedCacheRoute?.legacyFixed ? routedCacheRoute.targets[0]?.target : null;
    const routedCacheProvider = routedCacheTarget
      ? resolveRoutedProvider(routedCacheTarget, configuredProviders)
      : null;
    const cacheProviderId = req.__currentProviderId
      || getRouteCacheProviderId(routedCacheRoute)
      || routedCacheProvider?.id
      || config.active_provider_id
      || 'active';

    cacheKey = createCacheKey(req.body, userId, cacheProviderId);
    const cached = readCachedResponse(responseCache, cacheKey);
    if (cached) {
      optimizationMeta.cacheHit = true;
      const cachedUsage = normalizeTokenUsage(cached);
      await addLog({
        method: req.method,
        path: req.path,
        model: requestedModel,
        status: 200,
        latencyMs: Date.now() - startTime,
        promptTokens: cachedUsage.promptTokens,
        completionTokens: cachedUsage.completionTokens,
        totalTokens: cachedUsage.totalTokens,
        tokenUsageEstimated: cached?.usage?.estimated === true,
        streaming: false,
        provider: 'cache',
        optimization: optimizationMeta,
        performance: timing,
      }, userId, accessKey);
      return res.status(200).json(cached);
    }
  } else {
    optimizationMeta.cacheHit = false;
  }
  if (req.method === 'GET' && req.path === '/models') {
    const modelCatalogs = Array.isArray(config.model_catalogs) ? config.model_catalogs : [];
    const modelList = modelCatalogs.reduce((acc, cat) => acc.concat(cat.models || []), []);
    const now = Math.floor(Date.now() / 1000);
    const seenModelIds = new Set();
    const data = modelList
      .filter((m) => {
        if (!m?.id || seenModelIds.has(m.id)) return false;
        seenModelIds.add(m.id);
        return true;
      })
      .map((m) => ({
        id: m.id,
        object: 'model',
        created: now,
        owned_by: m.owned_by || 'custom',
      }));
    return res.json({ object: 'list', data });
  }

  // ── Client-Requested Provider Override ────────────────────────────────
  // Allow clients to request a specific provider by ID or baseUrl match.
  // The override is respected only when the requested provider is actually
  // configured for this user. This lets the UI drive routing without
  // bypassing the user's saved provider list.
  const clientRequestedProviderId = req.body?.provider || req.query?.provider;
  const providers = configuredProviders;
  const selectedProviders = providers.filter((p) => p?.isActive !== false);
  const eligibleProviders = selectedProviders;
  const hasUsableProvider = providerHasBaseUrlAndKey;
  const requestedModelForRouting = req.body?.model || '';
  const fixedModelRoute = findModelRoute(requestedModelForRouting, config.model_routing);
  let fixedRouteProvider = null;
  let routeCandidates = [];

  if (fixedModelRoute) {
    // Fixed routes search ALL configured providers, not just the active/default one.
    // isActive on a provider only controls default-provider behavior and fallback eligibility,
    // not whether it can be explicitly targeted by a model route.
    routeCandidates = resolveRoutedProviders(fixedModelRoute, configuredProviders);

    if (fixedModelRoute.legacyFixed) {
      const routeTarget = fixedModelRoute.targets[0]?.target || '';
      fixedRouteProvider = routeCandidates[0]?.provider || null;
      if (!fixedRouteProvider) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${fixedModelRoute.model}" points to provider "${routeTarget}", but that provider is not configured.`
        );
      }
      if (!providerHasBaseUrlAndKey(fixedRouteProvider)) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${fixedModelRoute.model}" points to provider "${fixedRouteProvider.name || fixedRouteProvider.id}", but it is missing a base URL or API key.`,
          'model_route_provider_not_ready'
        );
      }
      req.__fixedModelRouteProviderId = fixedRouteProvider.id;
      req.__fixedModelRouteKey = fixedModelRoute.model;
    } else {
      routeCandidates = routeCandidates.filter((entry) => entry.provider && providerHasBaseUrlAndKey(entry.provider));
      if (routeCandidates.length === 0) {
        return sendModelRouteConfigError(
          req,
          res,
          `Model route "${fixedModelRoute.model}" has no usable configured providers. Targets: ${getRouteTargetLabel(fixedModelRoute) || 'none'}.`,
          'model_route_provider_not_ready'
        );
      }
      req.__modelRoute = {
        key: fixedModelRoute.model,
        legacyFixed: false,
        candidates: routeCandidates,
      };
      const routeProviderId = req.__sameProviderRetryProviderId || req.__currentProviderId;
      fixedRouteProvider = routeCandidates.find((entry) => entry.provider.id === routeProviderId)?.provider
        || routeCandidates[0].provider;
    }
  }

  let providerToUseId = fixedRouteProvider?.id || config.active_provider_id;

  // req.__currentProviderId carries provider IDs set during auto-switch or
  // fallback retries — those take precedence over everything so we never
  // "undo" an automatic recovery decision.
  if (fixedRouteProvider) {
    providerToUseId = fixedRouteProvider.id;
  } else if (req.__sameProviderRetryProviderId) {
    providerToUseId = req.__sameProviderRetryProviderId;
  } else if (req.__currentProviderId && !strictProviderRouting) {
    providerToUseId = req.__currentProviderId;
  } else if (clientRequestedProviderId && !strictProviderRouting) {
    // Try to match by provider ID first, then by baseUrl suffix.
    const matchById = eligibleProviders.find(
      (p) => p.id === clientRequestedProviderId
    );
    const matchByUrl = !matchById
      ? eligibleProviders.find(
          (p) =>
            p.baseUrl &&
            p.baseUrl.replace(/\/+$/, '').endsWith(clientRequestedProviderId.replace(/\/+$/, ''))
        )
      : null;

    if (matchById || matchByUrl) {
      providerToUseId = (matchById || matchByUrl).id;
    }
  } else if (strictProviderRouting && !fixedRouteProvider && requestedModelForRouting) {
    // Auto-detect provider from model catalogs when the selected model isn't in model_routing.
    // This ensures `claude --model gpt-5.5` routes to the provider that actually offers gpt-5.5,
    // rather than always falling back to the active provider.
    const modelCatalogs = Array.isArray(config.model_catalogs) ? config.model_catalogs : [];
    for (const catalog of modelCatalogs) {
      if (!catalog.providerId || !Array.isArray(catalog.models)) continue;
      const found = catalog.models.some(
        (m) => m && typeof m.id === 'string' && m.id === requestedModelForRouting
      );
      if (found) {
        // Only auto-route to providers that are configured and usable
        const catalogProvider = configuredProviders.find((p) => p.id === catalog.providerId);
        if (catalogProvider && providerHasBaseUrlAndKey(catalogProvider)) {
          providerToUseId = catalog.providerId;
          // console.log(`[proxy] Auto-routed model "${requestedModelForRouting}" → provider "${catalog.providerId}" via catalog`);
        }
        break;
      }
    }
  }

  // For fixed model routes, use the already-resolved fixedRouteProvider directly (it was resolved
  // from all configuredProviders). For other requests, look up in eligibleProviders as usual.
  const providerById = fixedRouteProvider || eligibleProviders.find((p) => p.id === providerToUseId) || null;
  const firstUsableProvider = eligibleProviders.find(hasUsableProvider) || null;

  const activeProvider = strictProviderRouting
    ? providerById
    : (providerById && hasUsableProvider(providerById)
      ? providerById
      : (firstUsableProvider || providerById || eligibleProviders[0] || null));
    
  let upstreamProvider = activeProvider;
  let providerName = activeProvider ? activeProvider.name : 'unknown';
  req.__upstreamProviderId = activeProvider?.id || '';
  req.__upstreamProviderName = providerName;

  if (!activeProvider) {
    if (req.path.includes('/messages')) {
      return sendAnthropicProxyError(req, res, 503, 'api_error', 'No provider configured. Please add a provider in Settings.');
    }
    return res.status(503).json({
      error: {
        message: 'No provider configured. Please add a provider in Settings.',
        type: 'server_error',
        code: 'no_provider',
      },
    });
  }

  let baseUrl = activeProvider.baseUrl;
  
  // ── API Key Selection ──────────────────────────────────────────────────────
  if (!req.__triedKeys) req.__triedKeys = {};
  if (!req.__triedKeys[activeProvider.id]) req.__triedKeys[activeProvider.id] = new Set();
  
  let apiKey = (activeProvider.apiKeys && activeProvider.apiKeys.length > 0)
    ? activeProvider.apiKeys.find(k => !req.__triedKeys[activeProvider.id].has(k))
    : activeProvider.apiKey;
  
  if (!apiKey && activeProvider.apiKey) apiKey = activeProvider.apiKey;
  apiKey = apiKey || '';
  if (isFreeModelProvider(activeProvider) && isFreeModelPlaceholderApiKey(apiKey)) {
    apiKey = '';
  }

  const maskedKey = maskApiKey(apiKey);
  // console.log(`[proxy] Active provider: ${activeProvider.name} (${baseUrl}) using key: ${maskedKey}`);

  if (!apiKey && !isFreeModelProvider(activeProvider)) {
    console.error(`[proxy] ❌ No API key found for provider "${activeProvider.name}" (ID: ${activeProvider.id})`);
    if (req.path.includes('/messages')) {
      return sendAnthropicProxyError(
        req,
        res,
        503,
        'api_error',
        `No API key configured for provider "${activeProvider.name}". Please add one in the Dashboard Settings.`
      );
    }
    return res.status(503).json({
      error: {
        message: `No API key configured for provider "${activeProvider.name}". Please add one in the Dashboard Settings.`,
        type: 'server_error',
        code: 'no_api_key',
      },
    });
  }

  // ── Model Selection ────────────────────────────────────────────────────────
  let targetModel = req.body?.model || 'unknown';

  // Sanitize: strip any leading slash from the model name (e.g. "/gemini-3.1-pro-preview" → "gemini-3.1-pro-preview")
  if (typeof targetModel === 'string' && targetModel.startsWith('/')) {
    const sanitized = targetModel.replace(/^\/+/, '');
    console.warn(`[proxy] ⚠ Model name had leading slash: "${targetModel}" → "${sanitized}"`);
    targetModel = sanitized;
    if (req.body) req.body.model = sanitized;
  }

  const originalModel = targetModel;
  const isCopilotProvider = /\/copilot\/v1\/?$/i.test(baseUrl) || baseUrl.includes('/copilot/v1');
  const isCpassRequest = isCpassProvider(activeProvider) ||
    isCpassProvider(upstreamProvider) ||
    isCpassProvider(baseUrl);
  const isAnthropicCompatibleUpstream = isAnthropicCompatibleProvider(activeProvider) ||
    isAnthropicCompatibleProvider(upstreamProvider) ||
    isAnthropicCompatibleProvider(baseUrl);
  req.__upstreamProviderIsAnthropicCompatible = isAnthropicCompatibleUpstream;

  const skipModelMappingForRateLimitFallback = req.__skipModelMappingForRateLimitFallback === true;

  const normalizedRemovedModel = strictProviderRouting ? targetModel : normalizeRemovedClaudeHaikuModel(targetModel);
  if (normalizedRemovedModel !== targetModel) {
    targetModel = normalizedRemovedModel;
    if (req.body) req.body.model = targetModel;
  }

  if (!strictProviderRouting && isTimyProvider(baseUrl)) {
    const normalizedTimyModel = normalizeTimyModel(targetModel);
    if (normalizedTimyModel !== targetModel) {
      targetModel = normalizedTimyModel;
      if (req.body) req.body.model = normalizedTimyModel;
    }

    if (!TIMY_SUPPORTED_MODELS.includes(targetModel)) {
      const message = getTimyUnsupportedModelMessage(targetModel);
      console.warn(`[proxy] ${message}`);

      if (req.path.includes('/messages')) {
        return sendAnthropicProxyError(req, res, 400, 'invalid_request_error', message);
      }

      return res.status(400).json({
        error: {
          message,
          type: 'invalid_request_error',
          code: 'invalid_timy_model',
        },
      });
    }
  }

  // ── EcomAgent early model normalisation ───────────────────────────────────
  // EcomAgent only supports opus-class models (claude-opus-4-6, claude-opus-4.6).
  // Remap req.body.model NOW so that all downstream logic (isModelUnavailable,
  // provider auto-switch, buildUpstreamRequest) already sees the correct model.
  if (!strictProviderRouting && !skipModelMappingForRateLimitFallback && baseUrl.includes('ecom') && req.body?.model && /claude/i.test(req.body.model)) {
    const preEcom = req.body.model;
    req.body.model = req.body.model
      .replace(/claude-opus-4-6/g, 'claude-opus-4.6')
      // Map claude-opus-4-7 (Opus 4.7 — new CLI default) → opus-4.6
      // .replace(/claude-opus-4[-.]7[\w.-]*/g, 'claude-opus-4.6')
      .replace(/claude-sonnet-[\w.-]+/g, 'claude-opus-4.6')
      .replace(/claude-haiku-[\w.-]+/g, 'claude-opus-4.6')
      .replace(/claude-3-[\w.-]+-sonnet[\w.-]*/g, 'claude-opus-4.6')
      .replace(/claude-3-[\w.-]+-haiku[\w.-]*/g, 'claude-opus-4.6')
      .replace(/claude-3-[\w.-]+-opus[\w.-]*/g, 'claude-opus-4.6');
    targetModel = req.body.model;
    if (preEcom !== req.body.model) {
      // console.log(`[proxy] EcomAgent early remap: ${preEcom} → ${req.body.model}`);
    }
  }

  const isStreaming = req.body?.stream === true;

  // ── Optional Stub: short-circuit selected models when explicitly configured ──
  const stubModels = Array.isArray(config.stub_models) ? config.stub_models : [];
  if (stubModels.includes(targetModel)) {
    // console.log(`[proxy] STUB ACTIVE: Short-circuiting background request for: ${targetModel}`);
    const stubData = {
      id: `stub_${Math.random().toString(36).slice(2, 11)}`,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: [{ type: 'text', text: ' ' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }
    };
    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const events = [
        { event: 'message_start',       data: { type: 'message_start', message: stubData } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' ' } } },
        { event: 'content_block_stop',  data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta',       data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 1, output_tokens: 1 } } },
        { event: 'message_stop',        data: { type: 'message_stop' } },
      ];
      events.forEach(ev => res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`));
      return res.end();
    }
    return res.json(stubData);
  }

  // Copilot is an in-process bridge, not a remote upstream. Calling the
  // mounted /copilot route over HTTP adds a self-proxy hop that can hang behind
  // the active /v1 request, so dispatch straight to the bridge handlers.
  if (isCopilotProvider) {
    const {
      handleChatCompletions,
      handleMessages,
      handleModels,
    } = require('./copilot-proxy');

    if (req.path.includes('/messages')) {
      return handleMessages(req, res);
    }

    if (req.path.includes('/chat/completions')) {
      return handleChatCompletions(req, res);
    }

    if (req.path.includes('/models')) {
      return handleModels(req, res);
    }
  }

  try {
    const buildStart = Date.now();
    const axiosConfig = buildUpstreamRequest(req, baseUrl, apiKey);
    const requestPayloadForUsage = axiosConfig.data && typeof axiosConfig.data === 'object'
      ? axiosConfig.data
      : req.body;
    const isBlazeApiUpstream = isBlazeApiProvider(baseUrl);
    timing.requestBuildMs = Date.now() - buildStart;

    const upstreamStart = Date.now();
    const upstreamRes = await axios(axiosConfig);
    timing.upstreamHeadersMs = Date.now() - upstreamStart;

    // console.log(`[proxy] ← ${upstreamRes.status} ${upstreamRes.headers['content-type'] || 'unknown'}`);

    // Debug: capture and log non-2xx body from upstream
    if (upstreamRes.status >= 400) {
      const chunks = [];
      for await (const chunk of upstreamRes.data) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf-8');
      // Upstream error logged in catch block below
      const err = new Error(body);
      err.response = { status: upstreamRes.status, data: body };
      throw err;
    }

    // FreeModel: log errors immediately before streaming starts
    // This ensures errors are captured even if the stream fails mid-response
    if (upstreamRes.status >= 400 && isFreeModelProvider(baseUrl)) {
      console.warn(`[proxy] FreeModel error: ${upstreamRes.status}`);
    }


    // ── Detect request type ───────────────────────────────────────────────
    const isChatCompletions = req.path.includes('/chat/completions');
    const isMessages = req.path.includes('/messages');
    const isNativeAnthropicMessages = isMessages && req.__upstreamProviderIsAnthropicCompatible === true;
    const isFreeModelUpstream = isFreeModelProvider(baseUrl);
    const shouldEstimateTokenUsage = isBlazeApiUpstream || isNativeAnthropicMessages || isFreeModelUpstream;

    // Buffer if:
    // 1. Not streaming
    // 2. It's a non-completion route (e.g. /models)
    // 3. It IS a /messages route but we might need to translate (buffer to translate)
    const shouldBuffer = !isStreaming;

    if (!shouldBuffer) {
      res.status(upstreamRes.status);
      const forwardHeaders = ['content-type', 'transfer-encoding', 'cache-control', 'x-request-id'];
      forwardHeaders.forEach((h) => {
        if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
      });
    }

    // ── Body Handling ────────────────────────────────────────────────────
    let rawBody = '';
    let sseBuffer = ''; // for normalizing incomplete SSE lines in streaming mode
    let nativeAnthropicSseBuffer = ''; // pass-through Anthropic SSE still needs usage capture
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let tokenUsageEstimated = false;
    let completionTextForUsage = '';
    let capturedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, hasUsage: false };
    const captureUsage = (json) => {
      capturedUsage = mergeTokenUsage(capturedUsage, normalizeTokenUsage(json));
      promptTokens = capturedUsage.promptTokens;
      completionTokens = capturedUsage.completionTokens;
      totalTokens = capturedUsage.totalTokens;
      if (capturedUsage.hasUsage) tokenUsageEstimated = false;
    };
    const captureCompletionText = (text) => {
      if (!shouldEstimateTokenUsage || typeof text !== 'string' || text.length === 0) return;
      completionTextForUsage += text;
    };
    const pushTranslatedDelta = (text, thinking = '') => {
      captureCompletionText(text);
      if (thinking) captureCompletionText(thinking);
      anthropicTranslator.pushDelta(text, thinking);
    };
    const applyEstimatedUsage = () => {
      const hasMeaningfulExactUsage = !isFreeModelUpstream && capturedUsage.hasUsage &&
        (capturedUsage.totalTokens > 0 || capturedUsage.promptTokens > 0 || capturedUsage.completionTokens > 0);
      if (!shouldEstimateTokenUsage || hasMeaningfulExactUsage) return;
      const estimatedPromptTokens = estimatePromptTokens({
        system: requestPayloadForUsage?.system,
        messages: requestPayloadForUsage?.messages,
      });
      const estimatedCompletionTokens = estimateTextTokens(completionTextForUsage);
      capturedUsage = {
        promptTokens: estimatedPromptTokens,
        completionTokens: estimatedCompletionTokens,
        totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        hasUsage: true,
        hasExplicitTotal: false,
        estimated: true,
      };
      promptTokens = capturedUsage.promptTokens;
      completionTokens = capturedUsage.completionTokens;
      totalTokens = capturedUsage.totalTokens;
      tokenUsageEstimated = true;
    };
    const captureUsageFromSseText = (text) => {
      if (typeof text !== 'string' || text.length === 0) return;
      nativeAnthropicSseBuffer += text;
      const lines = nativeAnthropicSseBuffer.split('\n');
      nativeAnthropicSseBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trimEnd();
        if (!/^data:/i.test(trimmedLine)) continue;

        const payload = trimmedLine.slice(trimmedLine.indexOf(':') + 1).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const obj = JSON.parse(payload);
          captureUsage(obj);
          captureCompletionText(
            obj?.delta?.text ||
            obj?.delta?.text_delta?.text ||
            obj?.delta?.thinking ||
            obj?.delta?.thinking_delta?.thinking ||
            extractCompletionTextForUsage(obj)
          );
        } catch {
          // Usage capture is best-effort; never disturb the streamed response.
        }
      }
    };
    let anthropicTranslator = null;
    if (isMessages && isStreaming && !isNativeAnthropicMessages) {
      anthropicTranslator = new AnthropicSSETranslator(res, requestedModel);
      anthropicTranslator.start();
    }
    let blazeToolTextBuffer = '';

    upstreamRes.data.on('data', (chunk) => {
      if (timing.firstChunkMs === null) {
        timing.firstChunkMs = Date.now() - startTime;
      }
      const text = chunk.toString();
      if (shouldBuffer) rawBody += text;

      if (!shouldBuffer) {
        if (isStreaming && isNativeAnthropicMessages) {
          captureUsageFromSseText(text);
          res.write(chunk);
          return;
        }

        if (isStreaming) {
          sseBuffer += text;
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop(); // keep last incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trimEnd();
            if (/^data:/i.test(trimmedLine)) {
              const payload = trimmedLine.slice(trimmedLine.indexOf(':') + 1).trim();
              if (payload === '[DONE]') {
                if (!anthropicTranslator) res.write('data: [DONE]\n\n');
                // anthropicTranslator finishes on 'end' event below
                continue;
              }
              try {
                const obj = JSON.parse(payload);
                if (obj === null || typeof obj !== 'object') continue;
                captureUsage(obj);

                if (anthropicTranslator) {
                  // If upstream is already Anthropic-format (has 'type' but no 'choices')
                  if (obj.type && !obj.choices) {
                    if (obj.type === 'message_start' || obj.type === 'ping') {
                      // Already sent our own or will handle it
                      continue;
                    }
                    if (obj.type === 'content_block_delta') {
                      pushTranslatedDelta(
                        obj.delta?.text || obj.delta?.text_delta?.text || '', 
                        obj.delta?.thinking || obj.delta?.thinking_delta?.thinking || ''
                      );
                    } else if (obj.type === 'message_delta') {
                       // Pass through usage if available, but let finish() handle the rest
                    }
                    continue;
                  }

                  // OpenAI-format translation
                  const choice = obj.choices?.[0];
                  const deltaText = choice?.delta?.content || choice?.text || '';
                  const thinking = choice?.delta?.reasoning_content || '';
                  const toolCalls = choice?.delta?.tool_calls || [];
                  const shouldParseBlazeToolText = isBlazeApiProvider(baseUrl);

                  if (shouldParseBlazeToolText && deltaText) {
                    const nextToolBuffer = blazeToolTextBuffer + deltaText;
                    const trimmed = nextToolBuffer.trimStart();
                    const looksLikeJsonText = trimmed.startsWith('{') || trimmed.startsWith('[');
                    const looksLikeToolJson =
                      /^{\s*"tool_calls"/.test(trimmed) ||
                      /^\[\s*{\s*"(function|id)"/.test(trimmed);

                    if (blazeToolTextBuffer || looksLikeJsonText) {
                      blazeToolTextBuffer = nextToolBuffer;
                      const parsed = tryParseToolCallsFromJsonText(blazeToolTextBuffer);
                      if (parsed.complete && parsed.toolCalls.length > 0) {
                        for (const tc of parsed.toolCalls) {
                          anthropicTranslator.pushToolCallDelta(tc);
                        }
                        blazeToolTextBuffer = '';
                      } else if ((parsed.complete && parsed.toolCalls.length === 0 && !looksLikeToolJson) || blazeToolTextBuffer.length > 65536) {
                        pushTranslatedDelta(blazeToolTextBuffer, thinking);
                        blazeToolTextBuffer = '';
                      }
                    } else if (deltaText || thinking) {
                      pushTranslatedDelta(deltaText, thinking);
                    }
                  } else {
                    if (deltaText || thinking) {
                      pushTranslatedDelta(deltaText, thinking);
                    }
                  }

                  for (const tc of toolCalls) {
                    anthropicTranslator.pushToolCallDelta(tc);
                  }
                  continue;
                }

            // Strip null top-level fields (AgentRouter quirk)
            for (const key of Object.keys(obj)) {
              if (obj[key] === null) delete obj[key];
            }
            if (isChatCompletions && Array.isArray(obj.choices)) {
              obj.choices = obj.choices.map((c) => {
                if (!c || typeof c !== 'object') return c;
                const { flag, logprobs, ...rest } = c;
                return { ...rest, finish_reason: rest.finish_reason ?? null };
              });
            }
            captureCompletionText(extractCompletionTextForUsage(obj));
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
              } catch {
                if (!anthropicTranslator) res.write(`${line}\n`);
              }
        } else if (trimmedLine.trim() !== '') {
          // Pass through 'event:', 'id:', 'retry:' etc
          res.write(`${trimmedLine}\n`);
            }
          }
        } else {
          res.write(chunk);
        }
      }
    });

    upstreamRes.data.on('end', async () => {
      timing.streamDrainMs = timing.firstChunkMs === null
        ? null
        : Date.now() - startTime - timing.firstChunkMs;

      if (anthropicTranslator && blazeToolTextBuffer) {
        const parsed = tryParseToolCallsFromJsonText(blazeToolTextBuffer);
        if (parsed.toolCalls.length > 0) {
          for (const tc of parsed.toolCalls) {
            anthropicTranslator.pushToolCallDelta(tc);
          }
        } else {
          pushTranslatedDelta(blazeToolTextBuffer, '');
        }
        blazeToolTextBuffer = '';
      }

      if (isStreaming && isNativeAnthropicMessages && nativeAnthropicSseBuffer.trim()) {
        captureUsageFromSseText('\n');
      }

      applyEstimatedUsage();

      if (isCpassRequest && isStreaming) {
        console.log('[proxy] Cpass streaming final usage:', {
          promptTokens,
          completionTokens,
          totalTokens,
          hasUsage: capturedUsage.hasUsage,
          tokenUsageEstimated
        });
      }

      if (anthropicTranslator) {
        anthropicTranslator.finish('end_turn', capturedUsage);
      }

      // FreeModel: ensure logging happens even for streaming responses
      // that may not trigger the normal error paths
      const isFreeModel = isFreeModelProvider(baseUrl);
      if (isFreeModel && upstreamRes.status >= 400) {
        console.warn(`[proxy] FreeModel streaming error: ${upstreamRes.status}`);
      }

      let bufferedBody = null;
      if (shouldBuffer) {
        let finalBody = rawBody;
        let contentType = upstreamRes.headers['content-type'] || 'application/json';

        // Normalization: OpenAI clients expect /v1/models to return { data: [...] }
        if (req.path === '/models') {
          try {
            const parsed = JSON.parse(rawBody);
            let modelList = Array.isArray(parsed) ? parsed : (parsed.data || []);
            modelList = modelList.filter(m => m !== null);

            const customModels = Array.isArray(config.model_catalogs)
              ? config.model_catalogs.reduce((acc, cat) => acc.concat(cat.models || []), [])
              : [];

            if (customModels.length > 0) {
              modelList = [...modelList, ...customModels];
            }
            finalBody = JSON.stringify({ object: 'list', data: modelList });
          } catch (e) {
            console.error('[proxy] Failed to parse/normalize models:', e.message);
          }
        }

        // Normalization: ensure non-streaming /v1/messages responses are
        // Anthropic-shaped with a top-level `usage: { input_tokens, output_tokens }`.
        // Claude CLI's `/model` validation probe crashes on `R.usage.input_tokens`
        // otherwise — either when the upstream returns OpenAI-shape `usage`
        // (`prompt_tokens`/`completion_tokens`) without a `choices` array, or
        // when the upstream returns a non-JSON body.
        if (isMessages) {
          let parsed = null;
          try {
            parsed = JSON.parse(rawBody);
          } catch (e) {
            // Log a compact snippet of the raw body so the provider's actual
            // response (HTML error page, plain-text message, etc.) is visible.
            const rawSnippet = String(rawBody || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 300);
            console.error(
              `[proxy] Non-streaming /messages: upstream (${providerName}) returned non-JSON body` +
              ` [HTTP ${upstreamRes.status}] for model "${targetModel}".` +
              (rawSnippet ? ` Raw: ${rawSnippet}` : ' (empty body)')
            );
          }

          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            captureUsage(parsed);
            if (Array.isArray(parsed.choices)) {
              const translated = translateOpenAIToAnthropic(parsed, requestedModel);
              finalBody = JSON.stringify(translated);
            } else {
              const usage = normalizeTokenUsage(parsed);
              parsed.usage = {
                input_tokens: usage.promptTokens || 0,
                output_tokens: usage.completionTokens || 0,
              };
              finalBody = JSON.stringify(parsed);
            }
          } else {
            // Build a user-facing message that includes a snippet of the raw
            // upstream response so the cause is easier to diagnose.
            const rawSnippet = String(rawBody || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200);
            const detailSuffix = rawSnippet
              ? ` Provider "${providerName}" responded with: ${rawSnippet}`
              : ` Provider "${providerName}" returned an empty body.`;
            finalBody = JSON.stringify({
              type: 'error',
              error: {
                type: 'api_error',
                message: `Upstream returned a non-JSON response body.${detailSuffix}`,
              },
              usage: { input_tokens: 0, output_tokens: 0 },
            });
            if (upstreamRes.status < 400) upstreamRes.status = 502;
            contentType = 'application/json';
          }
        }

        try {
          bufferedBody = JSON.parse(finalBody);
        } catch {
          bufferedBody = null;
        }

        res.status(upstreamRes.status);
        const forwardHeaders = ['content-type', 'cache-control', 'x-request-id'];
        forwardHeaders.forEach((h) => {
          if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
        });
        res.setHeader('content-type', contentType);
        res.setHeader('content-length', Buffer.byteLength(finalBody));
        res.write(finalBody);
      }

      res.end();

      try {
        if (!isStreaming) {
          const json = bufferedBody || JSON.parse(rawBody);
          captureUsage(json);
          if (
            isFreeModelUpstream ||
            !capturedUsage.hasUsage ||
            (capturedUsage.totalTokens === 0 && capturedUsage.promptTokens === 0 && capturedUsage.completionTokens === 0)
          ) {
            captureCompletionText(extractCompletionTextForUsage(json));
          }
        }
      } catch {
        // Usage parse is best-effort
      }

      applyEstimatedUsage();

      if (tokenUsageEstimated && bufferedBody && typeof bufferedBody === 'object') {
        bufferedBody.usage = {
          ...(bufferedBody.usage || {}),
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          estimated: true,
        };
      }

      if (cacheEligible && !optimizationMeta.cacheHit && cacheKey && shouldBuffer && upstreamRes.status < 400 && bufferedBody) {
        storeCachedResponse(responseCache, cacheKey, bufferedBody, cacheTtlSeconds * 1000, RESPONSE_CACHE_MAX_ENTRIES);
      }

      await addLog({
        optimization: optimizationMeta,
        method: req.method,
        path: req.path,
        model: targetModel,
        status: upstreamRes.status,
        latencyMs: Date.now() - startTime,
        promptTokens,
        completionTokens,
        totalTokens,
        tokenUsageEstimated,
        streaming: isStreaming,
        provider: providerName,
        performance: timing,
      }, userId, accessKey);
    });

    upstreamRes.data.on('error', async (err) => {
      // 'aborted' means the client closed the connection before the upstream finished —
      // this is normal (Ctrl+C, tab close, CLI cancellation) and not a real server error.
      if (err.message === 'aborted' || err.code === 'ECONNRESET') {
        return; // client disconnected mid-stream — expected, no logging needed
      }
      console.error('[proxy] Stream error:', err.message);
      await addLog({
        method: req.method,
        path: req.path,
        model: targetModel,
        status: 500,
        latencyMs: Date.now() - startTime,
        streaming: isStreaming,
        provider: providerName,
        error: err.message,
        optimization: optimizationMeta,
        performance: timing,
      }, userId, accessKey);
      if (!res.headersSent) {
        if (req.path.includes('/messages')) {
          res.status(500).json({
            type: "error",
            error: {
              type: "api_error",
              message: err.message
            },
            usage: { input_tokens: 0, output_tokens: 0 }
          });
        } else {
          res.status(500).json({
            error: {
              message: err.message,
              type: 'upstream_error',
              code: 'upstream_stream_error'
            }
          });
        }
      } else {
        if (isStreaming && req.path.includes('/messages')) {
          res.write(`event: error\ndata: ${JSON.stringify({
            type: "error",
            error: { type: "api_error", message: err.message },
            usage: { input_tokens: 0, output_tokens: 0 },
          })}\n\n`);
        }
        res.end();
      }
    });

    upstreamRes.data.on('close', () => {
      // console.log('[proxy] Upstream connection closed');
    });

  } catch (err) {
    const status = err.response?.status || 502;
    const retryAfterRaw = err.response?.headers?.['retry-after'] || err.response?.headers?.['x-ratelimit-reset-requests'] || '';

    // When responseType:'stream', err.response.data is a Readable stream — NOT a
    // plain object. Calling JSON.stringify on it causes "circular structure" errors.
    // We must read the stream buffer to get the actual upstream error text.
    let message = err.message;
    let upstreamErrorCode = '';
    if (err.response?.data && typeof err.response.data.pipe === 'function') {
      try {
        const chunks = [];
        for await (const chunk of err.response.data) chunks.push(chunk);
        message = Buffer.concat(chunks).toString('utf-8');
      } catch {
        message = err.message;
      }
    } else if (err.response?.data) {
      try { 
        message = typeof err.response.data === 'string' 
          ? err.response.data 
          : JSON.stringify(err.response.data); 
      } catch { message = err.message; }
    }

    const rawUpstreamMessage = message;
    try {
      const parsed = JSON.parse(message);
      upstreamErrorCode = parsed.code || parsed.error?.code || '';
      if (parsed.error && parsed.error.message) {
        message = parsed.error.message;
      } else if (typeof parsed.error === 'string') {
        message = parsed.error;
      } else if (typeof parsed.message === 'string') {
        message = parsed.message;
      } else if (typeof parsed.title === 'string') {
        message = typeof parsed.detail === 'string' && parsed.detail.trim()
          ? `${parsed.title}: ${parsed.detail}`
          : parsed.title;
      } else if (isBlazeApiProvider(baseUrl) && (parsed.choices || parsed.object)) {
        message = `Blaze upstream returned ${status} for model "${targetModel}". The model may not be supported or may be offline.`;
      }
    } catch (e) {
      // Keep original message if it's not JSON
    }

    const currentProvider = activeProvider?.id
      ? activeProvider
      : eligibleProviders.find(
          p => normalizeBaseUrlForMatch(p.baseUrl) && normalizeBaseUrlForMatch(baseUrl) === normalizeBaseUrlForMatch(p.baseUrl)
        ) || activeProvider;

    if (isFreeModelProvider(baseUrl)) {
      console.warn(`[proxy] FreeModel upstream status ${status}: ${compactUpstreamErrorText(message || rawUpstreamMessage)}`);
    } else {
      console.error(`[proxy] Upstream request failed (${status}): ${String(message).slice(0, 1200)}`);
    }

    // Detect Gemini function-call/response parity error — retry with stripped tool history
    const isFunctionParityError =
      status === 400 &&
      /function response parts|function call parts/i.test(message);

    if (isFunctionParityError && !req.__functionParityRetried) {
      if (!canRetry(req)) {
        console.warn(`[proxy] ⚠ Gemini parity retry skipped: attempt budget exhausted${attemptLabel(req)}`);
      } else {
        req.__functionParityRetried = true;
        console.warn(`[proxy] ⚠ Gemini function-call/response parity error detected — retrying with stripped tool history${attemptLabel(req)}`);

      // Strip all tool-calling turns from the conversation, keeping only plain text turns.
      // This is a last-resort recovery so the user gets a response rather than a hard error.
      if (req.body && Array.isArray(req.body.messages)) {
        req.body.messages = req.body.messages.filter(m => {
          if (m.role === 'tool') return false;
          if ((m.role === 'assistant' || m.role === 'model') && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) return false;
          if ((m.role === 'assistant' || m.role === 'model') && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use')) return false;
          if (m.role === 'user' && Array.isArray(m.content) && m.content.every(b => b.type === 'tool_result')) return false;
          return true;
        });
        // Ensure there is at least one user message
        const hasUser = req.body.messages.some(m => m.role === 'user');
        if (!hasUser) {
          req.body.messages.push({ role: 'user', content: 'Please continue.' });
        }
        // Clear the snapshot so the cleaned messages are used as the new baseline
        delete req.__originalMessages;
      }
        return proxyRequest(req, res);
      }
    }

    // Detect EcomAgent "empty completion" error — transient, retry up to 2 times
    const isEmptyCompletionError =
      /model output must contain either output text or tool calls|model output error/i.test(message);

    if (isEmptyCompletionError) {
      if (!req.__emptyCompletionRetries) req.__emptyCompletionRetries = 0;
      if (req.__emptyCompletionRetries < 2) {
        if (!canRetry(req)) {
          console.warn(`[proxy] ⚠ Empty-completion retry skipped: attempt budget exhausted${attemptLabel(req)}`);
        } else {
          req.__emptyCompletionRetries++;
          console.warn(`[proxy] ⚠ Empty completion error from upstream — retrying (attempt ${req.__emptyCompletionRetries}/2)${attemptLabel(req)}`);
          return proxyRequest(req, res);
        }
      }
    }

    const isModelUnavailable =
      ((status === 400 || status === 403 || status === 404 || status === 503) &&
      (/model_not_found|model_not_available|plan_model_forbidden/i.test(upstreamErrorCode) ||
      /plan_model_forbidden|isn't available on your current plan|model.+not available|model.+not found|model_not_found|无可用渠道|no available channel/i.test(message) ||
      /model_not_found|model_not_available|model.+not found|model.+not available/i.test(rawUpstreamMessage))) ||
      (status === 500 && /sensitive words detected/i.test(message));

    const keyFailoverResult = await retryWithNextProviderApiKey(req, res, currentProvider, apiKey, {
      status,
      message,
      rawUpstreamMessage,
      upstreamErrorCode,
      err,
    });
    if (keyFailoverResult) return keyFailoverResult;
    const isRetryableProviderFailure = isRetryableApiKeyFailure(
      status,
      message,
      rawUpstreamMessage,
      upstreamErrorCode,
      err
    );

    // 0. Rate Limit Failover: Provider-specific handling after same-provider keys are exhausted.
    if (status === 429) {
      if (isFreeModelProvider(currentProvider) || isFreeModelProvider(baseUrl)) {
        req.__freeModelRateLimitRetries = req.__freeModelRateLimitRetries || 0;
        if (req.__freeModelRateLimitRetries < FREEMODEL_RATE_LIMIT_MAX_RETRIES && canRetry(req)) {
          req.__freeModelRateLimitRetries++;
          const waitMs = getRateLimitWaitMs(retryAfterRaw);
          console.warn(
            `[proxy] FreeModel rate limit (429); waiting ${Math.round(waitMs / 1000)}s then retrying ` +
            `(${req.__freeModelRateLimitRetries}/${FREEMODEL_RATE_LIMIT_MAX_RETRIES})${retryAfterRaw ? '' : ' (no retry-after header)'}${attemptLabel(req)}`
          );
          await new Promise(resolve => setTimeout(resolve, waitMs));
          return proxyRequest(req, res);
        }

        if (!canRetry(req)) {
          console.warn(`[proxy] FreeModel rate-limit retry skipped: attempt budget exhausted${attemptLabel(req)}`);
        } else {
          console.warn(`[proxy] FreeModel rate limit (429); retry limit reached.`);
        }
        await addLog({
          method: req.method,
          path: req.path,
          model: targetModel,
          status,
          latencyMs: Date.now() - startTime,
          streaming: isStreaming,
          provider: providerName,
          error: 'FreeModel rate limited',
          optimization: optimizationMeta,
          performance: timing,
        }, userId, accessKey);
        return sendFreeModelRateLimitError(req, res);
      }

      if (req.__fixedModelRouteProviderId) {
        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; fixed model route "${req.__fixedModelRouteKey}" is enabled, so provider fallback is skipped.`
        );
      } else if (req.__modelRoute && !req.__modelRoute.legacyFixed) {
        if (!req.__triedProviders) req.__triedProviders = new Set();
        if (currentProvider?.id) req.__triedProviders.add(currentProvider.id);

        const currentModelForFallback = req.body?.model || targetModel;
        const nextProvider = getNextRouteProvider(req, currentProvider?.id);
        if (nextProvider && providerCanPreserveModelForRateLimitFallback(nextProvider, currentModelForFallback)) {
          if (!canRetry(req)) {
            console.warn(`[proxy] Route provider fallback skipped: attempt budget exhausted${attemptLabel(req)}`);
            return sendAttemptBudgetExhausted(req, res);
          }
          console.warn(
            `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; ` +
            `retrying route "${req.__modelRoute.key}" with provider ${nextProvider.name || nextProvider.id}${attemptLabel(req)}`
          );
          switchToFallbackProvider(req, nextProvider.id);
          req.__sameProviderKeyFailoverExhausted = false;
          req.__skipModelMappingForRateLimitFallback = true;
          if (req.body && currentModelForFallback) req.body.model = currentModelForFallback;
          return proxyRequest(req, res);
        }

        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; no route fallback provider remains for "${req.__modelRoute.key}".`
        );
      } else if (strictProviderRouting) {
        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; strict selected-provider routing is enabled, so provider fallback is skipped.`
        );
      } else if (req.__sameProviderKeyFailoverExhausted) {
        console.warn(
          `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; same-provider API keys are exhausted, so provider fallback is skipped.`
        );
      } else {
        if (!req.__triedProviders) req.__triedProviders = new Set();
        if (currentProvider?.id) req.__triedProviders.add(currentProvider.id);

        const currentModelForFallback = req.body?.model || targetModel;
        const nextProvider = eligibleProviders.find((p) => {
          const isSameProvider = currentProvider?.id && p.id === currentProvider.id;
          return p.id &&
            !isSameProvider &&
            !req.__triedProviders.has(p.id) &&
            providerCanPreserveModelForRateLimitFallback(p, currentModelForFallback);
        });

        if (nextProvider) {
          if (!canRetry(req)) {
            console.warn(`[proxy] Rate-limit provider fallback skipped: attempt budget exhausted${attemptLabel(req)}`);
            return sendAttemptBudgetExhausted(req, res);
          } else {
            console.warn(
              `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; ` +
              `retrying same model "${currentModelForFallback}" with provider ${nextProvider.name || nextProvider.id}${attemptLabel(req)}`
            );
            switchToFallbackProvider(req, nextProvider.id);
            req.__skipModelMappingForRateLimitFallback = true;
            if (req.body && currentModelForFallback) req.body.model = currentModelForFallback;
            return proxyRequest(req, res);
          }
        } else {
          console.warn(
            `[proxy] Rate limit (429) on ${currentProvider?.name || providerName}; no selected fallback provider can preserve model "${currentModelForFallback}".`
          );
        }
      }
    }

    if (req.__modelRoute && !req.__modelRoute.legacyFixed && shouldRouteFailover(status, err, isModelUnavailable, isRetryableProviderFailure)) {
      if (!req.__triedProviders) req.__triedProviders = new Set();
      const failedProvider = upstreamProvider || activeProvider || currentProvider;
      if (failedProvider?.id) req.__triedProviders.add(failedProvider.id);

      const nextProvider = getNextRouteProvider(req, failedProvider?.id);
      if (nextProvider) {
        if (!canRetry(req)) {
          console.warn(`[proxy] Route provider fallback skipped: attempt budget exhausted${attemptLabel(req)}`);
          return sendAttemptBudgetExhausted(req, res);
        }

        console.warn(
          `[proxy] Provider error (${status}) on ${failedProvider?.name || providerName}; ` +
          `retrying route "${req.__modelRoute.key}" with provider ${nextProvider.name || nextProvider.id}${attemptLabel(req)}`
        );
        switchToFallbackProvider(req, nextProvider.id);
        req.__sameProviderKeyFailoverExhausted = false;
        return proxyRequest(req, res);
      }

      console.warn(
        `[proxy] Provider error (${status}) on ${failedProvider?.name || providerName}; no route fallback provider remains for "${req.__modelRoute.key}".`
      );
    }

    if (isModelUnavailable && req.body && req.body.model) {
      const blockedModel = req.body.model;

      // 1. Auto Provider Switch: Try other providers for the SAME model first
      if (!req.__triedProviders) req.__triedProviders = new Set();
      const failedProvider = upstreamProvider || activeProvider;
      if (failedProvider?.id) req.__triedProviders.add(failedProvider.id);

      const nextProvider = (req.__fixedModelRouteProviderId || strictProviderRouting || req.__sameProviderKeyFailoverExhausted)
        ? null
        : eligibleProviders.find((p) => {
            const hasBaseUrl = typeof p.baseUrl === 'string' && p.baseUrl.trim().length > 0;
            const hasKey = p.apiKey || (p.apiKeys && p.apiKeys.length > 0);
            const isSameProvider = failedProvider?.id && p.id === failedProvider.id;
            return hasBaseUrl && hasKey && !isSameProvider && !req.__triedProviders.has(p.id);
          });
      
      if (nextProvider) {
        if (!canRetry(req)) {
          console.warn(`[proxy] Provider auto-switch retry skipped: attempt budget exhausted${attemptLabel(req)}`);
        } else {
          console.warn(`[proxy] Model ${blockedModel} unavailable on ${failedProvider?.name || activeProvider.name}; auto-switching to ${nextProvider.name}${attemptLabel(req)}`);
          switchToFallbackProvider(req, nextProvider.id);
          // Keep the original requested model for the next provider
          return proxyRequest(req, res);
        }
      } else {
        console.warn(
          `[proxy] Model ${blockedModel} unavailable on ${failedProvider?.name || activeProvider.name}; no selected fallback provider found. ` +
          `Selected providers: ${eligibleProviders.map((p) => p.name || p.id).join(', ') || 'none'}`
        );
      }

      // No fallback model substitution: return the provider error if the requested
      // model is unavailable after same-model provider failover.
    }

    await addLog({
      method: req.method,
      path: req.path,
      model: targetModel,
      status,
      latencyMs: Date.now() - startTime,
      streaming: isStreaming,
      provider: providerName,
      error: message,
      optimization: optimizationMeta,
      performance: timing,
    }, userId, accessKey);

    if (!res.headersSent) {
      const isUnauthorized = status === 401 || status === 403;
      const descriptiveMessage = isUnauthorized
        ? (isTimyProvider(baseUrl)
          ? `Upstream provider "${providerName}" returned ${status}. Original error: ${message}`
          : `Upstream provider "${providerName}" returned ${status} (Unauthorized). Verify the API key in Settings. Original error: ${message}`)
        : message;

      if (req.path.includes('/messages')) {
        sendAnthropicProxyError(req, res, status, 'api_error', descriptiveMessage);
      } else {
        res.status(status).json({
          error: {
            message: descriptiveMessage,
            type: 'upstream_error',
            code: 'upstream_request_failed',
          },
        });
      }
    } else {
      if (isStreaming && req.path.includes('/messages')) {
        res.write(`event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "api_error", message: message },
          usage: { input_tokens: 0, output_tokens: 0 },
        })}\n\n`);
      }
      res.end();
    }
  }
}

module.exports = { proxyRequest };
