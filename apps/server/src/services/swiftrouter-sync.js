/**
 * swiftrouter-sync.js
 *
 * Pulls live model IDs from SwiftRouter's OpenAI-compatible /models endpoint,
 * normalizes them into config.custom_models, and derives a lightweight
 * offerings summary for UI display.
 */

const axios = require('axios');
const { loadConfig, saveConfig } = require('../config/config');

function normalizeBaseUrl(url = '') {
  return String(url).replace(/\/+$/, '');
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
  if (s.includes('nvidia') || s.includes('nemotron')) return 'NVIDIA';
  if (s.includes('ibm') || s.includes('granite')) return 'IBM';
  if (s.includes('essential')) return 'EssentialAI';
  if (s.includes('cogito')) return 'DeepCogito';
  return 'Unknown';
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
    if (!id || seen.has(id)) continue;
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
    if (!model || !model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

function buildOfferings(rawModels, normalizedModels, warnings = []) {
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
    sourceProviderId: 'swiftrouter',
    lastSyncedAt: new Date().toISOString(),
    totalModels: normalizedModels.length,
    totalProviders: providers.size,
    providers: Array.from(providers).sort((a, b) => a.localeCompare(b)),
    categories,
    warnings,
  };
}

async function syncSwiftRouterModels(userId, options = {}) {
  const persist = options.persist !== false;
  if (!userId) throw new Error('syncSwiftRouterModels requires a userId');

  const config = await loadConfig(userId);
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const swiftProvider = providers.find((p) => p.id === 'swiftrouter');
  const existingCustomModels = Array.isArray(config.custom_models) ? config.custom_models : [];

  if (!swiftProvider) {
    const err = new Error('Provider "swiftrouter" is not configured in providers[].');
    err.code = 'missing_provider';
    throw err;
  }

  if (!swiftProvider.apiKey) {
    const err = new Error('SwiftRouter API key is missing. Add it in Settings before syncing models.');
    err.code = 'missing_api_key';
    throw err;
  }

  const baseUrl = normalizeBaseUrl(swiftProvider.baseUrl);
  if (!baseUrl) {
    const err = new Error('SwiftRouter baseUrl is empty.');
    err.code = 'missing_base_url';
    throw err;
  }

  const modelsUrl = `${baseUrl}/models`;
  const response = await axios.get(modelsUrl, {
    headers: {
      Authorization: `Bearer ${swiftProvider.apiKey}`,
      Accept: 'application/json',
    },
    timeout: 25000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const details = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
    const err = new Error(`SwiftRouter /models failed with HTTP ${response.status}. ${details}`);
    err.code = 'upstream_error';
    err.status = response.status;
    throw err;
  }

  const rawModels = extractModelArray(response.data);
  if (!rawModels.length) {
    const err = new Error('SwiftRouter returned no models from /models.');
    err.code = 'empty_models';
    throw err;
  }

  const warnings = [];
  const normalizedModels = normalizeModels(rawModels);
  if (!normalizedModels.length) {
    const err = new Error('Unable to normalize SwiftRouter model list.');
    err.code = 'normalize_failed';
    throw err;
  }

  const modelCatalog = buildOfferings(rawModels, normalizedModels, warnings);
  const mergedCustomModels = mergeCustomModels(normalizedModels, existingCustomModels);

  if (persist) {
    // Actually, Phase 5 plan says: "sync into user's model_catalogs collection instead of global config"
    // And "updates user's user_configs.modelMapping with normalized model names".
    // For now, let's just save the custom_models via saveConfig, but the schema doesn't have custom_models in Phase 1.
    // Let's use the ModelCatalog model directly.
    const { ModelCatalog, UserConfig } = require('../config/db');

    await ModelCatalog.findOneAndUpdate(
      { userId, providerId: swiftProvider.id },
      {
        models: mergedCustomModels,
        categories: modelCatalog.categories,
        lastSyncedAt: new Date(),
        warnings: modelCatalog.warnings
      },
      { upsert: true }
    );

    // Update modelMapping in user config with identity mappings for new models
    const userConfig = await UserConfig.findOne({ userId });
    if (userConfig) {
      const currentMapping = userConfig.modelMapping;
      const mappingAsObject = currentMapping instanceof Map
        ? Object.fromEntries(currentMapping)
        : (currentMapping && typeof currentMapping === 'object' ? { ...currentMapping } : {});

      let mappingUpdated = false;
      for (const m of normalizedModels) {
        if (!mappingAsObject[m.id]) {
          mappingAsObject[m.id] = m.id;
          mappingUpdated = true;
        }
      }

      if (mappingUpdated) {
        userConfig.modelMapping = mappingAsObject;
        await userConfig.save();
      }
    }
  }

  return {
    success: true,
    provider: {
      id: swiftProvider.id,
      name: swiftProvider.name,
      baseUrl: swiftProvider.baseUrl,
    },
    syncedModels: normalizedModels.length,
    modelCatalog,
  };
}

module.exports = {
  syncSwiftRouterModels,
  buildOfferings,
};
