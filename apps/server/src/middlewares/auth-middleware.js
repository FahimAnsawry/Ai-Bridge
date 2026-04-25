const { mongoose, User } = require('../config/db');

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
    // Basic search on users might be expensive if we strictly use bcrypt.compare on all users.
    // For scale, we should extract the salt/id from the API key.
    // Given the previous user schema `accessKeyHash` exists, but there's no reverse index.
    // However, we added a `accessKey` (sparse unique) initially. But that's raw. 
    // We should probably rely on a bearer token standard or check all.
    // Wait, the plan says: `accessKey` (unique, sparse). We can search by `accessKeyHash` if it was deterministic, but bcrypt is not.
    // Actually, Phase 1 says "Index: accessKey (unique)". 
    // Wait, userSchema.generateAccessKey() sets `this.accessKey = key` and `this.accessKeyHash = bcrypt(key)`.
    // It's a plain text search. Let's find by accessKey or hash.

    // If accessKey is just stored in DB as cleartext too (as per Phase 1), we can find it:
    let user = await User.findOne({ accessKey: apiKey });
    
    // Fallback if we only store hash (in production you'd only store hash and ID in the key, e.g. "sk-<userId>-<random>")
    // If not found by accessKey, we'd have to find it another way, but for now:
    if (user) {
      req.user = user;
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
