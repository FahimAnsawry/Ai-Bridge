const mongoose = require('mongoose');

const chatThreadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
  name: { type: String, default: '', index: true },
  model: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

chatThreadSchema.index({ userId: 1, updatedAt: -1 });

// Auto-update updatedAt on save
chatThreadSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ChatThread', chatThreadSchema);
