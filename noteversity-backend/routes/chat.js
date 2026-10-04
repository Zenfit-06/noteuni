const express = require('express');
const requireAuth = require('../middleware/auth');
const { answerAcademicQuery, suggestFollowUps } = require('../services/aiService');

const router = express.Router();

// GET /api/chat/history — chat transcripts live in each user's browser
// (localStorage); the server keeps none. Compat stub for stale clients.
router.get('/history', requireAuth, (req, res) => {
  res.json([]);
});

// DELETE /api/chat/history — nothing stored server-side anymore.
router.delete('/history', requireAuth, (req, res) => {
  res.json({ message: 'Chat history is stored in your browser and was not modified' });
});

// POST /api/chat/ask — Ask AKGEC AI assistant (reads relevant notes via
// extracted text + generates the answer; the transcript is kept client-side)
router.post('/ask', requireAuth, async (req, res) => {
  let clientAborted = false;
  req.on('close', () => {
    clientAborted = true;
  });

  try {
    const { message, question, subject, detailed, history: clientHistory } = req.body;
    const query = (question || message || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Please provide a question' });
    }

    // Conversation memory comes from the client (its localStorage transcript,
    // excluding the current question) — lets follow-ups reference earlier turns
    // without the server storing any chat data.
    const history = (Array.isArray(clientHistory) ? clientHistory : [])
      .slice(-6)
      .filter((c) => c && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({
        role: c.role === 'assistant' ? 'assistant' : 'user',
        text: c.text.slice(0, 8000),
      }));

    // Query AI with RAG — hard 45 s ceiling so a stalled provider socket can
    // never leave the user spinning past the 60 s serverless function limit.
    console.log(`[ChatBot] /ask start: subject=${subject || 'All'} len=${query.length}`);
    const t0 = Date.now();
    let result;
    try {
      result = await Promise.race([
        answerAcademicQuery({
          question: query,
          subject: subject || 'All',
          detailed: detailed !== false,
          history,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('The AI service took too long to respond. Please try again in a moment.')), 45000)
        ),
      ]);
    } catch (aiErr) {
      console.error(`[ChatBot] pipeline ended after ${Date.now() - t0}ms: ${aiErr.message}`);
      throw aiErr;
    }
    console.log(`[ChatBot] /ask done in ${Date.now() - t0}ms via ${result.modelUsed || '?'}`);

    if (clientAborted) {
      console.log('[ChatBot] Request aborted by client. Skipping response delivery.');
      return;
    }

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
