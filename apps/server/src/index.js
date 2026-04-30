const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load env variables early
require('./config/db'); // Connect to MongoDB
const express = require('express');
const session = require('express-session');
const _connectMongo = require('connect-mongo');
const MongoStore = _connectMongo.default || _connectMongo; // ESM/CJS interop
const { Server: SocketIOServer } = require('socket.io');

const { loadConfig } = require('./config/config');
const { attachSocketIO, morganStream } = require('./middlewares/logger');
const createDashboardRouter = require('./routes/dashboard');
const copilotRouter = require('./routes/copilot');
const { createProxyRuntime } = require('./services/proxy-runtime');
const passport = require('./config/passport');
const { requireAuth } = require('./middlewares/auth-middleware');

function envFlag(name) {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

function createWebServer(options = {}) {
  const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;
  const exposeV1 = options.exposeV1 === true || isVercel;
  const runtime = options.runtime || createProxyRuntime({ 
    host: options.host || '127.0.0.1', 
    userId: options.userId || 'default' 
  });
  const app = express();

  // Trust Vercel's reverse proxy so secure cookies work over HTTPS
  if (isVercel || process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-proxy';

  // Session middleware — use MongoStore so sessions survive Vercel cold starts
  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: mongoUri,
      collectionName: 'sessions',
      ttl: 7 * 24 * 60 * 60, // 7 days
    }),
    cookie: {
      secure: isProduction,      // HTTPS only in prod (works because trust proxy is set)
      sameSite: 'lax',           // 'lax' is fine for same-origin OAuth on Vercel
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    },
  }));

  // Match proxy runtime limits when /v1 is mounted directly in single-port deployments.
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Passport init
  app.use(passport.initialize());
  app.use(passport.session());

  // Auth routes
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function(req, res) {
      // Successful authentication, redirect dashboard.
      const isNew = req.user.isNewUser;
      res.redirect(`/dashboard?login=success${isNew ? '&first=true' : ''}`);
    }
  );

  app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
      res.redirect('/?logout=success');
    });
  });

  app.get('/auth/status', (req, res) => {
    if (req.isAuthenticated()) {
      res.json({ user: req.user });
    } else {
      res.json({ user: null });
    }
  });

  // Protected Dashboard API
  app.use('/api', requireAuth, createDashboardRouter(runtime));

  // GitHub Copilot Proxy — always mounted (auth handled internally)
  app.use('/copilot', copilotRouter);

  // Mount Proxy V1 directly for single-port deployments such as Vercel and Render.
  if (exposeV1) {
    const v1Router = require('./routes/v1');
    app.use('/v1', v1Router);
  }

  const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(CLIENT_DIST));

  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'), async (err) => {
      if (err) {
        const state = await runtime.getState().catch(() => ({
          endpoint: '',
          configuredPort: Number(process.env.PORT || 3000),
        }));
        res.status(200).json({
          message: 'AI Proxy Server is running.',
          v1Endpoint: state.endpoint,
          dashboard: options.dashboardUrl || 'Desktop renderer',
          configuredPort: state.configuredPort,
        });
      }
    });
  });

  return { app, runtime };
}

async function startStandaloneServer() {
  const { mongoose, User } = require('./config/db');

  const bindHost = process.env.HOST || '127.0.0.1';
  const isRender = envFlag('RENDER');
  const singlePortMode = isRender || envFlag('SINGLE_PORT_MODE');
  const port = Number(process.env.PORT || 3000);
  const publicHost = process.env.PUBLIC_HOST || process.env.RENDER_EXTERNAL_HOSTNAME || bindHost;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL
    || process.env.RENDER_EXTERNAL_URL
    || (singlePortMode && process.env.PUBLIC_HOST ? `https://${process.env.PUBLIC_HOST}` : '');

  // Try to get the first admin user — but don't block startup if DB isn't ready
  let userId = 'default';
  if (mongoose.connection.readyState === 1) {
    try {
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) userId = adminUser._id.toString();
    } catch (e) {
      console.warn('[server] Could not query admin user:', e.message);
    }
  } else {
    console.warn('[server] MongoDB not yet connected — starting with userId=default. Will sync when DB connects.');
  }

  const runtime = createProxyRuntime({
    host: bindHost,
    publicHost,
    publicPort: port,
    publicBaseUrl,
    userId,
    embedded: singlePortMode,
  });
  const dashboardUrl = singlePortMode
    ? (publicBaseUrl || `http://${publicHost}:${port}`)
    : 'http://localhost:5174 (Vite dev server)';
  const { app } = createWebServer({
    runtime,
    dashboardUrl,
    exposeV1: singlePortMode,
  });
  await runtime.start();

  const webPort = singlePortMode ? port : port + 1;
  const webServer = app.listen(webPort, bindHost, async () => {
    const state = await runtime.getState();
    const endpoint = state.endpoint || `http://${publicHost}:${port}/v1`;
    const apiBase = singlePortMode
      ? (publicBaseUrl || `http://${publicHost}:${webPort}`)
      : `http://${publicHost}:${webPort}`;
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║        AI Proxy Server — SwiftRouter         ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Proxy  ▶  ${endpoint.padEnd(34)}║`);
    console.log(`║  API    ▶  ${`${apiBase}/api`.padEnd(34)}║`);
    console.log(`║  Dashboard ▶  ${dashboardUrl.padEnd(29)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });

  const io = new SocketIOServer(webServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });
  attachSocketIO(io);

  io.on('connection', (socket) => {
    // console.log(`[socket.io] client connected   (${socket.id})`);
    socket.on('join', (userId) => {
      if (userId) {
        const room = `user_${userId}`;
        socket.join(room);
        // console.log(`[socket.io] client ${socket.id} joined room ${room}`);
      }
    });

    socket.on('disconnect', () => {
      // console.log(`[socket.io] client disconnected (${socket.id})`);
    });
  });

  const shutdown = async () => {
    await runtime.stop().catch(() => {});
    webServer.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  startStandaloneServer().catch((error) => {
    console.error('[server] Failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = {
  createWebServer,
  startStandaloneServer,
};
