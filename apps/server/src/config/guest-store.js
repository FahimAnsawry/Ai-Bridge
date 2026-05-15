const fs = require('fs');
const path = require('path');

const GUEST_USER_ID = 'guest-local-user';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const GUEST_USER_FILE = path.join(DATA_DIR, 'guest-user.json');
const GUEST_CONFIG_FILE = path.join(DATA_DIR, 'guest-config.json');

const DEFAULT_GUEST_USER = {
  _id: GUEST_USER_ID,
  email: 'guest@local.host',
  role: 'admin',
  displayName: 'Guest User',
  accessKey: 'guest-local-key',
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`[guest-store] Failed to read ${path.basename(filePath)}: ${error.message}`);
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function isGuestUserId(userId) {
  return String(userId || '') === GUEST_USER_ID;
}

function loadGuestUser() {
  const raw = readJson(GUEST_USER_FILE, DEFAULT_GUEST_USER);
  const user = {
    ...DEFAULT_GUEST_USER,
    ...(raw && typeof raw === 'object' ? raw : {}),
    _id: GUEST_USER_ID,
  };
  writeJson(GUEST_USER_FILE, user);
  return user;
}

function saveGuestUser(user) {
  const next = {
    ...DEFAULT_GUEST_USER,
    ...(user && typeof user === 'object' ? user : {}),
    _id: GUEST_USER_ID,
  };
  writeJson(GUEST_USER_FILE, next);
  return next;
}

function regenerateGuestAccessKey() {
  const nextKey = `guest-${Math.random().toString(36).slice(2, 10)}`;
  const user = loadGuestUser();
  user.accessKey = nextKey;
  return saveGuestUser(user);
}

function loadGuestConfig(defaults) {
  const fallback = {
    port: defaults.port,
    cors_origins: defaults.cors_origins,
    model_routing: defaults.model_routing,
    stub_models: defaults.stub_models,
    request_minimization_enabled: defaults.request_minimization_enabled,
    chat_max_upstream_attempts: defaults.chat_max_upstream_attempts,
    token_optimization_enabled: defaults.token_optimization_enabled,
    prompt_budget_tokens: defaults.prompt_budget_tokens,
    token_summarization_enabled: defaults.token_summarization_enabled,
    response_cache_enabled: defaults.response_cache_enabled,
    response_cache_ttl_seconds: defaults.response_cache_ttl_seconds,
    active_provider_id: defaults.active_provider_id,
    active_model_id: defaults.active_model_id,
    active_provider_ids: (defaults.providers || []).filter((provider) => provider?.isActive !== false).map((provider) => provider.id),
    providers: defaults.providers,
    model_catalogs: [],
  };

  const raw = readJson(GUEST_CONFIG_FILE, fallback);
  const config = {
    ...fallback,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  writeJson(GUEST_CONFIG_FILE, config);
  return config;
}

function saveGuestConfig(config) {
  writeJson(GUEST_CONFIG_FILE, config);
  return config;
}

module.exports = {
  GUEST_USER_ID,
  isGuestUserId,
  loadGuestUser,
  saveGuestUser,
  regenerateGuestAccessKey,
  loadGuestConfig,
  saveGuestConfig,
};
