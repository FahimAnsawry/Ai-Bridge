/**
 * model-catalog-sync.js
 *
 * Pulls live model IDs from provider OpenAI-compatible /models endpoints,
 * normalizes them into model catalogs, and derives a lightweight
 * offerings summary for UI display.
 */

const axios = require('axios');
const { loadConfig, clearConfigCache } = require('../config/config');
const { isGuestUserId, loadGuestConfig, saveGuestConfig } = require('../config/guest-store');

function normalizeBaseUrl(url = '') {
  return String(url).replace(/\/+$/, '');
}

function isBlazeApiBaseUrl(url = '') {
  return String(url).toLowerCase().includes('blazeai.boxu.dev');
}

function normalizeProviderBaseUrl(url = '') {
  const baseUrl = normalizeBaseUrl(url);
  if (!isBlazeApiBaseUrl(baseUrl)) return baseUrl;

  return baseUrl
    .replace(/\/api\/v1$/i, '/api')
    .replace(/\/v1$/i, '/api')
    .replace(/\/api$/i, '/api')
    .replace(/^(https?:\/\/blazeai\.boxu\.dev)$/i, '$1/api');
}

function inferProviderFromId(id = '') {
  const s = String(id).toLowerCase();
  if (s.includes('claude')) return 'Anthropic';
  if (s.includes('gpt') || s.includes('o1') || s.includes('o3') || s.includes('o4')) return 'OpenAI';
  if (s.includes('gemini') || s.includes('gemma')) return 'Google';
  if (s.includes('deepseek')) return 'DeepSeek';
  if (s.includes('mistral') || s.includes('mixtral')) return 'Mistral';
  if (s.includes('llama')) return 'Meta';
  if (s.includes('qwen')) return 'Qwen';
  if (s.includes('command')) return 'Cohere';
  if (s.includes('zhipu') || s.includes('glm')) return 'Zhipu';
  if (s.includes('minimax')) return 'MiniMax';
  if (s.includes('moonshot') || s.includes('kimi')) return 'Moonshot';
  if (s.includes('ibm') || s.includes('granite')) return 'IBM';
  if (s.includes('essential')) return 'EssentialAI';
  if (s.includes('cogito')) return 'DeepCogito';
  return 'Unknown';
}

function isRemovedClaudeHaikuModel(id = '') {
  return /^claude(?:\s+|-)haiku(?:\s+|-)4[.-]5(?:-[\w.-]+)?$/i.test(String(id));
}

function inferCategory(model, id = '') {
  const s = String(id).toLowerCase();

  const categoryValue = String(model?.category || '').toLowerCase();
  if (categoryValue.includes('vision')) return 'vision';
  if (categoryValue.includes('code')) return 'code';
  if (categoryValue.includes('chat')) return 'chat';

  const modalities = [
    ...(Array.isArray(model?.modalities) ? model.modalities : []),
    ...(Array.isArray(model?.input_modalities) ? model.input_modalities : []),
    ...(Array.isArray(model?.output_modalities) ? model.output_modalities : []),
  ].map((v) => String(v).toLowerCase());

  if (modalities.some((m) => m.includes('image') || m.includes('vision'))) return 'vision';
  if (modalities.some((m) => m.includes('code'))) return 'code';

  if (
    s.includes('vision') ||
    s.includes('vl') ||
    s.includes('image') ||
    s.includes('omni') ||
    s.includes('multimodal')
  ) {
    return 'vision';
  }

  if (s.includes('code') || s.includes('coder') || s.includes('codex')) {
    return 'code';
  }

  return 'chat';
}

function extractModelArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  return [];
}

function normalizeModels(rawModels) {
  const seen = new Set();
  const normalized = [];

  for (const item of rawModels) {
    const id = typeof item === 'string' ? item : item?.id || item?.model || '';
    if (!id || seen.has(id) || isRemovedClaudeHaikuModel(id)) continue;
    seen.add(id);

    const ownedBy =
      (typeof item === 'object' && (item.owned_by || item.provider || item.vendor)) ||
      inferProviderFromId(id);

    normalized.push({
      id,
      object: 'model',
      owned_by: String(ownedBy || 'custom'),
    });
  }

  return normalized;
}

function mergeCustomModels(syncedModels, existingModels) {
  const seen = new Set();
  const merged = [];

  for (const model of Array.isArray(syncedModels) ? syncedModels : []) {
    if (!model || !model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  for (const model of Array.isArray(existingModels) ? existingModels : []) {
    if (!model || !model.id || seen.has(model.id) || isRemovedClaudeHaikuModel(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

function buildOfferings(rawModels, normalizedModels, warnings = [], sourceProviderId = 'swiftrouter') {
  const providers = new Set();
  const categories = { chat: 0, vision: 0, code: 0, other: 0 };

  // Build a lookup map from model id → raw model object for accurate category inference
  const rawModelMap = new Map();
  for (const raw of extractModelArray(rawModels)) {
    const id = typeof raw === 'string' ? raw : raw?.id || raw?.model || '';
    if (id) rawModelMap.set(id.toLowerCase(), raw);
  }

  for (const m of normalizedModels) {
    providers.add(m.owned_by || inferProviderFromId(m.id));

    const raw = rawModelMap.get(m.id.toLowerCase()) || null;
    const category = inferCategory(raw, m.id);
    if (category === 'chat' || category === 'vision' || category === 'code') {
      categories[category] += 1;
    } else {
      categories.other += 1;
    }
  }

  return {
    sourceProviderId,
    lastSyncedAt: new Date().toISOString(),
    totalModels: normalizedModels.length,
    totalProviders: providers.size,
    providers: Array.from(providers).sort((a, b) => a.localeCompare(b)),
    categories,
    warnings,
  };
}

async function syncProviderModels(userId, options = {}) {
  const persist = options.persist !== false;
  if (!userId) throw new Error('syncProviderModels requires a userId');

  const config = await loadConfig(userId);
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const targetProviderId = options.providerId || 'swiftrouter';
  const targetProvider = providers.find((p) => p.id === targetProviderId);
  const existingCatalog = (config.model_catalogs || []).find((cat) => cat.providerId === targetProviderId);
  const existingCustomModels = Array.isArray(existingCatalog?.models)
    ? existingCatalog.models
    : (Array.isArray(config.custom_models) ? config.custom_models : []);

  if (!targetProvider) {
    const err = new Error(`Provider "${targetProviderId}" is not configured in providers[].`);
    err.code = 'missing_provider';
    throw err;
  }

  const apiKey = (Array.isArray(targetProvider.apiKeys)
    ? targetProvider.apiKeys.find((key) => key && key.trim())
    : targetProvider.apiKey
  )?.trim();

  if (!apiKey) {
    const err = new Error(`${targetProvider.name || targetProvider.id} API key is missing. Add it in Settings before syncing models.`);
    err.code = 'missing_api_key';
    throw err;
  }

  const baseUrl = normalizeProviderBaseUrl(targetProvider.baseUrl);
  if (!baseUrl) {
    const err = new Error(`${targetProvider.name || targetProvider.id} baseUrl is empty.`);
    err.code = 'missing_base_url';
    throw err;
  }

  const modelsUrl = `${baseUrl}/models`;
  const response = await axios.get(modelsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    timeout: 25000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const details = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
    const err = new Error(`${targetProvider.name || targetProvider.id} /models failed with HTTP ${response.status}. ${details}`);
    err.code = 'upstream_error';
    err.status = response.status;
    throw err;
  }

  const rawModels = extractModelArray(response.data);
  if (!rawModels.length) {
    const err = new Error(`${targetProvider.name || targetProvider.id} returned no models from /models.`);
    err.code = 'empty_models';
    throw err;
  }

  const warnings = [];
  const normalizedModels = normalizeModels(rawModels);
  if (!normalizedModels.length) {
    const err = new Error(`Unable to normalize ${targetProvider.name || targetProvider.id} model list.`);
    err.code = 'normalize_failed';
    throw err;
  }

  const modelCatalog = buildOfferings(rawModels, normalizedModels, warnings, targetProvider.id);
  const mergedCustomModels = mergeCustomModels(normalizedModels, existingCustomModels);

  if (persist) {
    if (isGuestUserId(userId)) {
      const guestConfig = loadGuestConfig({
        port: 3000,
        cors_origins: ['*'],
        model_routing: {},
        stub_models: [],
        request_minimization_enabled: true,
        chat_max_upstream_attempts: 30,
        token_optimization_enabled: false,
        prompt_budget_tokens: 0,
        token_summarization_enabled: false,
        response_cache_enabled: false,
        response_cache_ttl_seconds: 30,
        active_provider_id: 'swiftrouter',
        active_model_id: '',
        providers: [],
      });

      const currentCatalogs = Array.isArray(guestConfig.model_catalogs) ? guestConfig.model_catalogs : [];
      const nextCatalogs = [
        ...currentCatalogs.filter((catalog) => catalog.providerId !== targetProvider.id),
        {
          providerId: targetProvider.id,
          models: mergedCustomModels,
          categories: modelCatalog.categories,
          lastSyncedAt: new Date().toISOString(),
          warnings: modelCatalog.warnings,
          sourceProviderId: modelCatalog.sourceProviderId,
          totalModels: modelCatalog.totalModels,
          totalProviders: modelCatalog.totalProviders,
          providers: modelCatalog.providers,
        },
      ];

      saveGuestConfig({
        ...guestConfig,
        model_catalogs: nextCatalogs,
      });
      clearConfigCache(userId);
    } else {
      const { ModelCatalog } = require('../config/db');

      await ModelCatalog.findOneAndUpdate(
        { userId, providerId: targetProvider.id },
        {
          models: mergedCustomModels,
          categories: modelCatalog.categories,
          lastSyncedAt: new Date(),
          warnings: modelCatalog.warnings
        },
        { upsert: true, returnDocument: 'after' }
      );
      clearConfigCache(userId);
    }

  }

  return {
    success: true,
    provider: {
      id: targetProvider.id,
      name: targetProvider.name,
      baseUrl: targetProvider.baseUrl,
    },
    syncedModels: normalizedModels.length,
    modelCatalog,
  };
}

async function syncSwiftRouterModels(userId, options = {}) {
  return syncProviderModels(userId, { ...options, providerId: options.providerId || 'swiftrouter' });
}

module.exports = {
  syncSwiftRouterModels,
  syncProviderModels,
  buildOfferings,
};
