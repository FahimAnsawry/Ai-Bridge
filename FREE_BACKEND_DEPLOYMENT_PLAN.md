# Free Backend Deployment Plan

## Goal

Deploy the backend server for light private usage by 3-4 people without hitting Vercel's serverless payload limits. This project is an Express-based AI proxy that can receive large JSON requests and stream responses, so it should run on a long-lived web service or VM rather than a serverless function platform.

## Why Not Vercel

Vercel Functions are not a good fit for this backend. Large AI proxy requests can exceed Vercel's request/response payload limits, causing errors such as `request is too big` or `413 FUNCTION_PAYLOAD_TOO_LARGE`. The backend already supports larger JSON bodies in `apps/server/src/services/proxy-runtime.js`, but Vercel's platform limit is enforced before the app can handle the request.

## Recommended Option: Render Free

Render Free is the best first option for this use case.

- Officially supports free web services.
- Works well for small Node.js backends.
- Simpler than managing a VPS.
- Acceptable for 3-4 users if cold starts are tolerable.

The main tradeoff is that free services spin down after about 15 minutes of inactivity. The next request may take around a minute while the service starts again.

Use MongoDB Atlas free tier for persistent database storage.

### Render Settings

```text
Build command: npm install
Start command: npm start
Instance type: Free
Region: Choose the closest supported region
```

### Required Environment Variables

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=<platform-provided-port>
PUBLIC_HOST=<your-koyeb-domain>
MONGODB_URI=<mongodb-atlas-uri>
SESSION_SECRET=<long-random-secret>
ADMIN_EMAILS=<your-email>
```

Add these only if Google login is needed:

```text
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://<your-render-domain>/auth/google/callback
```

## Alternative Options

## Koyeb Free

Koyeb documentation still lists one free instance for web services, but if your account does not actually expose that option, do not build your deployment plan around it. If free instance selection is unavailable in the dashboard, treat Koyeb as paid for practical purposes and skip it.

## Oracle Cloud Always Free

Oracle Cloud Always Free is the strongest free option if a stable server is required. It provides real VM resources, so there is no serverless request-size issue. The tradeoff is more setup: Linux server management, firewall rules, Node.js installation, process management with `pm2`, and HTTPS using Nginx or Caddy.

## Cloudflare Tunnel

Cloudflare Tunnel is useful if the backend can run on a local machine that stays online. It avoids port forwarding and hides the public IP, but reliability depends on the local computer and internet connection.

## Repository-Specific Notes

The current standalone server starts the proxy runtime and dashboard/API listener separately. Many free platforms expose only one public port, so backend-only deployment is the safest first target. If the dashboard must be hosted on the same service, update the server so `/v1`, `/api`, auth routes, Socket.IO, and static dashboard assets all share the single platform-provided `PORT`.

## Deployment Checklist

1. Create a MongoDB Atlas free cluster.
2. Add the `MONGODB_URI` connection string to the host environment.
3. Deploy the repository to Render as a Node.js web service.
4. Set `HOST=0.0.0.0` and use the platform-provided `PORT`.
5. Configure provider API keys through the dashboard or environment.
6. Test `https://<domain>/v1/models` or a small chat completion request.
7. Test a larger request that previously failed on Vercel.

## Recommended Next Step

Deploy the backend to Render Free first. If cold starts or free-tier sleep behavior become a problem, move to Oracle Cloud Always Free for a more stable always-on setup.
