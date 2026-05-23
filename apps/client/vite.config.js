import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3000'

const benignProxySocketErrors = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
]);

const isBenignProxyError = (err) => benignProxySocketErrors.has(err?.code);

const sendBackendUnavailable = (res, req, err) => {
  if (!res || res.headersSent || typeof res.end !== 'function') return;

  const requestPath = req?.url || '';
  const isHttpApiRequest =
    requestPath.startsWith('/health') ||
    requestPath.startsWith('/api') ||
    requestPath.startsWith('/auth') ||
    requestPath.startsWith('/copilot') ||
    requestPath.startsWith('/v1');

  if (!isHttpApiRequest) {
    res.statusCode = 502;
    res.end();
    return;
  }

  const code = err?.code || 'BACKEND_UNAVAILABLE';
  res.statusCode = 502;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    error: `Local backend API is not reachable at ${backendTarget}. Start the backend with npm run dev or npm run start.`,
    code,
  }));
};

const ignoreBenignProxyErrors = (proxy) => {
  if (!proxy || proxy.__aiBridgeProxyPatched) return;

  proxy.__aiBridgeProxyPatched = true;
  const originalOn = proxy.on.bind(proxy);

  proxy.on = (event, listener) => {
    if (event === 'error' && typeof listener === 'function') {
      return originalOn(event, (err, req, res) => {
        if (isBenignProxyError(err)) {
          sendBackendUnavailable(res, req, err);
          return;
        }

        listener(err, req, res);
      });
    }

    return originalOn(event, listener);
  };
};

const ignoreBenignSocketErrors = (socket) => {
  if (!socket || socket.__aiBridgeProxySocketPatched) return;

  socket.__aiBridgeProxySocketPatched = true;
  const originalOn = socket.on.bind(socket);

  socket.on = (event, listener) => {
    if (event === 'error' && typeof listener === 'function') {
      return originalOn(event, (err) => {
        if (isBenignProxyError(err)) return;
        listener(err);
      });
    }

    return originalOn(event, listener);
  };
};

const configureProxy = (proxy) => {
  ignoreBenignProxyErrors(proxy);
  proxy.on('error', (err, req, res) => {
    sendBackendUnavailable(res, req, err);
  });
};

const configureWebSocketProxy = (proxy) => {
  configureProxy(proxy);
  proxy.on('proxyReqWs', (proxyReq, req, socket) => {
    proxyReq.on('error', () => {});
    ignoreBenignSocketErrors(socket);
  });
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/health': {
        target: backendTarget,
        changeOrigin: true,
        configure: configureProxy,
      },
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        configure: configureProxy,
      },
      '/auth': {
        target: backendTarget,
        changeOrigin: true,
        configure: configureProxy,
      },
      '/copilot': {
        target: backendTarget,
        changeOrigin: true,
        configure: configureProxy,
      },
      '/v1': {
        target: backendTarget,
        changeOrigin: true,
        // Streaming/SSE responses must not time out at the proxy.
        proxyTimeout: 10 * 60 * 1000,
        timeout: 10 * 60 * 1000,
        configure: configureProxy,
      },
      '/socket.io': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
        configure: configureWebSocketProxy,
      },
    },
  },
})
