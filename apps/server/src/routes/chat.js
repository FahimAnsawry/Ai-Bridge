/**
 * routes/chat.js — Dashboard chat thread persistence
 *
 *   GET    /api/chat/messages       — list current user's rolling thread
 *   POST   /api/chat/messages       — append { role, content, model? }
 *   DELETE /api/chat/messages       — clear the entire thread
 *   DELETE /api/chat/messages/:id   — delete one message (used by Regenerate)
 *
 * Streaming model calls are NOT handled here; the chat page calls /v1/chat/completions
 * directly using the user's accessKey, like every other proxy client.
 */

const express = require('express');
const ChatMessage = require('../models/chatMessage');
const { mongoose } = require('../config/db');

const MAX_CONTENT_CHARS = 200_000;

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function createChatRouter() {
  const router = express.Router();

  router.get('/messages', async (req, res) => {
    if (!isDbConnected()) return res.json([]);
    try {
      const messages = await ChatMessage.find({ userId: req.user._id })
        .sort({ createdAt: 1 })
        .lean();
      res.json(messages);
    } catch (error) {
      console.error('[chat] list failed:', error.message);
      res.status(500).json({ error: 'Failed to load chat messages.' });
    }
  });

  router.post('/messages', async (req, res) => {
    if (!isDbConnected()) {
      return res.status(503).json({ error: 'Database unavailable; chat history requires MongoDB.' });
    }
    const { role, content, model } = req.body || {};
    if (role !== 'user' && role !== 'assistant') {
      return res.status(400).json({ error: 'role must be "user" or "assistant".' });
    }
    if (typeof content !== 'string' || !content.length) {
      return res.status(400).json({ error: 'content is required.' });
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return res.status(413).json({ error: `content exceeds ${MAX_CONTENT_CHARS} characters.` });
    }
    try {
      const message = await ChatMessage.create({
        userId: req.user._id,
        role,
        content,
        model: typeof model === 'string' ? model : '',
      });
      res.json(message.toObject());
    } catch (error) {
      console.error('[chat] append failed:', error.message);
      res.status(500).json({ error: 'Failed to save chat message.' });
    }
  });

  router.delete('/messages', async (req, res) => {
    if (!isDbConnected()) return res.json({ deletedCount: 0 });
    try {
      const result = await ChatMessage.deleteMany({ userId: req.user._id });
      res.json({ deletedCount: result.deletedCount || 0 });
    } catch (error) {
      console.error('[chat] clear failed:', error.message);
      res.status(500).json({ error: 'Failed to clear chat history.' });
    }
  });

  router.delete('/messages/:id', async (req, res) => {
    if (!isDbConnected()) return res.json({ deletedCount: 0 });
    try {
      const result = await ChatMessage.deleteOne({
        _id: req.params.id,
        userId: req.user._id,
      });
      res.json({ deletedCount: result.deletedCount || 0 });
    } catch (error) {
      console.error('[chat] delete one failed:', error.message);
      res.status(500).json({ error: 'Failed to delete chat message.' });
    }
  });

  return router;
}

module.exports = createChatRouter;
