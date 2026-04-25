const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load env variables early
require('./config/db'); // Connect to MongoDB
const express = require('express');
const session = require('express-session');
const { Server: SocketIOServer } = require('socket.io');

const { loadConfig } = require('./config/config');
const { attachSocketIO, morganStream } = require('./middlewares/logger');
const createDashboardRouter = require('./routes/dashboard');
const { createProxyRuntime } = require('./services/proxy-runtime');
const passport = require('./config/passport');
const { requireAuth } = require('./middlewares/auth-middleware');

function createWebServer(options = {}) {
  const runtime = options.runtime || createProxyRuntime({ host: options.host || '127.0.0.1', userId: options.userId || 'default' });
  const app = express();

  // Session middleware
  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
  }));

  // Parse JSON bodies
  app.use(express.json());

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

  const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(CLIENT_DIST));

  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
      if (err) {
        const state = runtime.getState();
        res.status(200).json({
          message: 'AI Proxy Server is running.',
          v1Endpoint: state.endpoint,
          dashboard: options.dashboardUrl || 'Desktop renderer',
          configuredPort: config.port,
        });
      }
    });
  });

  return { app, runtime };
}

async function startStandaloneServer() {
  const { mongoose, User } = require('./config/db');

  const bindHost = process.env.HOST || '127.0.0.1';
  const publicHost = process.env.PUBLIC_HOST || bindHost;

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

  const runtime = createProxyRuntime({ host: bindHost, publicHost, userId });
  const { app } = createWebServer({ runtime, dashboardUrl: 'http://localhost:5174 (Vite dev server)' });
  await runtime.start();

  const port = Number(process.env.PORT || 3001);
  const webServer = app.listen(port + 1, bindHost, async () => {
    const state = await runtime.getState();
    const endpoint = state.endpoint || `http://${publicHost}:${port}/v1`;
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║        AI Proxy Server — SwiftRouter         ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Proxy  ▶  ${endpoint.padEnd(34)}║`);
    console.log(`║  API    ▶  http://${publicHost}:${port + 1}/api`.padEnd(47) + '║');
    console.log('║  Dashboard ▶  http://localhost:5174 (Vite)   ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });

  const io = new SocketIOServer(webServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });
  attachSocketIO(io);

  io.on('connection', (socket) => {
    console.log(`[socket.io] client connected   (${socket.id})`);
    socket.on('join', (userId) => {
      if (userId) {
        const room = `user_${userId}`;
        socket.join(room);
        console.log(`[socket.io] client ${socket.id} joined room ${room}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket.io] client disconnected (${socket.id})`);
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
