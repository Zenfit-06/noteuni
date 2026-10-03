const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Note = require('../models/Note');
const Pyq = require('../models/Pyq');

// In-memory cache for parsed PDF text to ensure blazing fast repeat queries
const pdfTextCache = new Map();

/**
 * Extract plain text from a local PDF file.
 */
async function extractPdfText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stats = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stats.mtimeMs}`;
    if (pdfTextCache.has(cacheKey)) {
      return pdfTextCache.get(cacheKey);
    }

    const buf = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buf });
    await parser.load();
    const result = await parser.getText();
    const text = (result && result.text) ? result.text.trim() : '';

    // Cache the result
    pdfTextCache.set(cacheKey, text);
    return text;
  } catch (err) {
    console.warn(`[AI Service] Error reading PDF ${filePath}:`, err.message);
    return '';
  }
}

/**
 * Normalizes user-selected subject to match database subject tags.
 */
function normalizeSubject(sub) {
  if (!sub) return 'All';
  const s = String(sub).trim().toLowerCase();
  if (s === 'daa' || s.includes('algorithm')) return 'DAA';
  if (s === 'ai' || s.includes('artificial') || s.includes('intelligence')) return 'AI';
  if (s === 'aws' || s.includes('cloud')) return 'AWS';
  if (s === 'epj' || s.includes('java') || s.includes('enterprise')) return 'EPJ';
  if (s === 'toc' || s.includes('theory') || s.includes('computation') || s.includes('automata')) return 'TOC';
  if (s === 'qr' || s.includes('quant') || s.includes('reason')) return 'QR';
  return 'All';
}

/**
 * Detects common casual intents (greetings, acknowledgements, farewells)
 * to provide instantaneous, appropriate academic responses without dumping irrelevant course notes.
 */
function checkCasualIntent(rawQuestion, normSub) {
  const q = rawQuestion.trim().toLowerCase().replace(/[!?.,\-_]/g, '').trim();
  const subLabel = normSub === 'All' ? 'your Semester 5 engineering subjects' : normSub;

  const greetings = ['hi', 'hey', 'hello', 'hlo', 'yo', 'sup', 'namaste', 'good morning', 'good afternoon', 'good evening', 'hola'];
  if (greetings.includes(q)) {
    return `Hello! I'm ready to help with **${subLabel}**. Ask any concept explanation, derivation, algorithm walkthrough, or past exam question to begin.`;
  }

  const identity = ['who are you', 'what is this', 'what can you do', 'help', 'about'];
  if (identity.includes(q)) {
    return `I am Noteversity AI — your academic tutor for Parul University engineering courses. I read your uploaded course notes and PYQs to help you study topics, explain algorithms, and prepare for university exams in **${subLabel}**.`;
  }

  const thanks = ['thanks', 'thank you', 'tysm', 'thx', 'thank u', 'appreciate it'];
  if (thanks.includes(q)) {
    return `You're welcome! Best of luck with your preparation. Feel free to ask if you have more questions in **${subLabel}**.`;
  }

  const bye = ['bye', 'goodbye', 'cya', 'see you', 'good night', 'gn'];
  if (bye.includes(q)) {
    return `Good luck with your studies! Come back whenever you need help preparing for your semester exams.`;
  }

  return null;
}

/* ---------------- Relevance retrieval ----------------
 * Documents are ranked by keyword overlap with the student's question (not download
 * counts), and excerpts are built from the highest-scoring chunks so even 500-page
 * reference books contribute the pages that actually answer the query. PDFs with no
 * text layer (scans) are reported honestly instead of being cited as read. */

const DOC_EXCERPT_BUDGET = 24000;    // max chars sent to the model per document
const TOTAL_CONTEXT_BUDGET = 100000; // max chars across all selected documents
const MIN_READABLE_TEXT = 200;       // below this, a PDF is treated as a text-less scan
const MAX_DOCS = 6;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'can', 'could',
  'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'have', 'has', 'had',
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'whom', 'whose', 'that', 'this', 'these', 'those',
  'explain', 'explained', 'define', 'definition', 'describe', 'give', 'write', 'tell', 'show', 'state',
  'about', 'between', 'difference', 'differences', 'compare', 'comparison', 'versus', 'vs', 'example',
  'examples', 'using', 'use', 'each', 'not', 'no', 'but', 'if', 'then', 'than', 'there', 'their',
  'they', 'you', 'your', 'we', 'me', 'my', 'please', 'kindly', 'also', 'into', 'more', 'most',
  'some', 'any', 'all', 'it', 'its', 'short', 'brief', 'detail', 'detailed', 'note',
]);

function extractKeywords(question) {
  const tokens = question.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter(Boolean);
  const kws = new Set();
  for (const t of tokens) {
    // digits are kept: "topics in unit 8" should match docs titled/texted "Unit 8"
    if (t.length < 1 || STOPWORDS.has(t)) continue;
    kws.add(t);
    // crude singular/plural handling so "knapsacks" matches "knapsack" and vice versa
    if (t.length > 3 && t.endsWith('s')) kws.add(t.slice(0, -1));
  }
  return [...kws];
}

function countOccurrences(lowerText, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = lowerText.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

/**
 * Inverse document frequency weighting: a keyword that appears in nearly every
 * document ("algorithm" in DAA) is generic and counts little, while a keyword
 * unique to one or two documents ("bellman") identifies the right chapter.
 */
function computeKeywordWeights(keywords, lowerTexts) {
  const n = lowerTexts.length || 1;
  const weights = {};
  const rare = new Set();
  const rareThreshold = Math.max(2, Math.floor(n * 0.2));
  for (const kw of keywords) {
    let df = 0;
    for (const t of lowerTexts) {
      if (t.includes(kw)) df += 1;
    }
    weights[kw] = 1 + Math.log(n / (1 + df));
    if (df > 0 && df <= rareThreshold) rare.add(kw);
  }
  return { weights, rare };
}

function scoreText(text, keywords, phrase, weights, rare) {
  if (!text || !keywords.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const w = weights ? weights[kw] : 1;
    score += Math.min(countOccurrences(lower, kw), 40) * w;
  }
  if (phrase && lower.includes(phrase)) score += 25; // bonus when the full concept phrase appears
  if (rare) {
    for (const kw of rare) {
      if (lower.includes(kw)) score += 15; // distinctive terms point at the right document
    }
  }
  return score;
}

function buildExcerpt(text, keywords, phrase, budget, weights, rare) {
  if (text.length <= budget) return text;
  const CHUNK = 4000;
  const OVERLAP = 400;
  const scored = [];
  for (let i = 0; i < text.length; i += CHUNK - OVERLAP) {
    const chunk = text.slice(i, i + CHUNK);
    scored.push({ i, chunk, s: scoreText(chunk, keywords, phrase, weights, rare) });
  }
  const hits = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const picked = [];
  let used = 0;
  for (const h of hits) {
    if (used + h.chunk.length > budget) continue;
    picked.push(h);
    used += h.chunk.length;
    if (used >= budget * 0.95) break;
  }
  if (!picked.length) return text.slice(0, budget);
  return picked.sort((a, b) => a.i - b.i).map((h) => h.chunk.trim()).join('\n\n[…]\n\n');
}

/**
 * Ask Gemini with automatic fallback across reliable models.
 * A hard time budget keeps serverless invocations under the function limit.
 */
const AI_TIME_BUDGET_MS = 50000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ]);
}

async function generateWithFallback(apiKey, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const candidateModels = [
    process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
  ];

  let lastError = null;
  const startedAt = Date.now();
  for (const modelName of candidateModels) {
    const remaining = AI_TIME_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 2000) break;
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await withTimeout(
        model.generateContent(prompt),
        Math.min(remaining, 45000),
        `Model ${modelName}`
      );
      const text = result?.response?.text();
      if (text) {
        return { text, modelUsed: modelName };
      }
    } catch (err) {
      console.warn(`[AI Service] Model ${modelName} failed (${err.message}). Trying fallback...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini model candidates failed');
}

/**
 * Ask xAI (Grok) as a reliable backup when Gemini fails or is unreachable.
 */
async function generateWithXAI(prompt) {
  const apiKey = (process.env.XAI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'your_xai_api_key_here') {
    throw new Error('xAI API key is not configured in backend .env');
  }

  const candidateModels = [
    process.env.XAI_MODEL || 'grok-2-latest',
    'grok-2',
    'grok-beta',
  ];

  let lastError = null;
  for (const modelName of candidateModels) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40000);

      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: 'You are Noteversity AI — the dedicated academic mentor and tutor for Parul University engineering students. Jump directly into explaining engineering topics and answering academic questions with high clarity, clean math, and pseudocode where appropriate. Do not include casual greetings or non-academic filler.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
        }),
      });

      clearTimeout(timeoutId);

      const data = await res.json();
      if (res.ok && data.choices && data.choices[0]?.message?.content) {
        return {
          text: data.choices[0].message.content,
          modelUsed: `xai/${data.model || modelName}`,
        };
      } else {
        const errMsg = data.error?.message || (typeof data.error === 'string' ? data.error : JSON.stringify(data.error || '')) || data.message || `xAI API returned status ${res.status}`;
        throw new Error(errMsg);
      }
    } catch (err) {
      console.warn(`[AI Service] xAI model ${modelName} failed (${err.message}). Trying next candidate...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All xAI Grok model candidates failed');
}

/**
 * Core RAG Chat handler: reads relevant notes/PYQs and generates strictly academic AI response.
 * `history` (optional) = recent prior messages [{role:'user'|'assistant', text}] that let
 * follow-up questions like "explain that more simply" resolve against the conversation.
 */
async function answerAcademicQuery({ question, subject = 'All', detailed = true, history = [] }) {
  const normSub = normalizeSubject(subject);

  // 0. Conversation memory: keep the last few exchanges, truncated, and remember
  //    the student's previous message for retrieval blending.
  const recentHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((m) => ({
      role: m.role === 'user' ? 'Student' : 'AI',
      text: String(m.text || '').trim().slice(0, m.role === 'user' ? 200 : 400),
    }))
    .filter((m) => m.text);
  const lastUserText = [...recentHistory].reverse().find((m) => m.role === 'Student')?.text || '';

  // 1. Check for quick casual / greeting intent to avoid launching full lectures on "hey"
  const casualReply = checkCasualIntent(question, normSub);
  if (casualReply) {
    return {
      reply: casualReply,
      subject: normSub,
      modelUsed: 'instant-intent-filter',
      sources: [],
    };
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
  const xaiApiKey = (process.env.XAI_API_KEY || '').trim();
  const hasGemini = geminiApiKey && geminiApiKey !== 'your_gemini_api_key_here';
  const hasXai = xaiApiKey && xaiApiKey !== 'your_xai_api_key_here';

  if (!hasGemini && !hasXai) {
    throw new Error('Neither GEMINI_API_KEY nor XAI_API_KEY is configured in backend .env');
  }

  const filter = normSub === 'All' ? {} : { subject: normSub };

  // 2. Fetch a candidate pool of Notes and PYQs from MongoDB.
  // With no subject filter the pool spans every subject, so cast a wide net for
  // keyword matching; keyword scoring narrows it to the truly relevant few.
  const poolSize = normSub === 'All' ? 40 : 8;
  const [notes, pyqs] = await Promise.all([
    Note.find(filter).sort({ downloads: -1, createdAt: -1 }).limit(poolSize).lean(),
    Pyq.find(filter).sort({ downloads: -1, createdAt: -1 }).limit(normSub === 'All' ? 20 : 6).lean(),
  ]);

  const candidateDocs = [
    ...notes.map((n) => ({ ...n, docType: 'Note' })),
    ...pyqs.map((p) => ({ ...p, docType: 'PYQ' })),
  ];

  // 3. Extract text for every candidate, then score with IDF-weighted keyword relevance.
  //    For follow-ups ("explain simpler", "what about unit 5?") the raw question alone
  //    retrieves poorly, so document scoring blends in the student's previous message;
  //    the answer prompt below still receives only the real question + history.
  const retrievalQuery = lastUserText ? `${lastUserText} ${question}` : question;
  const keywords = extractKeywords(retrievalQuery);
  const phrase = keywords.filter((k) => k.length > 2).slice(0, 6).join(' ') || '';

  const scored = [];
  for (const doc of candidateDocs) {
    let text = '';
    // Preferred source: text extracted once at upload/seed time — no filesystem
    // access needed (required on serverless, faster everywhere).
    if (doc.extractedText && doc.extractedText.length >= MIN_READABLE_TEXT) {
      text = doc.extractedText;
    } else if (doc.fileUrl) {
      // Dev fallback: parse the local file on demand
      const cleanUrl = doc.fileUrl.startsWith('/') ? doc.fileUrl.slice(1) : doc.fileUrl;
      const diskPath = path.join(__dirname, '..', cleanUrl);
      if (fs.existsSync(diskPath)) {
        text = await extractPdfText(diskPath);
      }
    }
    if (!text) continue;
    const readable = !!text && text.length >= MIN_READABLE_TEXT;
    scored.push({ doc, text, readable, relevance: 0 });
  }

  const { weights, rare } = computeKeywordWeights(
    keywords,
    scored.filter((d) => d.readable).map((d) => d.text.toLowerCase())
  );

  for (const d of scored) {
    d.relevance = d.readable
      ? scoreText(d.text, keywords, phrase, weights, rare) + scoreText(d.doc.title || '', keywords, '', weights, rare) * 10
      : 0;
  }

  // Prefer documents whose content actually matches the question; when nothing
  // matches (broad/greeting-adjacent questions), fall back to popular readable docs.
  let selected = scored
    .filter((d) => d.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_DOCS);
  if (!selected.length) {
    selected = scored
      .filter((d) => d.readable)
      .sort((a, b) => (b.doc.downloads || 0) - (a.doc.downloads || 0))
      .slice(0, 3);
  }

  // 4. Build context from the most relevant excerpt of each selected document
  let combinedContext = '';
  const referencedSources = [];
  for (const d of selected) {
    const excerpt = buildExcerpt(d.text, keywords, phrase, DOC_EXCERPT_BUDGET, weights, rare);
    if (!excerpt || excerpt.length < MIN_READABLE_TEXT) continue;
    if (combinedContext.length + excerpt.length > TOTAL_CONTEXT_BUDGET) break;
    combinedContext += `\n--- [Document: "${d.doc.title}" | Subject: ${d.doc.subject} | Type: ${d.doc.docType}] ---\n${excerpt}\n`;
    referencedSources.push({
      id: d.doc._id,
      title: d.doc.title,
      subject: d.doc.subject,
      type: d.doc.docType,
      fileUrl: d.doc.fileUrl,
    });
  }

  const unreadableCount = scored.filter((d) => !d.readable).length;

  // 5. Assemble prompt with academic context and strict guardrails
  const contextSnippet = combinedContext.trim()
    ? `=== REPOSITORY COURSE NOTES & PYQs (${normSub}) ===\n${combinedContext}\n===============================================` +
      (unreadableCount > 0
        ? `\n(Note: ${unreadableCount} other repository document(s) for this subject are scanned images with no extractable text and could not be searched.)`
        : '')
    : `(Note: No readable uploaded PDF documents currently available for ${normSub}. Use your general academic curriculum knowledge.)`;

  const conversationBlock = recentHistory.length
    ? `=== RECENT CONVERSATION (for context only) ===
${recentHistory.map((m) => `${m.role}: ${m.text}`).join('\n')}
===============================================
The current question may reference this conversation (e.g. "explain that more simply", "what about unit 5?", "why?"). Resolve pronouns and references like "it", "that", or "this topic" against the conversation above when answering.

`
    : '';

  const prompt = `You are Noteversity AI — the dedicated academic mentor and tutor for Parul University engineering students.

STUDENT'S SUBJECT FOCUS: ${normSub === 'All' ? 'General Computer Science & Engineering' : normSub}
${conversationBlock}STUDENT'S QUESTION: ${question}

${contextSnippet}

${detailed ? '' : 'QUICK MODE ACTIVE: The student wants a SHORT answer. Give only the essential answer — max ~150 words, no section headings, no two-part structure, no lecture. If a list is asked, give just the list.'}

STRICT GUARDRAILS & RESPONSE RULES:
1. STRICT ACADEMIC & SUBJECT FOCUS (NO OFF-TOPIC):
   - You are strictly an academic engineering assistant for Parul University students.
   - If the student asks about anything UNRELATED to engineering, computer science, university curriculum, or exam preparation (e.g. movies, celebrity gossip, sports, politics, games, jokes, cooking recipes, creative non-academic roleplay):
     DECLINE POLITELY WITH THIS EXACT TYPE OF REDIRECTION:
     "I am specialized strictly for Parul University academic engineering subjects and exam preparation (${normSub}). Please ask a question related to your syllabus, coursework notes, or university exam preparation."
   - Never generate essays or answers for non-academic topics.

2. ANSWER LIKE A FACULTY MEMBER — PICK THE RIGHT FORMAT FOR THE QUESTION:
   A) CONCEPT QUESTIONS (explain / derive / prove / compare / "what is X and how does it work" — exam-style questions):
      Use the mandatory two-part structure, in this order:
      PART 1 — Begin with the heading "### ✍️ How to Write This in Your Exam"
        - The ready-to-write exam answer FIRST: exactly what the student should reproduce in the answer sheet to score full marks.
        - Numbered points the way marks are awarded: crisp definition, key formula/recurrence, algorithm steps or derivation outline, a small table or diagram description if needed, complexity, one-line conclusion.
        - Make it self-contained so a student can copy this part into their exam as-is.
      PART 2 — Then continue with the heading "### 📚 Faculty Explanation"
        - Teach the topic in depth like a faculty member at the blackboard: intuition, why it works, a worked example, common exam mistakes.
      - Never merge or reorder the parts. The "✍️" heading must be the VERY FIRST content of the reply.
   B) LIST / OVERVIEW / LOOKUP QUESTIONS (e.g. "topics in unit 8", "syllabus of X", "list the units", "what does the PDF say about...", full-forms, one-liner factual or yes/no questions):
      - SKIP the two-part structure entirely. Answer directly and concisely with a clean bullet/numbered list or a short factual answer, grounded in the excerpts.
      - If the question asks what a unit/document covers, LIST the actual topics found in the provided excerpts — do not invent topics and do not lecture about one of them.
   C) QUICK MODE (when instructed below): answer in the shortest useful form — essentials only, no headings, no two-part structure, max ~150 words.
   - NEVER start with self-introductions ("Hello! I am Noteversity...", "Welcome back!"). End cleanly with no filler goodbyes.

3. CLEAN TABLES, MATH & CODE FORMATTING:
   - For tabular data (DP tables, comparison tables, truth tables), use GitHub-style markdown tables with a header row and a |---|---| separator row. Keep tables to 6 columns or fewer and keep cell text short.
   - Do NOT put LaTeX inside table cells; write complexities plainly like O(n×W).
   - Do NOT output messy raw LaTeX environments like \\begin{cases}, \\text{}, or escaped brackets.
   - For recurrence relations, state equations, and algorithms, use clean code blocks, clean indented pseudocode, or standard mathematical notation.

4. HIGH-YIELD UNIVERSITY EXAM ORIENTED:
   - Use university exam terminology and standard textbook notation, with time & space complexities where appropriate.
   - Ground your explanations in the provided repository notes/PYQs when relevant.

5. HONEST GROUNDING IN THE PROVIDED EXCERPTS:
   - Base your answer primarily on the provided document excerpts above; they were selected because they match the question.
   - If the excerpts do not fully cover the question, you may answer from standard academic knowledge — but never claim a repository document contains material it does not.`;

  // 5. Generate answer: Primary (Gemini) with automatic fallback to Backup (xAI Grok)
  let reply = null;
  let modelUsed = null;
  let geminiError = null;

  if (hasGemini) {
    try {
      const geminiRes = await generateWithFallback(geminiApiKey, prompt);
      reply = geminiRes.text;
      modelUsed = geminiRes.modelUsed;
    } catch (err) {
      geminiError = err;
      console.warn(`[AI Service] Primary Gemini failed: ${err.message}. Attempting backup xAI Grok fallback...`);
    }
  } else {
    geminiError = new Error('Gemini API key is not configured');
  }

  // If Gemini failed or was not configured, route request to xAI Grok backup
  if (!reply) {
    if (hasXai) {
      try {
        console.log('[AI Service] Querying backup xAI Grok engine...');
        const xaiRes = await generateWithXAI(prompt);
        reply = xaiRes.text;
        modelUsed = xaiRes.modelUsed;
      } catch (xaiErr) {
        console.error('[AI Service] Backup xAI Grok also failed:', xaiErr.message);
        throw new Error(`Both primary AI (Gemini) and backup AI (xAI Grok) failed. Gemini error: ${geminiError ? geminiError.message : 'Not configured'}. xAI error: ${xaiErr.message}`);
      }
    } else {
      throw geminiError || new Error('No AI provider configured');
    }
  }

  return {
    reply,
    subject: normSub,
    modelUsed,
    sources: referencedSources,
  };
}

/**
 * Follow-up suggestion chips: given the exchange just answered, produce up to 3
 * short questions the student would naturally ask next. Best-effort — any
 * failure returns [] so the UI simply shows no chips.
 */
async function suggestFollowUps({ question, answer, subject = 'All' }) {
  const prompt = `You are Noteversity AI, an academic tutor for engineering students.
The student just asked: "${String(question).slice(0, 400)}"
Subject focus: ${normalizeSubject(subject)}
Your answer was: "${String(answer).slice(0, 1500)}"

Suggest exactly 3 short follow-up questions the student would naturally ask next:
- one clarifying a concept from the answer
- one going deeper into the topic
- one exam-oriented (how it is asked or compared in university exams)
Rules: each question max 12 words, same language as the conversation, self-contained (no "it/that" references), no numbering, no quotes.
Output ONLY a JSON array of 3 strings and nothing else.`;

  try {
    let raw = null;
    const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (geminiApiKey && geminiApiKey !== 'your_gemini_api_key_here') {
      try {
        const res = await generateWithFallback(geminiApiKey, prompt);
        raw = res.text;
      } catch (err) {
        console.warn(`[AI Service] Gemini follow-up suggestions failed: ${err.message}`);
      }
    }
    if (!raw) {
      const xaiApiKey = (process.env.XAI_API_KEY || '').trim();
      if (xaiApiKey && xaiApiKey !== 'your_xai_api_key_here') {
        const res = await generateWithXAI(prompt);
        raw = res.text;
      }
    }
    if (!raw) return [];

    const match = raw.match(/\[[\s\S]*\]/);
    const arr = match ? JSON.parse(match[0]) : null;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => String(s).trim())
      .filter((s) => s && s.length <= 80)
      .slice(0, 3);
  } catch (err) {
    console.warn('[AI Service] Follow-up suggestions unavailable:', err.message);
    return [];
  }
}

module.exports = {
  answerAcademicQuery,
  suggestFollowUps,
  extractPdfText,
  normalizeSubject,
  extractKeywords,
  scoreText,
  buildExcerpt,
  computeKeywordWeights,
};
