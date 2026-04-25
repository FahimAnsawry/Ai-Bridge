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

const router = express.Router();

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
  console.log('[Claude CLI] Incoming /messages request:');
  console.log('[Claude CLI] Body model:', req.body?.model, '| stream:', req.body?.stream);
  next();
}, proxyRequest);

// ── count_tokens: handled LOCALLY — AgentRouter doesn't support this endpoint.
// Claude CLI calls this before every message; a 404/503 upstream causes retry loops.
router.post('/messages/count_tokens', (req, res) => {
  const messages = req.body?.messages || [];

  // system can be a string or an array of content blocks
  const systemText = typeof req.body?.system === 'string'
    ? req.body.system
    : Array.isArray(req.body?.system)
      ? req.body.system.map(b => b.text || '').join('')
      : '';

  let charCount = systemText.length;
  for (const msg of messages) {
    const c = msg.content;
    if (typeof c === 'string') {
      charCount += c.length;
    } else if (Array.isArray(c)) {
      charCount += c.map(b => b.text || '').join('').length;
    }
  }

  const inputTokens = Math.max(1, Math.ceil(charCount / 4));
  console.log(`[count_tokens] Estimated ${inputTokens} tokens locally (no upstream call)`);
  return res.json({ input_tokens: inputTokens });
});

router.post('/messages/batches', proxyRequest);
router.get('/messages/batches', proxyRequest);
router.get('/messages/batches/:id', proxyRequest);

// ── Models ────────────────────────────────────────────────────────────────────
router.get('/models', proxyRequest);
router.get('/models/:model', proxyRequest);

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
