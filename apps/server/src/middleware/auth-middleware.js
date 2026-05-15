const { mongoose, User } = require('../config/db');
const { loadGuestUser } = require('../config/guest-store');

const ACCESS_KEY_CACHE_TTL_MS = 10_000;
const accessKeyCache = new Map();

// Helper to check if DB is actually usable
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// Mock guest user for when DB is down
function getGuestUser() {
  return loadGuestUser();
}

function requireAuth(req, res, next) {
  // If DB is down, auto-login as guest
  if (!isDbConnected()) {
    req.user = getGuestUser();
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
  const sendAccessKeyError = (status, message) => {
    if (req.path.includes('/messages')) {
      return res.status(status).json({
        type: 'error',
        error: {
          type: status === 401 ? 'authentication_error' : 'api_error',
          message,
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }
    return res.status(status).json({ error: message });
  };
  
  if (!apiKey) {
    return sendAccessKeyError(401, 'API key is missing.');
  }

  // If DB is down, allow "local-my-secret-key" as guest
  if (!isDbConnected()) {
    if (apiKey === getGuestUser().accessKey) {
      req.user = getGuestUser();
      return next();
    }
    return sendAccessKeyError(401, 'Invalid API key (DB is down, use the guest key).');
  }

  const guestUser = getGuestUser();
  if (apiKey === guestUser.accessKey) {
    req.user = guestUser;
    req.__authCacheHit = false;
    req.__authTimingMs = Date.now() - authStart;
    return next();
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
    return sendAccessKeyError(401, 'Unauthorized: Invalid Bridge API key.');
  } catch (error) {
    console.error('API key validation error:', error);
    return sendAccessKeyError(500, 'Internal Server Error validating API key.');
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
