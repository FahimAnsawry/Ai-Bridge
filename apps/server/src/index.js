const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load env variables early
require('./config/console-timestamp'); // Patch console.* with ISO timestamps
require('./config/db'); // Connect to MongoDB
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const _connectMongo = require('connect-mongo');
const MongoStore = _connectMongo.default || _connectMongo; // ESM/CJS interop
const { Server: SocketIOServer } = require('socket.io');
const { mongoose } = require('./config/db');

const { attachSocketIO, morganStream } = require('./middleware/logger');
const createDashboardRouter = require('./routes/dashboard');
const copilotRouter = require('./routes/copilot');
const v1Router = require('./routes/v1');
const { createProxyRuntime } = require('./services/proxy-runtime');
const passport = require('./config/passport');
const { requireAuth } = require('./middleware/auth-middleware');
const { loadGuestUser } = require('./config/guest-store');

function createWebServer(options = {}) {
  const runtime = options.runtime || createProxyRuntime({ 
    host: options.host || '127.0.0.1', 
    userId: options.userId || 'default' 
  });
  const app = express();
  const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
  const hasClientDist = fs.existsSync(path.join(clientDistPath, 'index.html'));
  const frontendUrl = options.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174';

  function frontendRedirect(pathname) {
    if (hasClientDist) return pathname;
    return new URL(pathname, frontendUrl).toString();
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-proxy';
  const useMongoSessionStore = mongoose.connection.readyState === 1;

  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version'],
    })
  );
  app.use(morgan('dev', { stream: morganStream }));

  app.use((req, res, next) => {
    if (req.url.startsWith('/v1/v1')) {
      req.url = req.url.replace('/v1/v1', '/v1');
    }
    next();
  });

  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    ...(useMongoSessionStore
      ? {
          store: MongoStore.create({
            mongoUrl: mongoUri,
            collectionName: 'sessions',
            ttl: 7 * 24 * 60 * 60, // 7 days
          }),
        }
      : {}),
    cookie: {
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    },
  }));

  if (!useMongoSessionStore) {
    console.warn('[session] Mongo session store unavailable, using in-memory sessions.');
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.get('/health', async (req, res) => {
    const state = await runtime.getState();
    res.json({
      ok: true,
      dashboardApi: true,
      proxy: {
        running: state.running,
        endpoint: state.endpoint,
        boundPort: state.boundPort,
        lastError: state.lastError || '',
      },
    });
  });

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
      res.redirect(frontendRedirect(`/dashboard?login=success${isNew ? '&first=true' : ''}`));
    }
  );

  app.get('/auth/guest', (req, res, next) => {
    req.login(loadGuestUser(), (error) => {
      if (error) return next(error);
      res.redirect(frontendRedirect('/dashboard?login=success&guest=true'));
    });
  });

  app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
      res.redirect(frontendRedirect('/?logout=success'));
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

  // OpenAI / Anthropic compatible proxy routes
  app.use('/v1', v1Router);

  if (hasClientDist) {
    app.use(express.static(clientDistPath));
    app.get('/{*path}', (req, res) => {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
    return { app, runtime };
  }

  app.get('/{*path}', (req, res) => {
    res.status(200).json({
      message: 'AI Proxy Server is running.',
      dashboard: options.dashboardUrl || 'http://localhost:5174',
    });
  });

  return { app, runtime };
}

async function startStandaloneServer() {
  const { mongoose, User } = require('./config/db');

  const bindHost = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);

  // Wait for MongoDB to connect if it's not ready yet
  if (mongoose.connection.readyState !== 1) {
    try {
      await new Promise((resolve, reject) => {
        if (mongoose.connection.readyState === 1) return resolve();
        mongoose.connection.once('connected', resolve);
        mongoose.connection.once('error', reject);
        setTimeout(() => reject(new Error('MongoDB connection timeout')), 5000);
      });
    } catch (e) {
      console.warn('[server] Could not wait for MongoDB connection:', e.message);
    }
  }

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
    publicPort: port,
    userId,
    embedded: true,
  });
  const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
  const hasClientDist = fs.existsSync(path.join(clientDistPath, 'index.html'));
  const baseUrl = `http://${bindHost}:${port}`;
  const dashboardUrl = hasClientDist ? baseUrl : 'http://localhost:5174 (Vite dev server)';
  const { app } = createWebServer({
    runtime,
    dashboardUrl,
    frontendUrl: 'http://localhost:5174',
  });
  await runtime.start();

  const server = app.listen(port, bindHost, async () => {
    const state = await runtime.getState();
    const endpoint = state.endpoint || `http://${bindHost}:${port}/v1`;
    console.log('');
    console.log('AI Proxy Server - SwiftRouter');
    console.log(`Proxy:     ${endpoint}`);
    console.log(`API:       ${baseUrl}/api`);
    console.log(`Dashboard: ${dashboardUrl}`);
    console.log('');
  });

  const io = new SocketIOServer(server, {
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
    server.close(() => process.exit(0));
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
