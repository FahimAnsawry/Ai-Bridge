/**
 * routes/v1.js — OpenAI & Anthropic Compatible Proxy Routes
 *
 * Mounts under /v1 and forwards every request through the core proxy.
 * Protected by the local API key authentication middleware.
 *
 * Supported endpoints:
 *   POST /v1/chat/completions      — OpenAI Chat (streaming & non-streaming)
 *   POST /v1/messages              — Anthropic Messages API (Claude Code, Cline)
 *   POST /v1/messages/count_tokens — Anthropic token counting
 *   GET  /v1/models                — Model list
 *   POST /v1/embeddings            — Text embeddings
 *   POST /v1/images/generations    — Image generation
 *   POST /v1/audio/speech          — Text-to-speech
 *   POST /v1/audio/transcriptions  — Speech-to-text
 */

const express = require('express');
const { requireAccessKey } = require('../middlewares/auth-middleware');
const { proxyRequest } = require('../services/proxy');
const { estimatePromptTokens } = require('../utils/token-budget');

const router = express.Router();

const GATEWAY_MODELS = [
  { id: 'moonshotai/kimi-k2.6', owned_by: 'moonshot' },
  { id: 'deepseek-ai/deepseek-v4-pro', owned_by: 'deepseek' },
  { id: 'qwen/qwen3.5-397b-a17b', owned_by: 'qwen' },
  { id: 'minimaxai/minimax-m2.7', owned_by: 'minimax' },
  { id: 'z-ai/glm-5.1', owned_by: 'z-ai' },
  { id: 'gemini-3.1-pro-preview', owned_by: 'google' },
  { id: 'deepseek-v4-flash', owned_by: 'deepseek' },
];

// All routes under /v1 require a valid local API key (now using requireAccessKey)
router.use(requireAccessKey);

// CORS preflight for Anthropic clients (Claude CLI)
router.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
    return res.status(204).end();
  }
  next();
});

// ── OpenAI Chat ───────────────────────────────────────────────────────────────
router.post('/chat/completions', proxyRequest);

// ── Anthropic Messages API (Claude Code, Cline, Roo Code) ─────────────────────
router.post('/messages', (req, res, next) => {
  // console.log('[Claude CLI] Incoming /messages request:');
  // console.log('[Claude CLI] Body model:', req.body?.model, '| stream:', req.body?.stream);
  next();
}, proxyRequest);

// ── count_tokens: handled LOCALLY — AgentRouter doesn't support this endpoint.
// Claude CLI calls this before every message; a 404/503 upstream causes retry loops.
router.post('/messages/count_tokens', (req, res) => {
  const inputTokens = estimatePromptTokens({
    system: req.body?.system,
    messages: req.body?.messages || [],
  });

  // console.log(`[count_tokens] Estimated ${inputTokens} tokens locally (no upstream call)`);
  return res.json({ input_tokens: inputTokens });
});

router.post('/messages/batches', proxyRequest);
router.get('/messages/batches', proxyRequest);
router.get('/messages/batches/:id', proxyRequest);

// ── Models ────────────────────────────────────────────────────────────────────
router.get('/models', (req, res) => {
  const created = Math.floor(Date.now() / 1000);
  return res.json({
    object: 'list',
    data: GATEWAY_MODELS.map((model) => ({
      id: model.id,
      object: 'model',
      created,
      owned_by: model.owned_by,
    })),
  });
});

router.get('/models/:model', (req, res) => {
  return res.json({
    id: req.params.model,
    object: 'model',
    created: Date.now(),
    owned_by: 'system'
  });
});

// ── Embeddings ────────────────────────────────────────────────────────────────
router.post('/embeddings', proxyRequest);

// ── Images ────────────────────────────────────────────────────────────────────
router.post('/images/generations', proxyRequest);
router.post('/images/edits', proxyRequest);
router.post('/images/variations', proxyRequest);

// ── Audio ─────────────────────────────────────────────────────────────────────
router.post('/audio/speech', proxyRequest);
router.post('/audio/transcriptions', proxyRequest);
router.post('/audio/translations', proxyRequest);

// ── Completions (legacy) ──────────────────────────────────────────────────────
router.post('/completions', proxyRequest);

module.exports = router;
