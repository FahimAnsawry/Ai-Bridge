# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (server + client concurrently)
npm run dev

# Server only
npm start

# Client only (Vite dev server on port 5174)
npm run client

# Build client for production
npm run build
```

No test suite is configured.

## Architecture

This is a local AI proxy server with a React management dashboard. It sits between AI coding tools (Claude Code, Cline, Roo Code, Kilo Code) and upstream AI providers (SwiftRouter, Anthropic, OpenAI-compatible APIs, GitHub Copilot, NVIDIA NIM).

### Two-server setup

The app runs two HTTP servers from a single Node process:

- **Proxy server** (`port 3000`) — the AI proxy. AI tools point their API base URL here. Handles `/v1/*` and `/copilot/*`.
- **Web/API server** (`port 3001`) — serves the dashboard REST API (`/api/*`) and auth routes. The React client talks to this.

Both servers share a single `ProxyRuntime` instance (`apps/server/src/services/proxy-runtime.js`) that manages state and the proxy server lifecycle.

### Request flow

```
AI Tool → POST :3000/v1/messages
  → proxy.js: normalizeMessages() + normalizeTools()
  → model routing / mapping
  → token optimization (prune → summarize if over budget)
  → response cache check
  → upstream provider
  → AnthropicSSETranslator (if upstream is OpenAI-format)
  → streamed response back to AI tool
  → logged to MongoDB
```

### Key services

| File | Role |
|------|------|
| `apps/server/src/services/proxy.js` | Core proxy: message normalization, model routing, token optimization, response caching, rate-limit failover, provider auto-switch |
| `apps/server/src/services/proxy-runtime.js` | Proxy HTTP server lifecycle (start/stop/restart), SwiftRouter model sync on startup |
| `apps/server/src/services/admin-service.js` | Dashboard business logic: status, config CRUD, logs, model catalog, provider health |
| `apps/server/src/services/copilot-proxy.js` | Translates Anthropic format → GitHub Copilot API |
| `apps/server/src/services/copilot-auth.js` | GitHub Device Flow OAuth for Copilot token acquisition |
| `apps/server/src/services/swiftrouter-sync.js` | Syncs model catalog from SwiftRouter's `/models` endpoint |

### Protocol translation

`normalizeMessages()` in `proxy.js` runs a 4-phase pipeline on every request:
1. Format conversion (Anthropic ↔ OpenAI)
2. Turn merging (consecutive same-role messages)
3. System message hoisting
4. Gemini tool-call/response alignment

The `AnthropicSSETranslator` converts OpenAI-format SSE streams back to Anthropic SSE format for clients that expect it.

### Provider failover

On 429 (rate limit): rotates through API keys for the same provider. On model-unavailable errors (400/403/404/503): auto-switches to the next configured provider.

Requests must only be routed to the AI model selected by the client. For example, if Claude CLI selects `gpt-5.5`, the proxy request should go through `gpt-5.5` only, not a different fallback or substitute model unless the user explicitly configures that mapping.

### Auth

- **Dashboard**: Google OAuth via Passport.js + MongoDB session store
- **Proxy endpoints**: Bearer token / `x-api-key` header matched against `user.accessKey` in DB
- **No-DB fallback**: default key `local-my-secret-key` works as guest/admin

### Config

- **Multi-user mode**: per-user config in MongoDB `UserConfig` collection; `loadConfig(userId)` is called on every proxy request
- **Standalone mode**: `config.json` in repo root (auto-created)

### Environment variables

`MONGODB_URI`, `SESSION_SECRET`, `HOST`, `PORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NVIDIA_NIM_MAX_LOCAL_WAIT_MS`, `NVIDIA_NIM_SLOW_LOG_MS`

### Provider-specific quirks (in proxy.js)

- **NVIDIA NIM**: TCP warmup, `tool_choice` object→string normalization, content flattening
- **Gemini**: consecutive same-role message merging, strict tool-call/response parity
- **EcomAgent**: all Claude model variants remapped to `claude-opus-4.6`
- **Timy**: model ID normalization (dots vs hyphens)
- **GitHub Models**: `/inference` path prefix, special Accept headers
- **AgentRouter**: custom `originator`/`user-agent` headers

### Client

React + Vite app at `apps/client/`. Pages: `Overview`, `Settings`, `Logs`, `Models`, `SetupGuide`, `AdminDashboard`, `Login`. Communicates with the web server via REST (`http://localhost:3001/api/*`) and Socket.IO for real-time log streaming.
