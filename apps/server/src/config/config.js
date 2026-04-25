/**
 * config.js — Configuration Store (MongoDB version)
 */

const { mongoose, User, GlobalConfig, ModelCatalog, UserConfig, Provider } = require('./db');

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

const DEFAULTS = {
  port: 3000,
  cors_origins: ['*'],
  model_routing: 'fallback',
  model_mapping: {
    'kimi-k2.5': 'kimi-k2.5',
    'kimi-k2': 'kimi-k2.5',
    'kimi': 'kimi-k2.5',
    'claude-haiku-4-5-20251001': 'deepseek-v3.2',
    'claude-opus-4-6': 'claude-opus-4-6',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet-4.6': 'claude-sonnet-4-6',
    'claude-opus-4.6': 'claude-opus-4-6',
    'claude-3-5-sonnet-20241022': 'deepseek-v3.2',
    'glm-5.1': 'glm-5.1',
    'kimi-k2.6': 'kimi-k2.6',
    'minimax-m2.7': 'minimax-m2.7',
    'qwen-3.6-plus': 'qwen-3.6-plus',
    'gemini-3-flash-preview': 'gemini-3-flash-preview',
    'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
    'deepseek-v3.2': 'deepseek-v3.2',
    'deepseek-r1-0528': 'deepseek-r1-0528',
  },
  stub_models: [],
  request_minimization_enabled: true,
  chat_max_upstream_attempts: 4,
  active_provider_id: 'swiftrouter',
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
    }
  ]
};

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
async function loadConfig(userId) {
  if (!userId) {
    throw new Error('loadConfig requires a userId');
  }

  if (userId === 'default' || !isDbConnected()) {
    return {
      port: DEFAULTS.port,
      cors_origins: DEFAULTS.cors_origins,
      model_routing: DEFAULTS.model_routing,
      model_mapping: { ...DEFAULTS.model_mapping },
      stub_models: DEFAULTS.stub_models,
      request_minimization_enabled: DEFAULTS.request_minimization_enabled,
      chat_max_upstream_attempts: DEFAULTS.chat_max_upstream_attempts,
      providers: DEFAULTS.providers,
      model_catalogs: [],
    };
  }

  const uId = new mongoose.Types.ObjectId(userId.toString());
  
  // Fetch everything in parallel
  const [user, userConfig, catalogs, providerDocs] = await Promise.all([
    User.findById(uId),
    UserConfig.findOne({ userId: uId }),
    ModelCatalog.find({ userId: uId }),
    Provider.find({ userId: uId })
  ]);

  if (!user) {
    return { ...DEFAULTS, model_catalogs: [] };
  }

  // Determine which config to use (prefer UserConfig if it exists)
  const cfg = userConfig || user.config || {};
  
  const modelMapping = cfg.modelMapping 
    ? (cfg.modelMapping instanceof Map ? Object.fromEntries(cfg.modelMapping) : cfg.modelMapping)
    : { ...DEFAULTS.model_mapping };

  const config = {
    port: cfg.port || user.config?.port || DEFAULTS.port,
    cors_origins: cfg.corsOrigins?.length ? cfg.corsOrigins : (user.config?.corsOrigins?.length ? user.config.corsOrigins : DEFAULTS.cors_origins),
    model_routing: cfg.modelRouting || user.config?.modelRouting || DEFAULTS.model_routing,
    active_provider_id: cfg.activeProviderId || user.activeProviderId || null,
    model_mapping: modelMapping,
    stub_models: cfg.stubModels || user.config?.stubModels || [],
    request_minimization_enabled: cfg.requestMinimizationEnabled ?? user.config?.requestMinimizationEnabled ?? DEFAULTS.request_minimization_enabled,
    chat_max_upstream_attempts: cfg.chatMaxUpstreamAttempts ?? user.config?.chatMaxUpstreamAttempts ?? DEFAULTS.chat_max_upstream_attempts,
    providers: providerDocs.length > 0
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
        })),
    model_catalogs: catalogs
  };

  // No fallback to DEFAULTS.providers - let it be empty if that's the state in DB

  if (process.env.PORT) {
    config.port = parseInt(process.env.PORT, 10);
  }

  return config;
}

/**
 * Save config updates for a specific user.
 */
async function saveConfig(userId, updates) {
  if (!userId) throw new Error('saveConfig requires a userId');

  if (!isDbConnected()) {
    const base = await loadConfig('default');
    return { ...base, ...updates };
  }

  const uId = new mongoose.Types.ObjectId(userId.toString());
  const user = await User.findById(uId);
  if (!user) throw new Error('User not found during saveConfig');

  // 1. Update User document (for providers and activeProviderId)
  if (updates.active_provider_id !== undefined) user.activeProviderId = updates.active_provider_id;
  if (updates.providers && Array.isArray(updates.providers)) {
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

    // Also keep in User document for backward compatibility
    user.providers = updates.providers.map(p => {
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
  }
  await user.save();

  // 2. Update/Create UserConfig document (for specific settings)
  const configUpdates = {
    userId: uId,
  };
  if (updates.port !== undefined) configUpdates.port = updates.port;
  if (updates.cors_origins !== undefined) configUpdates.corsOrigins = updates.cors_origins;
  if (updates.model_routing !== undefined) configUpdates.modelRouting = updates.model_routing;
  if (updates.active_provider_id !== undefined) configUpdates.activeProviderId = updates.active_provider_id;
  if (updates.model_mapping !== undefined) {
    configUpdates.modelMapping = new Map(Object.entries(updates.model_mapping));
  }
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

  await UserConfig.findOneAndUpdate(
    { userId: uId },
    { $set: configUpdates },
    { upsert: true, new: true }
  );

  return await loadConfig(uId);
}

module.exports = { loadConfig, saveConfig, loadGlobalConfig, DEFAULTS };
