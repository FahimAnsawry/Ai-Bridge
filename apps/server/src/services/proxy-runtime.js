const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const { EventEmitter } = require('events');

const { loadConfig } = require('../config/config');
const { morganStream } = require('../middlewares/logger');
const v1Router = require('../routes/v1');
const copilotRouter = require('../routes/copilot');
const { syncSwiftRouterModels } = require('./swiftrouter-sync');

function createProxyRuntime(options = {}) {
  const userId = options.userId; // user context is now required
  const host = options.host || '127.0.0.1';
  const publicHost = options.publicHost || host;
  const publicPort = Number(options.publicPort || 3000);
  const publicBaseUrl = options.publicBaseUrl || '';
  const embedded = options.embedded === true;
  const emitter = new EventEmitter();

  let app = null;
  let httpServer = null;
  let startedAt = null;
  let boundPort = null;
  let lastError = '';
  let lastSync = null;

  async function buildServer() {
    const serverApp = express();
    const server = http.createServer(serverApp);
    const config = await loadConfig(userId);

    serverApp.use((req, res, next) => {
      if (req.url.startsWith('/v1/v1')) {
        req.url = req.url.replace('/v1/v1', '/v1');
      }
      next();
    });

    serverApp.use(
      cors({
        origin: config.cors_origins?.includes('*') ? '*' : config.cors_origins,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version'],
      })
    );

    serverApp.use(express.json({ limit: '50mb' }));
    serverApp.use(express.urlencoded({ extended: true, limit: '50mb' }));
    serverApp.use(morgan('dev', { stream: morganStream }));
    serverApp.use('/v1', v1Router);
    serverApp.use('/copilot', copilotRouter);

    return { serverApp, server };
  }

  async function getState() {
    if (!userId) {
      return {
        running: false,
        host, publicHost,
        configuredPort: 3000,
        boundPort: null,
        endpoint: '',
        restartRequired: false,
        startedAt: null,
        lastError: 'Missing userId',
        lastSync: null
      };
    }
    const config = await loadConfig(userId);
    const configuredPort = Number(config.port || 3000);
    const activePort = embedded ? publicPort : (boundPort || configuredPort);
    const endpoint = publicBaseUrl
      ? `${publicBaseUrl.replace(/\/$/, '')}/v1`
      : `http://${publicHost}:${activePort}/v1`;

    return {
      running: embedded ? Boolean(startedAt) : Boolean(httpServer && startedAt),
      host,
      publicHost,
      configuredPort,
      boundPort,
      endpoint,
      restartRequired: Boolean(startedAt && boundPort && configuredPort !== boundPort),
      startedAt,
      lastError,
      lastSync,
    };
  }

  async function emitState() {
    const state = await getState();
    emitter.emit('state', state);
  }

  async function runStartupSync() {
    if (!userId || userId === 'default') return null;
    const latestConfig = await loadConfig(userId);
    const hasSwiftRouterKey = Array.isArray(latestConfig.providers)
      && latestConfig.providers.some((provider) => provider.id === 'swiftrouter' && provider.apiKey);

    if (!hasSwiftRouterKey) {
      lastSync = {
        success: false,
        skipped: true,
        at: new Date().toISOString(),
        message: 'Startup sync skipped: SwiftRouter provider/API key not configured.',
      };
      await emitState();
      return lastSync;
    }

    return syncModels({ persist: true, notify: false });
  }

  async function start() {
    if (httpServer) return getState();
    if (!userId) throw new Error('Cannot start proxy runtime without a userId');

    if (embedded) {
      startedAt = Date.now();
      boundPort = publicPort;
      lastError = '';
      await emitState();
      runStartupSync().catch((error) => {
        lastError = error.message;
        emitState().catch(console.error);
      });
      return getState();
    }

    const runtimeParts = await buildServer();
    app = runtimeParts.serverApp;
    httpServer = runtimeParts.server;

    const config = await loadConfig(userId);
    const port = Number(config.port || 3000);

    await new Promise((resolve, reject) => {
      let settled = false;

      httpServer.once('error', (error) => {
        lastError = error.message;
        app = null;
        httpServer = null;
        startedAt = null;
        boundPort = null;
        emitState().catch(console.error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      httpServer.listen(port, host, () => {
        if (settled) return;
        settled = true;
        startedAt = Date.now();
        boundPort = port;
        lastError = '';
        emitState().catch(console.error);
        resolve();
      });
    });

    httpServer.on('close', () => {
      app = null;
      httpServer = null;
      startedAt = null;
      boundPort = null;
      emitState().catch(console.error);
    });

    runStartupSync().catch((error) => {
      lastError = error.message;
      emitState().catch(console.error);
    });

    return getState();
  }

  async function stop() {
    if (embedded) {
      startedAt = null;
      boundPort = null;
      await emitState();
      return getState();
    }

    if (!httpServer) return getState();

    const server = httpServer;
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    return getState();
  }

  async function restart() {
    if (httpServer) {
      await stop();
    }
    return start();
  }

  async function syncModels(options = {}) {
    const targetUserId = options.userId || userId;
    if (!targetUserId || targetUserId === 'default') throw new Error('Cannot sync models without a real userId (DB not connected)');
    try {
      const result = await syncSwiftRouterModels(targetUserId, { persist: options.persist !== false });
      lastSync = {
        success: true,
        at: new Date().toISOString(),
        message: `Synced ${result.syncedModels} models from SwiftRouter.`,
      };
      await emitState();
      return result;
    } catch (error) {
      lastSync = {
        success: false,
        at: new Date().toISOString(),
        message: error.message,
      };
      lastError = error.message;
      await emitState();
      throw error;
    }
  }

  function onState(listener) {
    emitter.on('state', listener);
    return () => emitter.off('state', listener);
  }

  return {
    start,
    stop,
    restart,
    syncModels,
    getState,
    onState,
  };
}

module.exports = {
  createProxyRuntime,
};
