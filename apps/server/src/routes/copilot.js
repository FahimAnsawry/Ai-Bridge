/**
 * routes/copilot.js — GitHub Copilot Proxy Routes
 *
 * Auth endpoints (no API key required — used to set up auth):
 *   POST /copilot/auth/start          → Start GitHub Device Flow
 *   GET  /copilot/auth/poll           → Poll for token completion
 *   GET  /copilot/auth/status         → Check current auth state
 *   POST /copilot/auth/set-token      → Manually inject a GitHub token (from `gh auth token`)
 *   POST /copilot/auth/logout         → Clear stored tokens
 *
 * Proxy endpoints (require local API key via requireAccessKey):
 *   GET  /copilot/v1/models           → List available Copilot models
 *   POST /copilot/v1/chat/completions → OpenAI-format chat (GPT-4o, o1, etc.)
 *   POST /copilot/v1/messages         → Anthropic-format chat (Claude models)
 */

const express = require('express');
const { requireAccessKey } = require('../middlewares/auth-middleware');
const { mongoose, User } = require('../config/db');
const {
  startDeviceFlow,
  pollDeviceFlow,
  getAuthStatus,
  getCopilotToken,
  setGithubToken,
  clearTokens,
} = require('../services/copilot-auth');
const {
  handleChatCompletions,
  handleMessages,
  handleModels,
} = require('../services/copilot-proxy');

const router = express.Router();

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function getRequestApiKey(req) {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return req.headers['x-api-key'] || req.query.key || bearer || null;
}

async function resolveCopilotUser(req) {
  if (req.user?._id) return req.user;
  if (!isDbConnected()) return null;

  const apiKey = getRequestApiKey(req);
  if (apiKey) {
    return User.findOne({ accessKey: apiKey }).select('_id accessKey').lean();
  }

  const users = await User.find().sort({ createdAt: 1 }).limit(2).select('_id accessKey').lean();
  return users.length === 1 ? users[0] : null;
}

router.use('/auth', async (req, res, next) => {
  try {
    req.copilotUser = await resolveCopilotUser(req);
    next();
  } catch (err) {
    next(err);
  }
});

// ── CORS preflight ─────────────────────────────────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Auth Routes (public — no API key needed) ───────────────────────────────────

/**
 * POST /copilot/auth/start
 * Begins the GitHub Device Flow. Returns user_code and verification_uri
 * that the user must visit to authorize.
 */
router.post('/auth/start', async (req, res) => {
  try {
    if (!req.copilotUser?._id) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Sign in or provide your Bridge API key.' });
    }

    const state = await startDeviceFlow(req.copilotUser._id);
    res.json({
      success: true,
      userCode:        state.userCode,
      verificationUri: state.verificationUri,
      expiresIn:       state.expiresIn,
      interval:        state.interval,
      message: `Visit ${state.verificationUri} and enter code: ${state.userCode}`,
    });
  } catch (err) {
    console.error('[copilot/auth/start]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /copilot/auth/poll
 * Poll this endpoint every `interval` seconds after starting device flow.
 * Returns { status: 'pending' | 'success' | 'expired' | 'slow_down' }
 * Falls back to returning current auth status if no device flow is active.
 */
router.get('/auth/poll', async (req, res) => {
  try {
    if (!req.copilotUser?._id) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Sign in or provide your Bridge API key.' });
    }

    const result = await pollDeviceFlow(req.copilotUser._id, req.copilotUser);
    console.log('[copilot/auth/poll] result:', result.status);
    res.json({ success: true, ...result });
  } catch (err) {
    // If no active device flow (e.g. after server restart), return current auth status
    const status = req.copilotUser?._id
      ? await getAuthStatus(req.copilotUser._id)
      : { authenticated: false };
    if (status.authenticated) {
      console.log('[copilot/auth/poll] No device flow, but already authenticated');
      return res.json({ success: true, status: 'success' });
    }
    console.error('[copilot/auth/poll] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /copilot/auth/debug
 * Shows raw auth state for troubleshooting.
 */
router.get('/auth/debug', async (req, res) => {
  const status = req.copilotUser?._id
    ? await getAuthStatus(req.copilotUser._id)
    : { authenticated: false, hasToken: false, deviceFlowActive: false, deviceFlowState: null, tokenExpiry: null };
  res.json({ ...status, userId: req.copilotUser?._id || null, timestamp: new Date().toISOString() });
});

/**
 * GET /copilot/auth/status
 * Returns the current authentication state without triggering any flow.
 */
router.get('/auth/status', async (req, res) => {
  if (!req.copilotUser?._id) {
    return res.json({
      authenticated: false,
      hasToken: false,
      tokenExpiry: null,
      deviceFlowActive: false,
      deviceFlowState: null,
    });
  }

  res.json(await getAuthStatus(req.copilotUser._id));
});

/**
 * POST /copilot/auth/set-token
 * Body: { token: "gho_xxxx" }
 * Manually inject a GitHub OAuth token (e.g. from `gh auth token`).
 * Useful for local dev without going through the Device Flow UI.
 */
router.post('/auth/set-token', async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Body must include { token: "gho_..." }' });
  }
  try {
    if (!req.copilotUser?._id) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Sign in or provide your Bridge API key.' });
    }

    await setGithubToken(req.copilotUser._id, token, req.copilotUser);
    await getCopilotToken(req.copilotUser._id, req.copilotUser);
    res.json({ success: true, message: 'GitHub token set and Copilot token acquired.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /copilot/auth/logout
 * Clears all stored GitHub and Copilot tokens.
 */
router.post('/auth/logout', async (req, res) => {
  if (!req.copilotUser?._id) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Sign in or provide your Bridge API key.' });
  }

  await clearTokens(req.copilotUser._id, req.copilotUser);
  res.json({ success: true, message: 'All Copilot tokens cleared.' });
});

// ── Proxy Routes (require local Bridge API key) ────────────────────────────────
router.use('/v1', requireAccessKey);

/**
 * GET /copilot/v1/models
 * Returns live model list from api.githubcopilot.com/models
 */
router.get('/v1/models', handleModels);

/**
 * POST /copilot/v1/chat/completions
 * OpenAI-compatible endpoint. Works with GPT-4o, o1, o3-mini, etc.
 * Also accepts Claude models — they're automatically routed to chat/completions.
 *
 * Compatible with: OpenAI SDK, LiteLLM, any OpenAI-format client
 */
router.post('/v1/chat/completions', handleChatCompletions);

/**
 * POST /copilot/v1/messages
 * Anthropic-compatible endpoint. Accepts Anthropic message format
 * and proxies it to Copilot's chat/completions (with format conversion).
 *
 * Compatible with: Claude Code CLI, Anthropic SDK, Cline, Roo Code
 */
router.post('/v1/messages', handleMessages);

/**
 * POST /copilot/v1/messages/count_tokens
 * Local token estimation — Copilot doesn't support this endpoint natively.
 * Returns a rough estimate so Claude Code CLI doesn't fail.
 */
router.post('/v1/messages/count_tokens', (req, res) => {
  const messages = req.body?.messages || [];
  const systemLen = typeof req.body?.system === 'string'
    ? req.body.system.length
    : (req.body?.system || []).reduce((a, b) => a + (b.text || '').length, 0);

  const bodyLen = messages.reduce((total, m) => {
    const content = typeof m.content === 'string'
      ? m.content
      : (m.content || []).map((b) => b.text || '').join('');
    return total + content.length;
  }, 0);

  // Rough estimate: ~4 chars per token
  const input_tokens = Math.ceil((systemLen + bodyLen) / 4);
  res.json({ input_tokens });
});

module.exports = router;
