const { mongoose, User } = require('../config/db');

const ACCESS_KEY_CACHE_TTL_MS = 10_000;
const accessKeyCache = new Map();

// Helper to check if DB is actually usable
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// Mock guest user for when DB is down
const MOCK_GUEST_USER = {
  _id: '000000000000000000000000',
  email: 'guest@local.host',
  role: 'admin',
  displayName: 'Guest (No DB Mode)',
  accessKey: 'local-my-secret-key'
};

function requireAuth(req, res, next) {
  // If DB is down, auto-login as guest
  if (!isDbConnected()) {
    req.user = MOCK_GUEST_USER;
    return next();
  }

  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  res.redirect('/auth/google');
}

async function requireAccessKey(req, res, next) {
  const authStart = Date.now();
  const apiKey = req.headers['x-api-key'] || req.query['key'] || (req.headers.authorization || '').replace('Bearer ', '');
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is missing.' });
  }

  // If DB is down, allow "local-my-secret-key" as guest
  if (!isDbConnected()) {
    if (apiKey === 'local-my-secret-key') {
      req.user = MOCK_GUEST_USER;
      return next();
    }
    return res.status(401).json({ error: 'Invalid API key (DB is down, use default key).' });
  }

  try {
    const cached = accessKeyCache.get(apiKey);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.user;
      req.__authCacheHit = true;
      req.__authTimingMs = Date.now() - authStart;
      return next();
    }

    const user = await User.findOne({ accessKey: apiKey })
      .select('_id email role displayName accessKey activeProviderId')
      .lean();
    
    if (user) {
      accessKeyCache.set(apiKey, {
        user,
        expiresAt: Date.now() + ACCESS_KEY_CACHE_TTL_MS,
      });
      req.user = user;
      req.__authCacheHit = false;
      req.__authTimingMs = Date.now() - authStart;
      return next();
    }
    
    // We should probably optimize this later if accessKey is not saved in clear text.
    return res.status(401).json({ error: 'Unauthorized: Invalid Bridge API key.' });
  } catch (error) {
    console.error('API key validation error:', error);
    return res.status(500).json({ error: 'Internal Server Error validating API key.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  next();
}

module.exports = {
  requireAuth,
  requireAccessKey,
  requireAdmin
};
