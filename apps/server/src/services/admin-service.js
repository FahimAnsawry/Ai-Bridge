const { loadConfig, saveConfig, loadGlobalConfig } = require('../config/config');
const { getLogs, getLatestLog, clearLogs, getStats } = require('../middlewares/logger');
const { mongoose, User, ModelCatalog, RequestLog, Provider } = require('../config/db');

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function createAdminService(runtime) {
  async function getStatus(userId) {
    const runtimeState = await runtime.getState();
    const stats = await getStats(userId);
    const latestLog = await getLatestLog(userId);
    const modelCount = await ModelCatalog.countDocuments({ userId });

    const errorRate = stats.totalRequests > 0 
      ? Math.round((stats.errors / stats.totalRequests) * 100) 
      : 0;

    // Provide the requested fields
    return {
      running: runtimeState.running,
      uptimeMs: runtimeState.startedAt ? Date.now() - runtimeState.startedAt : 0,
      uptimeFormatted: runtimeState.running ? formatUptime(Date.now() - runtimeState.startedAt) : 'Stopped',
      totalRequests: stats.totalRequests,
      avgLatencyMs: stats.avgLatency,
      totalTokens: stats.totalTokens,
      estimatedTokenSavings: stats.estimatedTokenSavings || 0,
      optimizationRequests: stats.optimizationRequests || 0,
      summarizedRequests: stats.summarizedRequests || 0,
      tokensSavedByPrune: stats.tokensSavedByPrune || 0,
      tokensSavedBySummary: stats.tokensSavedBySummary || 0,
      cacheEligible: stats.cacheEligible || 0,
      cacheHits: stats.cacheHits || 0,
      cacheHitRate: stats.cacheHitRate || 0,
      errorCount: stats.errors,
      errorRate: errorRate,
      activeModels: modelCount,
      endpoint: runtimeState.endpoint,
      configuredPort: runtimeState.configuredPort,
      boundPort: runtimeState.boundPort,
      restartRequired: runtimeState.restartRequired,
      lastError: runtimeState.lastError,
      lastSyncAt: runtimeState.lastSync?.at || null,
      lastSyncStatus: runtimeState.lastSync?.success === false ? 'failed' : runtimeState.lastSync?.success ? 'success' : null,
      lastSyncMessage: runtimeState.lastSync?.message || '',
      lastRequestAt: latestLog?.timestamp || null,
      lastRequestModel: latestLog?.model || '',
      lastRequestPath: latestLog?.path || '',
    };
  }

  async function getConfig(userId) {
    return await loadConfig(userId);
  }

  async function saveConfigSnapshot(userId, updates) {
    try {
      const previousState = await runtime.getState();
      const next = await saveConfig(userId, updates);
      
      if (!next || typeof next !== 'object') {
        throw new Error('Config save returned invalid result');
      }

      return {
        success: true,
        config: next,
        restartRequired: previousState.running && Number(next.port) !== Number(previousState.boundPort),
      };
    } catch (error) {
      console.error('[saveConfigSnapshot] Error:', error.message);
      throw error;
    }
  }

  async function checkProviderHealth(userId) {
    const config = await loadConfig(userId);
    const providers = Array.isArray(config.providers) ? config.providers : [];
    const activeProviderId = config.active_provider_id;
    const selectedProviders = providers.filter((provider) => provider?.isActive !== false);
    const providersToReport = [...selectedProviders].sort((a, b) => {
      if (a.id === activeProviderId) return -1;
      if (b.id === activeProviderId) return 1;
      return 0;
    });

    if (providersToReport.length === 0) {
      return { providers: [], summary: { total: 0, online: 0, error: 0, unknown: 0 } };
    }

    const healthResults = providersToReport.map((provider) => {
      const hasKey = Array.isArray(provider.apiKeys)
        ? provider.apiKeys.some((k) => k && k.trim().length > 0)
        : Boolean(provider.apiKey);

      return {
        id: provider.id,
        name: provider.name || provider.id,
        isActive: provider.id === activeProviderId,
        isSelected: provider.isActive !== false,
        status: 'unknown',
        message: !provider.baseUrl ? 'No base URL configured' : (!hasKey ? 'No API key configured' : 'Provider configured'),
        latencyMs: null,
        hasApiKey: hasKey,
      };
    });

    const summary = {
      total: healthResults.length,
      online: healthResults.filter((provider) => provider.status === 'online').length,
      error: healthResults.filter((provider) => provider.status === 'error').length,
      unauthorized: healthResults.filter((provider) => provider.status === 'unauthorized').length,
      unknown: healthResults.filter((provider) => provider.status === 'unknown').length,
    };

    return { providers: healthResults, summary };
  }

  async function listLogs(userId, filters = {}) {
    return await getLogs(userId, filters);
  }

  async function clearAllLogs(userId) {
    await clearLogs(userId);
    return { success: true };
  }

  async function listModels(userId) {
    const config = await loadConfig(userId);
    const modelList = Array.isArray(config.model_catalogs) 
      ? config.model_catalogs.reduce((acc, cat) => acc.concat(cat.models || []), [])
      : [];
    const now = Math.floor(Date.now() / 1000);

    return {
      object: 'list',
      data: modelList.map((model) => ({
        id: model.id,
        object: 'model',
        created: now,
        owned_by: model.owned_by || 'custom',
      })),
    };
  }

  async function getModelOfferings(userId) {
    const config = await loadConfig(userId);
    const catalogs = config.model_catalogs || [];
    
    // For simplicity, just return the first one or merge them.
    // The SwiftRouter catalog is the primary one here.
    const swiftCatalog = catalogs.find(c => c.providerId === 'swiftrouter');

    if (!swiftCatalog) {
      return {
        sourceProviderId: 'swiftrouter',
        lastSyncedAt: null,
        totalModels: 0,
        totalProviders: 0,
        providers: [],
        categories: { chat: 0, vision: 0, code: 0, other: 0 },
        warnings: ['No model catalog metadata yet. Run sync to populate offerings.'],
      };
    }

    return swiftCatalog;
  }

  async function syncModels(userId) {
    // Actually runtime.syncModels has no user context if we pass it here without changing runtime signature,
    // wait, we DID change runtime signature to take userId on creation or we can change syncModels.
    // In proxy-runtime.js we changed `createProxyRuntime` to accept `options.userId`. 
    // But there's only ONE proxy runtime created in index.js currently.
    // Actually, Phase 5: "createProxyRuntime() now takes userId parameter".
    // Let's pass userId to syncModels directly if we didn't before. We changed it to `async function syncModels(options = {})`.
    // Wait, I changed proxy-runtime.js `syncModels` to use `userId` from its closure! That means one runtime per user?
    // Let's check `index.js`.
    // The plan says: "Modify server/proxy-runtime.js: createProxyRuntime() now takes userId parameter"
    // Wait! A single proxy-runtime for all users would mean passing userId to methods! 
    // If I changed `createProxyRuntime` to take `userId`, then how does index.js start it for all users? 
    // Oh, the AI proxy logic might be per-user or the dashboard uses one global runtime that delegates?
    // Let's just pass userId down.
    return await runtime.syncModels({ persist: true, userId });
  }

  // --- Admin Methods ---

  async function listAllUsers() {
    if (!isDbConnected()) return [];
    const users = await User.find().select('-accessKeyHash').lean();
    return users;
  }

  async function getGlobalStats() {
    if (!isDbConnected()) {
      const stats = await getStats(null);
      return { users: 0, ...stats };
    }
    const userCount = await User.countDocuments();
    const globalStats = await getStats(null); // null userId means all logs
    return {
      users: userCount,
      ...globalStats
    };
  }

  async function getUserById(id) {
    if (!isDbConnected()) return null;
    return await User.findById(id).select('-accessKeyHash').lean();
  }

  async function deleteUser(id) {
    if (!isDbConnected()) return { success: false, error: 'DB down' };
    await User.findByIdAndDelete(id);
    await RequestLog.deleteMany({ userId: id });
    await ModelCatalog.deleteMany({ userId: id });
    await Provider.deleteMany({ userId: id });
    // also delete config/providers
    return { success: true };
  }

  async function setUserRole(id, role) {
    if (!isDbConnected()) return null;
    const user = await User.findByIdAndUpdate(id, { role }, { new: true }).select('-accessKeyHash');
    return user;
  }

  return {
    getStatus,
    getConfig,
    saveConfig: saveConfigSnapshot,
    listLogs,
    clearLogs: clearAllLogs,
    listModels,
    getModelOfferings,
    syncModels,
    checkProviderHealth,
    listAllUsers,
    getGlobalStats,
    getUserById,
    deleteUser,
    setUserRole,
  };
}

module.exports = {
  createAdminService,
  formatUptime,
};
