const path = require('path');

// Load env variables (local dev only — Vercel injects these natively)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

// Lazy singleton — created once per container lifetime
let appInstance = null;
let initError = null;

function getApp() {
  if (initError) throw initError;
  if (appInstance) return appInstance;

  try {
    const { createWebServer } = require('../apps/server/src/index');
    const { app } = createWebServer({ userId: 'default' });
    appInstance = app;
    return appInstance;
  } catch (err) {
    initError = err;
    throw err;
  }
}

// Vercel calls this as a serverless handler
module.exports = (req, res) => {
  try {
    getApp()(req, res);
  } catch (err) {
    console.error('[vercel] Fatal initialization error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Server failed to initialize',
        message: err.message,
      });
    }
  }
};
