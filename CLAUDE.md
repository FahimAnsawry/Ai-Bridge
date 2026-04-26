# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Big picture

This repository is a local AI proxy plus dashboard:
- The server accepts OpenAI- and Anthropic-style traffic on `/v1/*`, normalizes requests, and forwards them to upstream providers.
- The same Node process also serves authenticated dashboard/API routes on `/api/*` and Socket.IO events for live log updates.
- The client is a Vite + React dashboard for overview metrics, request logs, settings, and model synchronization.
- MongoDB stores users, providers, user config, request logs, and model catalog data, but the app keeps running in degraded mode if the database is unavailable.

## Core architecture

### Server startup and routing
- `apps/server/src/index.js` boots the proxy runtime, dashboard API, Socket.IO, and static serving.
- `apps/server/src/services/proxy-runtime.js` owns the proxy server lifecycle and model-sync triggers.
- `apps/server/src/routes/v1.js` exposes the proxy-facing API surface and enforces local access-key auth.
- `apps/server/src/routes/dashboard.js` exposes the authenticated dashboard API.
- `apps/server/src/middlewares/logger.js` records request activity used by the logs and overview pages.

### Proxy behavior
- `apps/server/src/services/proxy.js` does the heavy lifting for upstream compatibility.
- It normalizes message shapes, tool calls, tool results, and streaming behavior across OpenAI- and Anthropic-style clients.
- `POST /v1/messages` and `POST /v1/chat/completions` should both be treated as first-class entrypoints when changing request conversion logic.
- `POST /v1/messages/count_tokens` is handled locally.

### Configuration and persistence
- `apps/server/src/config/config.js` loads and saves the effective per-user config.
- `apps/server/src/config/db.js` wires MongoDB / Mongoose access.
- `apps/server/src/models/userConfig.js`, `apps/server/src/models/requestLog.js`, and related models define persisted state.
- `apps/server/src/services/swiftrouter-sync.js` fetches model catalogs from SwiftRouter and stores them for the dashboard and routing logic.

### Client structure
- `apps/client/src/App.jsx` is the top-level router/shell.
- `apps/client/src/api` is the shared client-side API layer.
- Page-level UI lives under `apps/client/src/pages`.
- Reusable dashboard and log components live under `apps/client/src/components`.
- Live log updates come from Socket.IO in the logs page.

## Authentication model

There are two separate auth paths:
- Dashboard/API requests under `/api/*` use session auth.
- Proxy requests under `/v1/*` use the local access key from `x-api-key`, `Authorization`, or a query key.

When editing auth or routing, keep the dashboard path and proxy path separate.

## Common commands

Run from the repo root unless noted.

### Install dependencies
- `npm install`
- `npm install --prefix apps/client`

### Start the app locally
- `npm run dev`
  - Runs the server and client concurrently.
- `npm run start`
  - Starts the Node server only.
- `npm run client`
  - Starts the Vite dev server only.
- `npm run dev --prefix apps/client`
  - Equivalent client-only dev server from the client package.

### Build the client
- `npm run build --prefix apps/client`

### Preview the client build
- `npm run preview --prefix apps/client`

### Tests and lint
- There is no root test script beyond the placeholder `npm test` stub.
- There is no lint script defined in either package.
- There is no single-test runner configured yet.
- The most relevant existing checks are:
  - `node quick-diagnose.js`
  - `node test-sse.js`

## Operational notes

- The backend listens on port `3000` for the proxy and `3002` for the dashboard/API in the current setup.
- The React dev server proxies `/api`, `/auth`, and `/socket.io` to the dashboard API during development.
- `.env` is loaded from `apps/server/.env`.
- Client logs and overview charts read from the request-log stream, so changes in logging shape can affect multiple screens.

## Files worth reading first for non-trivial changes

- `apps/server/src/index.js`
- `apps/server/src/services/proxy.js`
- `apps/server/src/routes/v1.js`
- `apps/server/src/routes/dashboard.js`
- `apps/server/src/config/config.js`
- `apps/client/src/pages/Overview.jsx`
- `apps/client/src/pages/Logs.jsx`
- `apps/client/src/components/common/LogTable.jsx`
- `apps/client/src/components/dashboard/UsageTrendChart.jsx`
- `apps/client/src/components/dashboard/ModelDistribution.jsx`
