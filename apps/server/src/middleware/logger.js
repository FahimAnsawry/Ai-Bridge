/**
 * logger.js — Request / Response Logger (MongoDB + in-memory fallback)
 */

const { EventEmitter } = require('events');
const { mongoose, RequestLog } = require('../config/db');

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

let _io = null; // Socket.io server instance
const logEvents = new EventEmitter();

// In-memory stats for when DB logging is disabled
const memoryStats = new Map(); // userId -> { totalRequests, totalTokens, errors, sumLatency }
const memoryLogs = new Map();  // userId -> [log1, log2, ...]

function getLocalDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return getLocalDayKey(new Date());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getInitialMemoryStats() {
  return {
    totalRequests: 0,
    totalTokens: 0,
    todayKey: getLocalDayKey(),
    todayRequests: 0,
    todayTokens: 0,
    errors: 0,
    sumLatency: 0,
    optimizationRequests: 0,
    summarizedRequests: 0,
    cacheEligible: 0,
    cacheHits: 0,
    promptTokensBefore: 0,
    promptTokensAfter: 0,
    tokensSavedByPrune: 0,
    tokensSavedBySummary: 0,
  };
}

function ensureStatsForDay(stats, date = new Date()) {
  const todayKey = getLocalDayKey(date);
  if (stats.todayKey !== todayKey) {
    stats.todayKey = todayKey;
    stats.todayRequests = 0;
    stats.todayTokens = 0;
  }
  return stats;
}

function getLogTokenTotal(entry = {}) {
  const explicitTotal = Number(entry.totalTokens);
  if (Number.isFinite(explicitTotal) && explicitTotal >= 0) return explicitTotal;

  const promptTokens = Number(entry.promptTokens);
  const completionTokens = Number(entry.completionTokens);
  return (Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0)
    + (Number.isFinite(completionTokens) && completionTokens >= 0 ? completionTokens : 0);
}

/** Attach the Socket.io instance so we can emit events. */
function attachSocketIO(io) {
  _io = io;
}

/**
 * Add a new log entry to MongoDB.
 * @param {object} entry - The log details
 * @param {string} userId - The user ID from req.user._id
 * @param {string} accessKey - The user's accessKey used
 */
async function addLog(entry, userId, accessKey) {
  if (!userId) {
    console.warn('[logger] Missing userId for log entry:', entry);
    return null;
  }

  // Create a record object
  const record = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    accessKey,
    ...entry,
    timestamp: new Date()
  };

  const plainRecord = {
    ...record,
    id: record._id.toString(),
  };

  // Persist to MongoDB when connected
  if (isDbConnected()) {
    try {
      const doc = new RequestLog(record);
      await doc.save();
    } catch (err) {
      console.error('[logger] Failed to persist log to DB:', err.message);
    }
  }

  // Update in-memory stats
  const uIdStr = userId.toString();
  if (!memoryStats.has(uIdStr)) memoryStats.set(uIdStr, getInitialMemoryStats());
  const stats = ensureStatsForDay(memoryStats.get(uIdStr), record.timestamp);
  const tokenTotal = getLogTokenTotal(entry);
  stats.totalRequests++;
  stats.totalTokens += tokenTotal;
  stats.todayRequests++;
  stats.todayTokens += tokenTotal;
  if (entry.status >= 400) stats.errors++;
  stats.sumLatency += (entry.latencyMs || 0);

  const optimization = entry.optimization || {};
  if (optimization.enabled) stats.optimizationRequests++;
  if (optimization.summarized) stats.summarizedRequests++;
  if (optimization.cacheEligible) stats.cacheEligible++;
  if (optimization.cacheHit) stats.cacheHits++;
  if (Number.isFinite(optimization.promptTokensBefore)) {
    stats.promptTokensBefore += optimization.promptTokensBefore;
  }
  if (Number.isFinite(optimization.promptTokensAfter)) {
    stats.promptTokensAfter += optimization.promptTokensAfter;
  } else if (Number.isFinite(optimization.promptTokensBefore)) {
    stats.promptTokensAfter += optimization.promptTokensBefore;
  }
  if (Number.isFinite(optimization.tokensSavedByPrune)) {
    stats.tokensSavedByPrune += optimization.tokensSavedByPrune;
  }
  if (Number.isFinite(optimization.tokensSavedBySummary)) {
    stats.tokensSavedBySummary += optimization.tokensSavedBySummary;
  }

  // Update in-memory logs (keep last 1000)
  if (!memoryLogs.has(uIdStr)) memoryLogs.set(uIdStr, []);
  const userLogs = memoryLogs.get(uIdStr);
  userLogs.unshift(plainRecord);
  if (userLogs.length > 1000) userLogs.pop();

  // Broadcast to dashboard clients via Socket.IO
  if (_io) {
    _io.to(`user_${uIdStr}`).emit('new_log', plainRecord);
    _io.to('admin_room').emit('new_log', plainRecord);
    // No-DB guest mode: also broadcast globally so dashboard always sees logs
    if (uIdStr === '000000000000000000000000') {
      _io.emit('new_log', plainRecord);
    }
  }

  // Brodcast to local event listeners
  logEvents.emit('new_log', plainRecord);

  return plainRecord;
}

/**
 * Get logs for a user. Queries MongoDB when connected, falls back to memory.
 */
async function getLogs(userId, options = {}) {
  if (!userId) return { logs: [], total: 0 };

  const parsedLimit = Number(options.limit || 50);
  const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 50, 1000);
  const projection = [
    'timestamp',
    'method',
    'path',
    'model',
    'provider',
    'status',
    'latencyMs',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'tokenUsageEstimated',
    'streaming',
    'error',
  ].join(' ');

  if (isDbConnected()) {
    try {
      const query = { userId };
      const logs = await RequestLog.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .select(projection)
        .lean();
      return {
        logs: logs.map(l => ({ ...l, id: l._id.toString() })),
        total: logs.length,
      };
    } catch (err) {
      console.error('[logger] Failed to fetch logs from DB:', err.message);
    }
  }

  // Fallback to in-memory
  const uIdStr = userId.toString();
  const logs = memoryLogs.get(uIdStr) || [];
  return {
    logs: [...logs].slice(0, limit),
    total: logs.length,
  };
}

/** Clear all logs for a specific user. */
async function clearLogs(userId) {
  if (!userId) return;

  if (isDbConnected()) {
    try {
      await RequestLog.deleteMany({ userId });
    } catch (err) {
      console.error('[logger] Failed to clear logs from DB:', err.message);
    }
  }

  // Always clear memory too
  if (memoryLogs.has(userId.toString())) memoryLogs.delete(userId.toString());
  if (memoryStats.has(userId.toString())) memoryStats.delete(userId.toString());

  if (_io) {
    _io.to(`user_${userId.toString()}`).emit('logs_cleared');
    _io.to('admin_room').emit('logs_cleared');
  }
  logEvents.emit('logs_cleared', { userId });
}

/** Get model distribution for today's requests. Aggregates by model with no limit. */
async function getModelDistribution(userId) {
  if (!userId) return [];

  if (isDbConnected()) {
    try {
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const pipeline = [
        {
          $match: {
            userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
            timestamp: { $gte: todayStart },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$model', 'Unknown'] },
            requests: { $sum: 1 },
          },
        },
        { $sort: { requests: -1 } },
      ];
      const rows = await RequestLog.aggregate(pipeline);
      return rows.map(r => ({ name: r._id, requests: r.requests }));
    } catch (err) {
      console.error('[logger] Failed to aggregate model distribution from DB:', err.message);
    }
  }

  // In-memory fallback
  const uIdStr = userId.toString();
  const logs = memoryLogs.get(uIdStr) || [];
  const todayKey = getLocalDayKey();
  const modelMap = {};
  for (const log of logs) {
    if (getLocalDayKey(log.timestamp) === todayKey) {
      const m = log.model || 'Unknown';
      modelMap[m] = (modelMap[m] || 0) + 1;
    }
  }
  return Object.entries(modelMap)
    .map(([name, requests]) => ({ name, requests }))
    .sort((a, b) => b.requests - a.requests);
}

/** Get aggregated stats for a user. Queries MongoDB when connected, falls back to memory. */
async function getStats(userId) {
  if (isDbConnected()) {
    try {
      const match = userId ? { userId: new mongoose.Types.ObjectId(userId) } : {};
      const pipeline = [
        { $match: match },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
            errors: { $sum: { $cond: [{ $gte: ['$status', 400] }, 1, 0] } },
            sumLatency: { $sum: { $ifNull: ['$latencyMs', 0] } },
            optimizationRequests: { $sum: { $cond: ['$optimization.enabled', 1, 0] } },
            summarizedRequests: { $sum: { $cond: ['$optimization.summarized', 1, 0] } },
            cacheEligible: { $sum: { $cond: ['$optimization.cacheEligible', 1, 0] } },
            cacheHits: { $sum: { $cond: ['$optimization.cacheHit', 1, 0] } },
            promptTokensBefore: { $sum: { $ifNull: ['$optimization.promptTokensBefore', 0] } },
            promptTokensAfter: { $sum: { $ifNull: ['$optimization.promptTokensAfter', 0] } },
            tokensSavedByPrune: { $sum: { $ifNull: ['$optimization.tokensSavedByPrune', 0] } },
            tokensSavedBySummary: { $sum: { $ifNull: ['$optimization.tokensSavedBySummary', 0] } },
          },
        },
      ];

      // Today's stats: match documents from midnight today UTC
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const todayPipeline = [
        { $match: { ...match, timestamp: { $gte: todayStart } } },
        {
          $group: {
            _id: null,
            todayRequests: { $sum: 1 },
            todayTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
          },
        },
      ];

      const [aggResult, todayResult] = await Promise.all([
        RequestLog.aggregate(pipeline),
        RequestLog.aggregate(todayPipeline),
      ]);

      const agg = aggResult[0] || {};
      const today = todayResult[0] || {};

      const promptTokensBefore = agg.promptTokensBefore || 0;
      const promptTokensAfter = agg.promptTokensAfter || 0;
      const tokenSavings = Math.max(0, promptTokensBefore - promptTokensAfter);
      const cacheHitRate = (agg.cacheEligible || 0) > 0
        ? Math.round(((agg.cacheHits || 0) / agg.cacheEligible) * 100)
        : 0;

      return {
        totalRequests: agg.totalRequests || 0,
        avgLatency: agg.totalRequests > 0 ? Math.round(agg.sumLatency / agg.totalRequests) : 0,
        totalTokens: agg.totalTokens || 0,
        todayRequests: today.todayRequests || 0,
        todayTokens: today.todayTokens || 0,
        errors: agg.errors || 0,
        optimizationRequests: agg.optimizationRequests || 0,
        summarizedRequests: agg.summarizedRequests || 0,
        cacheEligible: agg.cacheEligible || 0,
        cacheHits: agg.cacheHits || 0,
        cacheHitRate,
        promptTokensBefore,
        promptTokensAfter,
        tokensSavedByPrune: agg.tokensSavedByPrune || 0,
        tokensSavedBySummary: agg.tokensSavedBySummary || 0,
        estimatedTokenSavings: tokenSavings,
      };
    } catch (err) {
      console.error('[logger] Failed to aggregate stats from DB:', err.message);
    }
  }

  // Fallback to in-memory stats
  if (!userId) {
    // Return aggregated global stats from memory
    const global = getInitialMemoryStats();
    for (const stats of memoryStats.values()) {
      const currentStats = ensureStatsForDay(stats);
      global.totalRequests += currentStats.totalRequests;
      global.totalTokens += currentStats.totalTokens;
      global.todayRequests += currentStats.todayRequests;
      global.todayTokens += currentStats.todayTokens;
      global.errors += currentStats.errors;
      global.sumLatency += currentStats.sumLatency;
      global.optimizationRequests += currentStats.optimizationRequests;
      global.summarizedRequests += currentStats.summarizedRequests;
      global.cacheEligible += currentStats.cacheEligible;
      global.cacheHits += currentStats.cacheHits;
      global.promptTokensBefore += currentStats.promptTokensBefore;
      global.promptTokensAfter += currentStats.promptTokensAfter;
      global.tokensSavedByPrune += currentStats.tokensSavedByPrune;
      global.tokensSavedBySummary += currentStats.tokensSavedBySummary;
    }
    const tokenSavings = Math.max(0, global.promptTokensBefore - global.promptTokensAfter);
    const cacheHitRate = global.cacheEligible > 0 ? Math.round((global.cacheHits / global.cacheEligible) * 100) : 0;

    return {
      totalRequests: global.totalRequests,
      avgLatency: global.totalRequests > 0 ? Math.round(global.sumLatency / global.totalRequests) : 0,
      totalTokens: global.totalTokens,
      todayRequests: global.todayRequests,
      todayTokens: global.todayTokens,
      errors: global.errors,
      optimizationRequests: global.optimizationRequests,
      summarizedRequests: global.summarizedRequests,
      cacheEligible: global.cacheEligible,
      cacheHits: global.cacheHits,
      cacheHitRate,
      promptTokensBefore: global.promptTokensBefore,
      promptTokensAfter: global.promptTokensAfter,
      tokensSavedByPrune: global.tokensSavedByPrune,
      tokensSavedBySummary: global.tokensSavedBySummary,
      estimatedTokenSavings: tokenSavings,
    };
  }

  const uIdStr = userId.toString();
  const stats = ensureStatsForDay(memoryStats.get(uIdStr) || getInitialMemoryStats());

  const tokenSavings = Math.max(0, stats.promptTokensBefore - stats.promptTokensAfter);
  const cacheHitRate = stats.cacheEligible > 0 ? Math.round((stats.cacheHits / stats.cacheEligible) * 100) : 0;

  return {
    totalRequests: stats.totalRequests,
    avgLatency: stats.totalRequests > 0 ? Math.round(stats.sumLatency / stats.totalRequests) : 0,
    totalTokens: stats.totalTokens,
    todayRequests: stats.todayRequests,
    todayTokens: stats.todayTokens,
    errors: stats.errors,
    optimizationRequests: stats.optimizationRequests,
    summarizedRequests: stats.summarizedRequests,
    cacheEligible: stats.cacheEligible,
    cacheHits: stats.cacheHits,
    cacheHitRate,
    promptTokensBefore: stats.promptTokensBefore,
    promptTokensAfter: stats.promptTokensAfter,
    tokensSavedByPrune: stats.tokensSavedByPrune,
    tokensSavedBySummary: stats.tokensSavedBySummary,
    estimatedTokenSavings: tokenSavings,
  };
}

async function getLatestLog(userId) {
  const uIdStr = userId?.toString();
  if (!uIdStr) return null;

  if (isDbConnected()) {
    try {
      const doc = await RequestLog.findOne({ userId }).sort({ timestamp: -1 }).lean();
      if (doc) return { ...doc, id: doc._id.toString() };
    } catch (err) {
      console.error('[logger] Failed to fetch latest log from DB:', err.message);
    }
  }

  const logs = memoryLogs.get(uIdStr) || [];
  return logs[0] || null;
}

function subscribe(listener) {
  const onNewLog = (entry) => listener({ type: 'new_log', entry });
  const onLogsCleared = (data) => listener({ type: 'logs_cleared', ...data });

  logEvents.on('new_log', onNewLog);
  logEvents.on('logs_cleared', onLogsCleared);

  return () => {
    logEvents.off('new_log', onNewLog);
    logEvents.off('logs_cleared', onLogsCleared);
  };
}

/** Simple Morgan-compatible stream adapter for HTTP access logs. */
const morganStream = {
  write(message) {
    // Morgan lines end with \n — strip it
    // console.log('[HTTP]', message.trimEnd());
  },
};

module.exports = {
  attachSocketIO,
  addLog,
  getLogs,
  getLatestLog,
  clearLogs,
  getStats,
  getModelDistribution,
  subscribe,
  morganStream,
};
