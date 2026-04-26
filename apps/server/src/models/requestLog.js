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

const RequestLog = mongoose.model('RequestLog', requestLogSchema);
module.exports = RequestLog;
