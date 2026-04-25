# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This is a full-stack AI proxy + dashboard app:
- **Proxy runtime** accepts OpenAI/Anthropic-compatible traffic on `/v1/*`, rewrites/normalizes payloads, and forwards to configured upstream providers.
- **Dashboard/API server** provides authenticated management endpoints under `/api/*` and serves the React UI.
- **Frontend** is a Vite + React dashboard for status, settings, logs, models sync, and setup guidance.
- **Persistence** is MongoDB-backed (users, providers, user config, model catalogs), with degraded fallback behavior when DB is unavailable.

## Repository structure (high level)

- `apps/server/src/index.js` — server entrypoint; starts proxy runtime + web API/static host + Socket.IO.
- `apps/server/src/services/proxy-runtime.js` — lifecycle/state for proxy HTTP server (`start/stop/restart/getState/syncModels`).
- `apps/server/src/services/proxy.js` — core forwarding logic and message normalization for upstream compatibility.
- `apps/server/src/routes/v1.js` — `/v1` API surface (chat/messages/models/audio/images/etc), protected by local access key.
- `apps/server/src/routes/dashboard.js` — `/api` dashboard endpoints (status/config/logs/models/sync).
- `apps/server/src/config/config.js` — per-user config loading/saving and default values.
- `apps/server/src/services/swiftrouter-sync.js` — pulls `/models` from SwiftRouter and persists model catalogs/mappings.
- `apps/client/src` — React app (`App.jsx` routing, `api/index.js` central API client, page-level UI).
- `.github/workflows/ci.yml` — CI installs dependencies and builds client.

## Development commands

Run from repo root unless noted.

### Install
- `npm install`
- `npm install --prefix apps/client`

### Run locally
- `npm run dev`
  - Starts backend + frontend concurrently.
  - Backend stack:
    - Proxy endpoint on `http://127.0.0.1:3000/v1`
    - Dashboard/API server on `http://127.0.0.1:3002`
  - Frontend Vite dev server on `http://localhost:5174`

- Backend only:
  - `npm run start`

- Frontend only:
  - `npm run client`
  - or `npm run dev --prefix apps/client`

### Build
- `npm run build --prefix apps/client`

### Preview production client build
- `npm run preview --prefix apps/client`

### Tests / lint
- No lint script is defined in current `package.json` files.
- No working automated test script is defined at root (`npm test` intentionally exits with error).
- There is no configured single-test command in this repository yet.

## Runtime and routing model

1. `apps/server/src/index.js` boots `createProxyRuntime(...)` and starts a separate Express app for auth/dashboard/static serving.
2. Proxy runtime binds `/v1` on configurable port (default 3000) and enforces access-key auth (`requireAccessKey`).
3. Dashboard API binds on `port + 2` (default 3002), requires session auth (`requireAuth`), and serves `apps/client/dist` in non-dev contexts.
4. Vite dev server proxies `/api`, `/auth`, and `/socket.io` to `http://localhost:3002` (`apps/client/vite.config.js`).

## Authentication and access control

Two distinct auth paths are used:
- **Dashboard/UI path** (`/api/*`): Google OAuth session auth (`requireAuth`), with DB-down guest fallback.
- **Proxy path** (`/v1/*`): bridge/local API key auth (`requireAccessKey`) from `x-api-key`, `Authorization`, or query key.

The `/v1/messages/count_tokens` route is handled locally (not proxied upstream) to satisfy clients that call it preflight.

## Proxy behavior worth understanding before edits

`apps/server/src/services/proxy.js` performs substantial message transformation before upstream calls:
- Converts Anthropic-style content blocks/tool use/results to OpenAI-compatible message shapes.
- Normalizes assistant tool-calls/tool-response parity (including synthetic tool responses when needed).
- Preserves strict ordering constraints required by Gemini-like upstreams.

If editing tool-call, message role, or streaming behavior, verify end-to-end compatibility for both:
- `POST /v1/messages` (Anthropic-style clients), and
- `POST /v1/chat/completions` (OpenAI-style clients).

## Data/config model

Config is per-user and merged from multiple Mongo collections/documents:
- `User` (profile, role, legacy provider/config fields)
- `UserConfig` (routing, mapping, retries, cors, port)
- `Provider` (provider credentials/base URLs)
- `ModelCatalog` (synced models + offerings metadata)

Canonical config APIs:
- Load: `loadConfig(userId)` in `apps/server/src/config/config.js`
- Save: `saveConfig(userId, updates)` in same file

Model sync path:
- Triggered by `/api/models/sync` and runtime startup checks.
- Implemented in `apps/server/src/services/swiftrouter-sync.js`.

## Environment and operational notes

- `.env` is loaded from `apps/server/.env` via `dotenv` in `apps/server/src/index.js`.
- Example envs are documented in `.env.example` (HOST, PUBLIC_HOST, PORT, Google OAuth vars, session/admin vars).
- MongoDB is optional at process start: server remains up when DB is unavailable, with degraded/guest mode behavior in auth and logging paths.

## CI expectations

Current CI only validates install + client build:
- `npm ci`
- `npm ci --prefix apps/client`
- `npm run build --prefix apps/client`

No lint/test gates are currently configured in CI.
