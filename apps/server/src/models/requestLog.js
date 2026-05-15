const mongoose = require('mongoose');

const requestLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accessKey: String,
  timestamp: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 }, // TTL index
  method: String,
  path: String,
  model: String,
  status: Number,
  latencyMs: Number,
  promptTokens: Number,
  completionTokens: Number,
  totalTokens: Number,
  tokenUsageEstimated: Boolean,
  streaming: Boolean,
  provider: String,
  optimization: {
    enabled: Boolean,
    promptBudget: Number,
    promptTokensBefore: Number,
    promptTokensAfter: Number,
    pruned: Boolean,
    prunedCount: Number,
    summarized: Boolean,
    cacheEligible: Boolean,
    cacheHit: Boolean,
  },
  error: String
});

requestLogSchema.index({ userId: 1, timestamp: -1 });
requestLogSchema.index({ timestamp: -1 });
requestLogSchema.index({ userId: 1, status: 1 });

const RequestLog = mongoose.model('RequestLog', requestLogSchema);

let indexBuildPromise = null;

function createIndexesWhenConnected() {
  if (indexBuildPromise) return indexBuildPromise;

  indexBuildPromise = RequestLog.createIndexes().catch(err => {
    indexBuildPromise = null;
    console.error('[RequestLog] Failed to create indexes:', err.message);
  });

  return indexBuildPromise;
}

if (mongoose.connection.readyState === 1) {
  createIndexesWhenConnected();
} else {
  mongoose.connection.once('connected', createIndexesWhenConnected);
}

module.exports = RequestLog;
