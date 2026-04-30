/**
 * routes/dashboard.js — Dashboard REST API
 *
 * Provides endpoints consumed by the React dashboard:
 *   GET  /api/status           — Server health & uptime stats
 *   GET  /api/config           — Current config (key masked)
 *   POST /api/config           — Update config settings
 *   GET  /api/logs             — All stored request logs
 *   DELETE /api/logs           — Clear all logs
 *   GET  /api/models           — Fetch model list from upstream (cached 5 min)
 *   GET  /api/providers/health — Check health status of each configured provider
 */

const express = require('express');
const { createAdminService } = require('../services/admin-service');
const { requireAdmin } = require('../middlewares/auth-middleware');

const ALLOWED_CONFIG_FIELDS = [
  'aigcbest_api_key',
  'local_api_key',
  'provider_base_url',
  'active_provider_id',
  'providers',
  'replace_providers',
  'port',
  'cors_origins',
  'api_keys',
  'model_routing',
  'model_mapping',
  'custom_models',
  'stub_models',
  'request_minimization_enabled',
  'chat_max_upstream_attempts',
  'token_optimization_enabled',
  'prompt_budget_tokens',
  'token_summarization_enabled',
  'response_cache_enabled',
  'response_cache_ttl_seconds',
];

function createDashboardRouter(runtime) {
  const router = express.Router();
  const adminService = createAdminService(runtime);

  router.get('/status', async (req, res) => {
    try {
      res.json(await adminService.getStatus(req.user._id));
    } catch (error) {
      console.error('[status] Failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to get status.' });
    }
  });

  router.get('/config', async (req, res) => {
    try {
      res.json(await adminService.getConfig(req.user._id));
    } catch (error) {
      console.error('[config] Get failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to get configuration.' });
    }
  });

  router.post('/config', async (req, res) => {
    try {
      // console.log('[config] POST request body:', JSON.stringify(req.body, null, 2));

      const updates = {};
      for (const key of ALLOWED_CONFIG_FIELDS) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields provided.' });
      }

      const result = await adminService.saveConfig(req.user._id, updates);
      // console.log('[config] Save result:', result ? 'success' : 'failed/undefined');
      res.json(result);
    } catch (error) {
      console.error('[config] Save failed:', error.message);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to save configuration.',
      });
    }
  });

  router.get('/logs', async (req, res) => {
    try {
      res.json(await adminService.listLogs(req.user._id, req.query));
    } catch (error) {
      console.error('[logs] Get failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to retrieve logs.' });
    }
  });

  router.delete('/logs', async (req, res) => {
    try {
      res.json(await adminService.clearLogs(req.user._id));
    } catch (error) {
      console.error('[logs] Clear failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to clear logs.' });
    }
  });

  router.get('/models', async (req, res) => {
    try {
      res.json(await adminService.listModels(req.user._id));
    } catch (error) {
      console.error('[models] Get failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to retrieve models.' });
    }
  });

  router.get('/models/offerings', async (req, res) => {
    try {
      res.json(await adminService.getModelOfferings(req.user._id));
    } catch (error) {
      console.error('[offerings] Get failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to retrieve model offerings.' });
    }
  });

  router.post('/models/sync', async (req, res) => {
    try {
      res.json(await adminService.syncModels(req.user._id));
    } catch (error) {
      const status = error.status || (error.code === 'missing_api_key' ? 400 : 500);
      res.status(status).json({
        success: false,
        error: error.message || 'Model sync failed.',
        code: error.code || 'sync_failed',
      });
    }
  });

  // GET /api/providers/health — check health of all configured providers
  router.get('/providers/health', async (req, res) => {
    try {
      res.json(await adminService.checkProviderHealth(req.user._id));
    } catch (error) {
      console.error('[providers/health] Failed:', error.message);
      res.status(500).json({ error: error.message || 'Failed to check provider health.' });
    }
  });

  // --- Admin Routes Disabled ---
  /*
  router.use('/admin', requireAdmin);
  ...
  */

  router.post('/user/regenerate-key', async (req, res) => {
    try {
      const user = await User.findById(req.user._id);
      const newKey = user.generateAccessKey();
      await user.save();
      res.json({ accessKey: newKey });
    } catch (error) {
      console.error('[regenerate-key] Failed:', error.message);
      res.status(500).json({ error: 'Failed to regenerate key.' });
    }
  });

  return router;
}

module.exports = createDashboardRouter;
