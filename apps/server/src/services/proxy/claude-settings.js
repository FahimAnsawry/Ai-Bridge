const fs = require('fs');
const path = require('path');

const claudeSettingsCache = new Map();

function getClaudeSettingsPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR ||
    (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.claude') : null) ||
    (process.env.HOME ? path.join(process.env.HOME, '.claude') : null);
  return configDir ? path.join(configDir, 'settings.json') : null;
}

function readClaudeSettings() {
  const settingsPath = getClaudeSettingsPath();
  if (!settingsPath) return null;

  let stat;
  try {
    stat = fs.statSync(settingsPath);
  } catch {
    claudeSettingsCache.delete(settingsPath);
    return null;
  }

  const cached = claudeSettingsCache.get(settingsPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.settings;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    claudeSettingsCache.set(settingsPath, { mtimeMs: stat.mtimeMs, settings });
    return settings;
  } catch (err) {
    console.warn(`[proxy] Failed to read Claude settings from ${settingsPath}: ${err.message}`);
    claudeSettingsCache.set(settingsPath, { mtimeMs: stat.mtimeMs, settings: null });
    return null;
  }
}

function writeClaudeSelectedModel(accessKey, model) {
  const settingsPath = getClaudeSettingsPath();
  const settings = readClaudeSettings();
  if (!settingsPath || !settings || typeof settings !== 'object') return false;

  const settingsToken = settings.env?.ANTHROPIC_AUTH_TOKEN;
  if (!accessKey || settingsToken !== accessKey) return false;

  const selectedModel = typeof model === 'string' ? model.trim() : '';
  if (!selectedModel) return false;

  settings.model = selectedModel;

  try {
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    const stat = fs.statSync(settingsPath);
    claudeSettingsCache.set(settingsPath, { mtimeMs: stat.mtimeMs, settings });
    return true;
  } catch (err) {
    console.warn(`[proxy] Failed to write Claude selected model to ${settingsPath}: ${err.message}`);
    claudeSettingsCache.delete(settingsPath);
    return false;
  }
}

function resolveClaudeSelectedModel(accessKey) {
  const settings = readClaudeSettings();
  if (!settings || typeof settings !== 'object') return null;

  const settingsToken = settings.env?.ANTHROPIC_AUTH_TOKEN;
  if (!accessKey || settingsToken !== accessKey) return null;

  const model = typeof settings.model === 'string' ? settings.model.trim() : '';
  return normalizeClaudeModelAlias(model) || null;
}

function normalizeClaudeModelAlias(model) {
  if (!model || typeof model !== 'string') return model;

  const normalized = model.trim();

  // Short alias: --model sonnet  →  claude-sonnet-4-6 (standard)
  if (/^\.?sonnet$/i.test(normalized)) {
    return 'claude-sonnet-4-6';
  }

  // 1M-context alias: --model sonnet[1m]  →  claude-sonnet-4.6
  if (/^\.?sonnet\[1m\]$/i.test(normalized)) {
    return 'claude-sonnet-4.6';
  }

  // Short alias: --model opus  →  claude-opus-4-7
  if (/^\.?opus$/i.test(normalized)) {
    return 'claude-opus-4-7';
  }

  // Claude Code /model → Sonnet 4.6 (standard): claude-sonnet-4-6, claude-sonnet-4.6, claude-sonnet-4-6-20250514
  if (/^claude-sonnet-4[-.]6(?:-\d{8})?$/i.test(normalized)) {
    return 'claude-sonnet-4-6';
  }

  // Claude Code /model → Sonnet 4.6 (1M): claude-sonnet-4-6-20250514-1k, claude-sonnet-4.6-1m
  if (/^claude-sonnet-4[-.]6(?:-\d{8})?-1[km]$/i.test(normalized)) {
    return 'claude-sonnet-4.6';
  }

  // Claude Code /model → Opus 4.7: claude-opus-4.7, claude-opus-4-7, claude-opus-4-7-20250514
  if (/^claude-opus-4[-.]7(?:-\d{8})?$/i.test(normalized)) {
    return 'claude-opus-4-7';
  }

  // Claude Code /model → Opus 4.8: claude-opus-4.8, claude-opus-4-8, claude-opus-4-8-20250514
  if (/^claude-opus-4[-.]8(?:-\d{8})?$/i.test(normalized)) {
    return 'claude-opus-4-8';
  }

  return model;
}

module.exports = {
  writeClaudeSelectedModel,
  resolveClaudeSelectedModel,
  normalizeClaudeModelAlias,
};
