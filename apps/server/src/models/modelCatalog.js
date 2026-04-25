const mongoose = require('mongoose');

const modelCatalogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: String, required: true },
  models: mongoose.Schema.Types.Mixed,
  categories: mongoose.Schema.Types.Mixed,
  lastSyncedAt: Date,
  warnings: [String]
}, { timestamps: true });

modelCatalogSchema.index({ userId: 1, providerId: 1 }, { unique: true });

const ModelCatalog = mongoose.model('ModelCatalog', modelCatalogSchema);
module.exports = ModelCatalog;
