const express = require('express');
const Message = require('../models/Message');
const requireAuth = require('../middleware/auth');
const { answerAcademicQuery } = require('../services/aiService');
const { getUserChats, appendUserChat, clearUserChats } = require('../services/jsonStore');

const router = express.Router();

// GET /api/chat/history — Fetch authenticated user's persistent chat conversation from data/chats.json
router.get('/history', requireAuth, (req, res) => {
  try {
    const chats = getUserChats(req.userId);
    res.json(chats);
  } catch (err) {
    console.error('[Chat History Error]:', err);
    res.status(500).json({ message: 'Failed to retrieve chat history' });
  }
});

// DELETE /api/chat/history — Clear authenticated user's chat conversation
router.delete('/history', requireAuth, (req, res) => {
  try {
    clearUserChats(req.userId);
    res.json({ message: 'Chat history cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to clear chat history' });
  }
});

// POST /api/chat/ask — Ask Noteversity AI assistant (reads relevant PDFs + generates answer + persists in chats.json)
router.post('/ask', requireAuth, async (req, res) => {
  let clientAborted = false;
  req.on('close', () => {
    clientAborted = true;
  });

  try {
    const { message, question, subject } = req.body;
    const query = (question || message || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Please provide a question' });
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Record user message in chats.json
    const userMsg = {
      who: 'You',
      text: query,
      me: true,
      subject: subject || 'All',
      time: now,
      createdAt: new Date().toISOString(),
    };
    appendUserChat(req.userId, userMsg);

    // 2. Query AI with RAG
    const result = await answerAcademicQuery({
      question: query,
      subject: subject || 'All',
    });

    if (clientAborted) {
      console.log('[ChatBot] Request aborted by client. Skipping response delivery.');
      return;
    }

    // 3. Record AI message in chats.json
    const aiMsg = {
      who: 'Noteversity AI',
      text: result.reply,
      sources: result.sources || [],
      me: false,
      subject: subject || 'All',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString(),
    };
    appendUserChat(req.userId, aiMsg);

    res.json(result);
  } catch (err) {
    if (clientAborted) return;
    console.error('[ChatBot Error]:', err);
    res.status(500).json({
      message: err.message || 'Failed to generate answer from AI',
    });
  }
});

// GET /api/chat/:room — legacy subject rooms
router.get('/:room', requireAuth, async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .populate('sender', 'name')
      .sort({ createdAt: 1 })
      .limit(200);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load messages' });
  }
});

module.exports = router;
