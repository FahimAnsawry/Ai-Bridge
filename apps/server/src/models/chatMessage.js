const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatThread', index: true },
  role: { type: String, enum: ['user', 'assistant', 'error'], required: true },
  content: { type: String, required: true },
  model: { type: String, default: '' },
  edited: { type: Boolean, default: false },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  createdAt: { type: Date, default: Date.now },
});

chatMessageSchema.index({ userId: 1, createdAt: 1 });
chatMessageSchema.index({ threadId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
