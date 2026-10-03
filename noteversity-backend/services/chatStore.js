/**
 * Per-user AI chat history, backed by MongoDB (ChatEntry) so it behaves
 * identically in development (in-memory DB) and production (Atlas) — chat
 * history must never depend on the ephemeral serverless filesystem.
 * Keeps the same function signatures the routes already use.
 */
const ChatEntry = require('../models/ChatEntry');

const MAX_ENTRIES = 150;

function toClient(doc) {
  return {
    who: doc.who,
    text: doc.text,
    sources: doc.sources || [],
    me: !!doc.me,
    subject: doc.subject || 'All',
    time: doc.time || '',
    createdAt: doc.createdAt,
  };
}

async function getUserChats(userId) {
  const docs = await ChatEntry.find({ userId })
    .sort({ createdAt: 1 })
    .limit(MAX_ENTRIES)
    .lean();
  return docs.map(toClient);
}

async function appendUserChat(userId, chatItem) {
  await ChatEntry.create({
    userId,
    who: chatItem.who,
    text: chatItem.text || '',
    sources: chatItem.sources || [],
    me: !!chatItem.me,
    subject: chatItem.subject || 'All',
    time: chatItem.time || '',
    createdAt: chatItem.createdAt ? new Date(chatItem.createdAt) : new Date(),
  });
  // Trim history beyond the cap
  const count = await ChatEntry.countDocuments({ userId });
  if (count > MAX_ENTRIES) {
    const stale = await ChatEntry.find({ userId })
      .sort({ createdAt: 1 })
      .limit(count - MAX_ENTRIES)
      .select('_id')
      .lean();
    if (stale.length) {
      await ChatEntry.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
    }
  }
}

async function clearUserChats(userId) {
  await ChatEntry.deleteMany({ userId });
}

module.exports = { getUserChats, appendUserChat, clearUserChats };
