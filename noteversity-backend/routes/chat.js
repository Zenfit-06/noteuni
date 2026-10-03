const express = require('express');
const requireAuth = require('../middleware/auth');
const { answerAcademicQuery, suggestFollowUps } = require('../services/aiService');
const { getUserChats, appendUserChat, clearUserChats } = require('../services/chatStore');

const router = express.Router();

// GET /api/chat/history — authenticated user's persistent chat conversation
router.get('/history', requireAuth, async (req, res) => {
  try {
    const chats = await getUserChats(req.userId);
    res.json(chats);
  } catch (err) {
    console.error('[Chat History Error]');
    res.status(500).json({ message: 'Failed to retrieve chat history' });
  }
});

// DELETE /api/chat/history — Clear authenticated user's chat conversation
router.delete('/history', requireAuth, async (req, res) => {
  try {
    await clearUserChats(req.userId);
    res.json({ message: 'Chat history cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to clear chat history' });
  }
});

// POST /api/chat/ask — Ask Noteversity AI assistant (reads relevant notes via
// extracted text + generates answer + persists in the user's chat history)
router.post('/ask', requireAuth, async (req, res) => {
  let clientAborted = false;
  req.on('close', () => {
    clientAborted = true;
  });

  try {
    const { message, question, subject, detailed } = req.body;
    const query = (question || message || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Please provide a question' });
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Record user message in chat history
    await appendUserChat(req.userId, {
      who: 'You',
      text: query,
      me: true,
      subject: subject || 'All',
      time: now,
      createdAt: new Date().toISOString(),
    });

    // 1b. Conversation memory: prior messages (the entry just appended IS the
    // current question, so drop it) — lets follow-ups reference earlier turns.
    const history = (await getUserChats(req.userId))
      .slice(0, -1)
      .slice(-6)
      .map((c) => ({ role: c.me ? 'user' : 'assistant', text: c.text || '' }));

    // 2. Query AI with RAG
    const result = await answerAcademicQuery({
      question: query,
      subject: subject || 'All',
      detailed: detailed !== false,
      history,
    });

    if (clientAborted) {
      console.log('[ChatBot] Request aborted by client. Skipping response delivery.');
      return;
    }

    // 3. Record AI message in chat history
    await appendUserChat(req.userId, {
      who: 'Noteversity AI',
      text: result.reply,
      sources: result.sources || [],
      me: false,
      subject: subject || 'All',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString(),
    });

    res.json(result);
  } catch (err) {
    if (clientAborted) return;
    console.error('[ChatBot Error]');
    res.status(500).json({
      message: err.message || 'Failed to generate answer from AI',
    });
  }
});

// POST /api/chat/suggest — follow-up suggestion chips for the exchange just answered.
// Separate endpoint so the main answer's latency is unchanged; a suggestions
// failure can never break the answer itself (errors → empty list).
router.post('/suggest', requireAuth, async (req, res) => {
  try {
    const { question, answer, subject } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ message: 'question and answer are required' });
    }
    const suggestions = await suggestFollowUps({ question, answer, subject });
    res.json({ suggestions });
  } catch (err) {
    console.error('[Chat Suggest Error]');
    res.json({ suggestions: [] });
  }
});

module.exports = router;
