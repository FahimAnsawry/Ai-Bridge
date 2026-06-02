/**
 * routes/chat.js — Dashboard chat thread persistence
 *
 *   Threads
 *   -------
 *   GET    /api/chat/threads          — list current user's threads
 *   POST   /api/chat/threads          — create a new thread
 *   PUT    /api/chat/threads/:id      — rename / change model
 *   DELETE /api/chat/threads/:id      — delete thread + all its messages
 *
 *   Messages
 *   --------
 *   GET    /api/chat/messages?threadId= — list messages for a thread
 *   POST   /api/chat/messages           — append { role, content, model?, threadId? }
 *   PATCH  /api/chat/messages/:id       — edit a user message (cascades delete of subsequent assistant msgs)
 *   DELETE /api/chat/messages           — clear the entire thread
 *   DELETE /api/chat/messages/:id       — delete one message (used by Regenerate)
 *
 *   Streaming model calls are NOT handled here; the chat page calls /v1/chat/completions
 *   directly using the user's accessKey, like every other proxy client.
 */

const express = require('express');
const ChatMessage = require('../models/chatMessage');
const ChatThread = require('../models/chatThread');
const { mongoose } = require('../config/db');

const MAX_CONTENT_CHARS = 200_000;

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function createChatRouter() {
  const router = express.Router();

  // ─── Threads ───────────────────────────────────────────────────────────

  router.get('/threads', async (req, res) => {
    if (!isDbConnected()) return res.json([]);
    try {
      const threads = await ChatThread.find({ userId: req.user._id })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();
      // Attach last message preview
      const result = [];
      for (const t of threads) {
        const last = await ChatMessage.findOne({
          threadId: t._id,
          role: 'assistant',
        }).sort({ createdAt: -1 }).limit(1).lean();
        result.push({
          _id: t._id,
          name: t.name,
          model: t.model,
          messageCount: (await ChatMessage.countDocuments({ threadId: t._id })),
          lastMessageAt: t.updatedAt,
          lastMessagePreview: last?.content?.slice(0, 80) || '',
        });
      }
      res.json(result);
    } catch (error) {
      console.error('[chat] threads list failed:', error.message);
      res.status(500).json({ error: 'Failed to load threads.' });
    }
  });

  router.post('/threads', async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database unavailable.' });
    const { name, model } = req.body || {};
    try {
      const thread = await ChatThread.create({
        userId: req.user._id,
        name: typeof name === 'string' && name.trim() ? name.trim() : '',
        model: typeof model === 'string' ? model : '',
      });
      res.json({ _id: thread._id, name: thread.name, model: thread.model, createdAt: thread.createdAt, updatedAt: thread.updatedAt });
    } catch (error) {
      console.error('[chat] create thread failed:', error.message);
      res.status(500).json({ error: 'Failed to create thread.' });
    }
  });

  router.put('/threads/:id', async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database unavailable.' });
    const { name, model } = req.body || {};
    try {
      const thread = await ChatThread.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id },
        {
          ...(name !== undefined && { name: typeof name === 'string' && name.trim() ? name.trim() : '' }),
          ...(model !== undefined && { model: typeof model === 'string' ? model : '' }),
        },
        { new: true }
      );
      if (!thread) return res.status(404).json({ error: 'Thread not found.' });
      res.json({ _id: thread._id, name: thread.name, model: thread.model, updatedAt: thread.updatedAt });
    } catch (error) {
      console.error('[chat] update thread failed:', error.message);
      res.status(500).json({ error: 'Failed to update thread.' });
    }
  });

  router.delete('/threads/:id', async (req, res) => {
    if (!isDbConnected()) return res.json({ deletedCount: 0 });
    try {
      // Delete all messages in this thread first
      await ChatMessage.deleteMany({ threadId: req.params.id, userId: req.user._id });
      const result = await ChatThread.deleteOne({ _id: req.params.id, userId: req.user._id });
      res.json({ deletedCount: result.deletedCount || 0 });
    } catch (error) {
      console.error('[chat] delete thread failed:', error.message);
      res.status(500).json({ error: 'Failed to delete thread.' });
    }
  });

  // ─── Messages ──────────────────────────────────────────────────────────

  router.get('/messages', async (req, res) => {
    if (!isDbConnected()) return res.json([]);
    try {
      const { threadId } = req.query || {};
      const filter = { userId: req.user._id };
      if (threadId) filter.threadId = threadId;
      const messages = await ChatMessage.find(filter)
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
    const { role, content, model, threadId } = req.body || {};
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
        threadId: threadId || null,
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

  /** PATCH /api/chat/messages/:id — edit a user message */
  router.patch('/messages/:id', async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database unavailable.' });
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.length) {
      return res.status(400).json({ error: 'content is required.' });
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return res.status(413).json({ error: `content exceeds ${MAX_CONTENT_CHARS} characters.` });
    }
    try {
      // Only user messages can be edited
      const msg = await ChatMessage.findOne({ _id: req.params.id, userId: req.user._id, role: 'user' });
      if (!msg) return res.status(404).json({ error: 'Message not found or not editable.' });

      msg.content = content;
      msg.edited = true;
      await msg.save();

      // Cascade: delete all assistant messages that came after this one
      await ChatMessage.deleteMany({
        threadId: msg.threadId,
        role: 'assistant',
        createdAt: { $gt: msg.createdAt },
      });

      res.json({ _id: msg._id, content: msg.content, edited: true, cascadedDelete: true });
    } catch (error) {
      console.error('[chat] edit message failed:', error.message);
      res.status(500).json({ error: 'Failed to edit message.' });
    }
  });

  router.delete('/messages', async (req, res) => {
    if (!isDbConnected()) return res.json({ deletedCount: 0 });
    const { threadId } = req.body || {};
    try {
      const filter = { userId: req.user._id };
      if (threadId) filter.threadId = threadId;
      const result = await ChatMessage.deleteMany(filter);
      res.json({ deletedCount: result.deletedCount || 0 });
    } catch (error) {
      console.error('[chat] clear failed:', error.message);
      res.status(500).json({ error: 'Failed to clear chat messages.' });
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
      res.status(500).json({ error: 'Failed to delete message.' });
    }
  });

  return router;
}

module.exports = createChatRouter;
