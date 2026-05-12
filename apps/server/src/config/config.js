/**
 * config.js — Configuration Store (MongoDB version)
 */

const { mongoose, User, GlobalConfig, ModelCatalog, UserConfig, Provider } = require('./db');

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

const CONFIG_CACHE_TTL_MS = 30_000;
const configCache = new Map();

function getConfigCacheKey(userId, includeCatalogs) {
  return `${userId.toString()}:${includeCatalogs ? 'catalogs' : 'lite'}`;
}

function clearConfigCache(userId) {
  if (!userId) {
    configCache.clear();
    return;
  }

  const prefix = `${userId.toString()}:`;
  for (const key of configCache.keys()) {
    if (key.startsWith(prefix)) configCache.delete(key);
  }
}

const DEFAULTS = {
  port: 3000,
  cors_origins: ['*'],
  model_routing: {},
  stub_models: [],
  request_minimization_enabled: true,
  chat_max_upstream_attempts: 20,
  token_optimization_enabled: false,
  prompt_budget_tokens: 0,
  token_summarization_enabled: false,
  response_cache_enabled: false,
  response_cache_ttl_seconds: 30,
  active_provider_id: 'swiftrouter',
  active_model_id: '',
  providers: [
    {
      id: 'swiftrouter',
      name: 'SwiftRouter (Default)',
      baseUrl: 'https://api.swiftrouter.com/v1',
      apiKey: '',
      isActive: true
    },
    {
      id: 'ecomagent',
      name: 'EcomAgent',
      baseUrl: 'https://api.ecomagent.in/v1',
      apiKey: '',
      isActive: true
    },
    {
      id: 'freemodel',
      name: 'FreeModel',
      baseUrl: 'https://api.freemodel.dev',
      apiKey: '',
      isActive: true
    }
  ]
};


function normalizeActiveProviderId(providers, activeProviderId) {
  const list = Array.isArray(providers) ? providers : [];
  if (list.length === 0) return null;
  const selected = list.filter((p) => p?.isActive !== false);
  // Prefer matching the requested ID among active providers
  if (activeProviderId && selected.some((p) => p.id === activeProviderId)) {
    return activeProviderId;
  }
  // If the ID exists in the full list (even if inactive), preserve it as active provider
  if (activeProviderId && list.some((p) => p.id === activeProviderId)) {
    return activeProviderId;
  }
  // Return first active provider, or first provider if none are marked active
  if (selected.length > 0) return selected[0].id || null;
  return list[0].id || null;
}

function getActiveProviderIds(providers) {
  return (Array.isArray(providers) ? providers : [])
    .filter((p) => p?.isActive !== false)
    .map((p) => p.id)
    .filter(Boolean);
}

function normalizeModelRouteProviders(providers) {
  if (!Array.isArray(providers)) return [];

  return providers
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const target = entry.trim();
        return target ? { target, priority: index + 1, index } : null;
      }

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const target = String(entry.target || entry.providerId || entry.baseUrl || '').trim();
      if (!target) return null;

      const parsedPriority = Number(entry.priority);
      const priority = Number.isFinite(parsedPriority) && parsedPriority > 0
        ? parsedPriority
        : index + 1;

      return { target, priority, index };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ target }, index) => ({ target, priority: index + 1 }));
}

function normalizeModelRouteValue(value) {
  if (typeof value === 'string') {
    const target = value.trim();
    return target || null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const providers = normalizeModelRouteProviders(value.providers);
  return providers.length > 0 ? { providers } : null;
}

function normalizeModelRouting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc, [model, routeValue]) => {
    const key = String(model || '').trim();
    const route = normalizeModelRouteValue(routeValue);
    if (key && route) acc[key] = route;
    return acc;
  }, {});
}

/**
 * Load global config
 */
async function loadGlobalConfig() {
  if (!isDbConnected()) {
    return { defaultPort: DEFAULTS.port, adminEmails: [] };
  }
  let globalConfig = await GlobalConfig.findOne();
  if (!globalConfig) {
    globalConfig = new GlobalConfig({
      defaultPort: DEFAULTS.port,
      adminEmails: process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : []
    });
    await globalConfig.save();
  }
  return globalConfig;
}

/**
 * Load config for a specific user.
 * Merges UserConfig, Providers, and ModelCatalog into a single object.
 */
async function loadConfig(userId, options = {}) {
  if (!userId) {
    throw new Error('loadConfig requires a userId');
  }

  const includeCatalogs = options.includeCatalogs !== false;

  if (userId === 'default' || !isDbConnected()) {
    return {
      port: DEFAULTS.port,
      cors_origins: DEFAULTS.cors_origins,
      model_routing: DEFAULTS.model_routing,
      stub_models: DEFAULTS.stub_models,
      request_minimization_enabled: DEFAULTS.request_minimization_enabled,
      chat_max_upstream_attempts: DEFAULTS.chat_max_upstream_attempts,
      token_optimization_enabled: DEFAULTS.token_optimization_enabled,
      prompt_budget_tokens: DEFAULTS.prompt_budget_tokens,
      token_summarization_enabled: DEFAULTS.token_summarization_enabled,
      response_cache_enabled: DEFAULTS.response_cache_enabled,
      response_cache_ttl_seconds: DEFAULTS.response_cache_ttl_seconds,
      active_provider_id: normalizeActiveProviderId(DEFAULTS.providers, DEFAULTS.active_provider_id),
      active_model_id: DEFAULTS.active_model_id,
      active_provider_ids: getActiveProviderIds(DEFAULTS.providers),
      providers: DEFAULTS.providers,
      model_catalogs: [],
    };
  }

  const uId = new mongoose.Types.ObjectId(userId.toString());
  const cacheKey = getConfigCacheKey(uId, includeCatalogs);
  const cached = configCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Fetch everything in parallel
  const [user, userConfig, catalogs, providerDocs] = await Promise.all([
    User.findById(uId).lean(),
    UserConfig.findOne({ userId: uId }).lean(),
    includeCatalogs ? ModelCatalog.find({ userId: uId }).lean() : Promise.resolve([]),
    Provider.find({ userId: uId }).lean()
  ]);

  if (!user) {
    return { ...DEFAULTS, model_catalogs: [] };
  }

  // Determine which config to use (prefer UserConfig if it exists)
  const cfg = userConfig || user.config || {};

  const providers = providerDocs.length > 0
    ? providerDocs.map(p => ({
      id: p.providerId,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      apiKeys: p.apiKeys && p.apiKeys.length > 0 ? p.apiKeys : (p.apiKey ? [p.apiKey] : []),
      isActive: p.isActive
    }))
    : (user.providers || []).map(p => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      apiKeys: p.apiKeys && p.apiKeys.length > 0 ? p.apiKeys : (p.apiKey ? [p.apiKey] : []),
      isActive: p.isActive
    }));

  const activeProviderId = normalizeActiveProviderId(providers, cfg.activeProviderId || user.activeProviderId || null);
  const modelRouting = normalizeModelRouting(
    cfg.modelRouting !== undefined ? cfg.modelRouting : user.config?.modelRouting
  );
  const config = {
    port: cfg.port || user.config?.port || DEFAULTS.port,
    cors_origins: cfg.corsOrigins?.length ? cfg.corsOrigins : (user.config?.corsOrigins?.length ? user.config.corsOrigins : DEFAULTS.cors_origins),
    model_routing: modelRouting,
    active_provider_id: activeProviderId,
    active_model_id: cfg.activeModelId ?? user.config?.activeModelId ?? DEFAULTS.active_model_id,
    active_provider_ids: getActiveProviderIds(providers),
    stub_models: cfg.stubModels || user.config?.stubModels || [],
    request_minimization_enabled: cfg.requestMinimizationEnabled ?? user.config?.requestMinimizationEnabled ?? DEFAULTS.request_minimization_enabled,
    chat_max_upstream_attempts: cfg.chatMaxUpstreamAttempts ?? user.config?.chatMaxUpstreamAttempts ?? DEFAULTS.chat_max_upstream_attempts,
    token_optimization_enabled: cfg.tokenOptimizationEnabled ?? user.config?.tokenOptimizationEnabled ?? DEFAULTS.token_optimization_enabled,
    prompt_budget_tokens: cfg.promptBudgetTokens ?? user.config?.promptBudgetTokens ?? DEFAULTS.prompt_budget_tokens,
    token_summarization_enabled: cfg.tokenSummarizationEnabled ?? user.config?.tokenSummarizationEnabled ?? DEFAULTS.token_summarization_enabled,
    response_cache_enabled: cfg.responseCacheEnabled ?? user.config?.responseCacheEnabled ?? DEFAULTS.response_cache_enabled,
    response_cache_ttl_seconds: cfg.responseCacheTtlSeconds ?? user.config?.responseCacheTtlSeconds ?? DEFAULTS.response_cache_ttl_seconds,
    providers,
    model_catalogs: catalogs
  };

  // No fallback to DEFAULTS.providers - let it be empty if that's the state in DB

  if (process.env.PORT) {
    config.port = parseInt(process.env.PORT, 10);
  }

  configCache.set(cacheKey, {
    value: config,
    expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
  });

  return config;
}

/**
 * Save config updates for a specific user.
 */
async function saveConfig(userId, updates) {
  if (!userId) throw new Error('saveConfig requires a userId');
  clearConfigCache(userId);

  if (!isDbConnected()) {
    const base = await loadConfig('default');
    return {
      ...base,
      ...updates,
      model_routing: updates.model_routing !== undefined
        ? normalizeModelRouting(updates.model_routing)
        : base.model_routing,
    };
  }

  const uId = new mongoose.Types.ObjectId(userId.toString());
  const user = await User.findById(uId).select('providers activeProviderId').lean();
  if (!user) throw new Error('User not found during saveConfig');

  const userUpdates = {};
  let providersForNormalization = user.providers || [];

  // 1. Update User document compatibility fields atomically. Do not use
  // user.save() here: Settings can issue overlapping saves, and Mongoose
  // version checks on the loaded document can reject otherwise valid updates.
  if (updates.active_provider_id !== undefined) {
    userUpdates.activeProviderId = updates.active_provider_id;
  }

  if (updates.providers && Array.isArray(updates.providers)) {
    const replaceProviders = updates.replace_providers === true;

    // Sync to Provider collection
    const syncOps = updates.providers.map(p => ({
      updateOne: {
        filter: { userId: uId, providerId: p.id },
        update: {
          $set: {
            name: p.name,
            baseUrl: p.baseUrl,
            apiKey: p.apiKey,
            apiKeys: p.apiKeys || [],
            isActive: p.isActive !== undefined ? p.isActive : true
          }
        },
        upsert: true
      }
    }));
    if (syncOps.length > 0) await Provider.bulkWrite(syncOps);

    if (replaceProviders) {
      const providerIds = updates.providers.map((p) => p.id);
      await Provider.deleteMany({
        userId: uId,
        providerId: { $nin: providerIds }
      });
    }

    // Also keep in User document for backward compatibility
    const incomingProviders = updates.providers.map(p => {
      const apiKeys = Array.isArray(p.apiKeys) ? p.apiKeys : (p.apiKey ? [p.apiKey] : []);
      const primaryKey = p.apiKey || (apiKeys.length > 0 ? apiKeys[0] : '');

      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: primaryKey,
        apiKeys: apiKeys,
        isActive: p.isActive !== undefined ? p.isActive : true
      };
    });

    providersForNormalization = replaceProviders
      ? incomingProviders
      : [
          ...((user.providers || []).filter(
            (existing) => !incomingProviders.some((incoming) => incoming.id === existing.id)
          )),
          ...incomingProviders,
        ];

    userUpdates.providers = providersForNormalization;
  } else {
    const providerDocs = await Provider.find({ userId: uId }).lean();
    if (providerDocs.length > 0) {
      providersForNormalization = providerDocs.map((p) => ({
        id: p.providerId,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        apiKeys: p.apiKeys && p.apiKeys.length > 0 ? p.apiKeys : (p.apiKey ? [p.apiKey] : []),
        isActive: p.isActive,
      }));
    }
  }

  if (updates.providers !== undefined || updates.active_provider_id !== undefined) {
    const requestedActiveProviderId = updates.active_provider_id !== undefined
      ? updates.active_provider_id
      : user.activeProviderId;
    userUpdates.activeProviderId = normalizeActiveProviderId(
      providersForNormalization,
      requestedActiveProviderId
    );
  }

  if (Object.keys(userUpdates).length > 0) {
    await User.updateOne({ _id: uId }, { $set: userUpdates });
  }

  // 2. Update/Create UserConfig document (for specific settings)
  const configUpdates = {
    userId: uId,
  };
  if (updates.port !== undefined) configUpdates.port = updates.port;
  if (updates.cors_origins !== undefined) configUpdates.corsOrigins = updates.cors_origins;
  if (updates.model_routing !== undefined) configUpdates.modelRouting = normalizeModelRouting(updates.model_routing);
  if (updates.active_provider_id !== undefined) configUpdates.activeProviderId = updates.active_provider_id;
  if (updates.active_model_id !== undefined) configUpdates.activeModelId = String(updates.active_model_id || '').trim();
  if (updates.stub_models !== undefined) configUpdates.stubModels = updates.stub_models;
  if (updates.request_minimization_enabled !== undefined) {
    configUpdates.requestMinimizationEnabled = updates.request_minimization_enabled;
  }
  if (updates.chat_max_upstream_attempts !== undefined) {
    const parsedAttempts = Number(updates.chat_max_upstream_attempts);
    configUpdates.chatMaxUpstreamAttempts = Number.isFinite(parsedAttempts) && parsedAttempts >= 1
      ? Math.floor(parsedAttempts)
      : DEFAULTS.chat_max_upstream_attempts;
  }
  if (updates.token_optimization_enabled !== undefined) {
    configUpdates.tokenOptimizationEnabled = !!updates.token_optimization_enabled;
  }
  if (updates.prompt_budget_tokens !== undefined) {
    const parsedBudget = Number(updates.prompt_budget_tokens);
    configUpdates.promptBudgetTokens = Number.isFinite(parsedBudget) && parsedBudget >= 0
      ? Math.floor(parsedBudget)
      : DEFAULTS.prompt_budget_tokens;
  }
  if (updates.token_summarization_enabled !== undefined) {
    configUpdates.tokenSummarizationEnabled = !!updates.token_summarization_enabled;
  }
  if (updates.response_cache_enabled !== undefined) {
    configUpdates.responseCacheEnabled = !!updates.response_cache_enabled;
  }
  if (updates.response_cache_ttl_seconds !== undefined) {
    const parsedTtl = Number(updates.response_cache_ttl_seconds);
    configUpdates.responseCacheTtlSeconds = Number.isFinite(parsedTtl) && parsedTtl > 0
      ? Math.floor(parsedTtl)
      : DEFAULTS.response_cache_ttl_seconds;
  }

  await UserConfig.findOneAndUpdate(
    { userId: uId },
    { $set: configUpdates },
    { upsert: true, returnDocument: 'after' }
  );

  clearConfigCache(uId);
  return await loadConfig(uId);
}

module.exports = { loadConfig, saveConfig, loadGlobalConfig, clearConfigCache, DEFAULTS };
