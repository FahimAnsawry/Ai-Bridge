const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  providerId: { type: String, required: true },
  baseUrl: String,
  apiKey: String,
  apiKeys: { type: [String], default: [] },
  copilotAuth: {
    githubAccessToken: String,
    copilotToken: String,
    copilotTokenExp: { type: Number, default: 0 },
    updatedAt: Date,
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

providerSchema.index({ userId: 1, providerId: 1 }, { unique: true });

const Provider = mongoose.model('Provider', providerSchema);
module.exports = Provider;
