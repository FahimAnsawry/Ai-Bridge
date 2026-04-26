const mongoose = require('mongoose');

const userConfigSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  modelRouting: { type: String, default: 'fallback' },
  modelMapping: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  stubModels: [String],
  corsOrigins: [String],
  activeProviderId: String,
  requestMinimizationEnabled: { type: Boolean, default: true },
  chatMaxUpstreamAttempts: { type: Number, default: 4 },
  tokenOptimizationEnabled: { type: Boolean, default: false },
  promptBudgetTokens: { type: Number, default: 0 },
  tokenSummarizationEnabled: { type: Boolean, default: false },
  responseCacheEnabled: { type: Boolean, default: false },
  responseCacheTtlSeconds: { type: Number, default: 30 },
  port: Number
}, { timestamps: true });

const UserConfig = mongoose.model('UserConfig', userConfigSchema);
module.exports = UserConfig;
