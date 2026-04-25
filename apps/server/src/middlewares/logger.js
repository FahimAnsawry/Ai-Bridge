/**
 * logger.js — Request / Response Logger (MongoDB version)
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

function getInitialMemoryStats() {
  return { totalRequests: 0, totalTokens: 0, errors: 0, sumLatency: 0 };
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

  // Create a record object but don't save to DB
  const record = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    accessKey,
    ...entry,
    timestamp: new Date()
  };

  const plainRecord = record;

  // Update in-memory stats
  const uIdStr = userId.toString();
  if (!memoryStats.has(uIdStr)) memoryStats.set(uIdStr, getInitialMemoryStats());
  const stats = memoryStats.get(uIdStr);
  stats.totalRequests++;
  stats.totalTokens += (entry.promptTokens || 0) + (entry.completionTokens || 0);
  if (entry.status >= 400) stats.errors++;
  stats.sumLatency += (entry.latencyMs || 0);

  // Update in-memory logs (keep last 50)
  if (!memoryLogs.has(uIdStr)) memoryLogs.set(uIdStr, []);
  const userLogs = memoryLogs.get(uIdStr);
  userLogs.unshift(plainRecord);
  if (userLogs.length > 50) userLogs.pop();

  // Broadcast to dashboard clients via Socket.IO
  if (_io) {
    _io.to(`user_${uIdStr}`).emit('new_log', plainRecord);
    _io.to('admin_room').emit('new_log', plainRecord);
  }

  // Brodcast to local event listeners
  logEvents.emit('new_log', plainRecord);

  return plainRecord;
}

/** 
 * Get logs from memory for a user.
 */
async function getLogs(userId, options = {}) {
  if (!userId) return { logs: [], total: 0 };

  const uIdStr = userId.toString();
  const logs = memoryLogs.get(uIdStr) || [];

  return {
    logs: [...logs],
    total: logs.length
  };
}

/** Clear all logs for a specific user. */
async function clearLogs(userId) {
  if (!userId) return;
  if (!isDbConnected()) {
    if (_io) {
      _io.to(`user_${userId.toString()}`).emit('logs_cleared');
      _io.to('admin_room').emit('logs_cleared');
    }
    logEvents.emit('logs_cleared', { userId });
    return;
  }
  try {
    // We no longer save to DB, so we just clear memory and emit events
    if (memoryLogs.has(userId.toString())) memoryLogs.delete(userId.toString());
    if (memoryStats.has(userId.toString())) memoryStats.delete(userId.toString());

    if (_io) {
      _io.to(`user_${userId.toString()}`).emit('logs_cleared');
      _io.to('admin_room').emit('logs_cleared');
    }
    logEvents.emit('logs_cleared', { userId });
  } catch (error) {
    console.error('[logger] Failed to clear logs:', error.message);
  }
}

/** Get aggregated stats for a user. */
async function getStats(userId) {
  if (!userId) {
    // Return aggregated global stats from memory
    const global = getInitialMemoryStats();
    for (const stats of memoryStats.values()) {
      global.totalRequests += stats.totalRequests;
      global.totalTokens += stats.totalTokens;
      global.errors += stats.errors;
      global.sumLatency += stats.sumLatency;
    }
    return {
      totalRequests: global.totalRequests,
      avgLatency: global.totalRequests > 0 ? Math.round(global.sumLatency / global.totalRequests) : 0,
      totalTokens: global.totalTokens,
      errors: global.errors
    };
  }

  const uIdStr = userId.toString();
  const stats = memoryStats.get(uIdStr) || getInitialMemoryStats();

  return {
    totalRequests: stats.totalRequests,
    avgLatency: stats.totalRequests > 0 ? Math.round(stats.sumLatency / stats.totalRequests) : 0,
    totalTokens: stats.totalTokens,
    errors: stats.errors
  };
}

async function getLatestLog(userId) {
  const uIdStr = userId?.toString();
  if (!uIdStr) return null;
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
    console.log('[HTTP]', message.trimEnd());
  },
};

module.exports = {
  attachSocketIO,
  addLog,
  getLogs,
  getLatestLog,
  clearLogs,
  getStats,
  subscribe,
  morganStream,
};
