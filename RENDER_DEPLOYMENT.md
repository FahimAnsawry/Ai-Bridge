# Render Deployment

## Service Type

Create a Render `Web Service` from the repository root. This repo now supports a single-port deployment mode for Render, so `/v1`, `/api`, auth routes, and the built dashboard can all run on the same public port.

## Build and Start Commands

```text
Build Command: npm install && npm run build
Start Command: npm start
```

`render.yaml` is included if you want to create the service from a Blueprint.

## Required Environment Variables

```text
NODE_ENV=production
HOST=0.0.0.0
SINGLE_PORT_MODE=true
MONGODB_URI=<your-mongodb-atlas-uri>
SESSION_SECRET=<long-random-secret>
ADMIN_EMAILS=<your-admin-email>
```

If Google login is enabled, also set:

```text
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://<your-render-domain>/auth/google/callback
```

Optionally set:

```text
PUBLIC_BASE_URL=https://<your-render-domain>
PUBLIC_HOST=<your-render-domain-without-https>
```

## What Changed For Render

The backend previously assumed two public ports: one for the proxy and one for the dashboard/API. Render exposes a single public `PORT`, so the server now has a single-port mode that mounts the proxy directly into the main Express app.

## Smoke Check

After deploy, verify:

1. `https://<your-render-domain>/auth/status`
2. `https://<your-render-domain>/api/status`
3. `https://<your-render-domain>/v1/models` with your bridge API key

If `/api/status` works but `/v1/models` fails, check your local bridge API key and provider configuration in MongoDB.
