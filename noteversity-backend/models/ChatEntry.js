const mongoose = require('mongoose');

/**
 * Per-user AI chat history (works identically on the dev in-memory database
 * and production Atlas — never persisted to the ephemeral filesystem).
 */
const chatEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    who: { type: String, required: true }, // 'You' | 'Noteversity AI'
    text: { type: String, default: '' },
    sources: { type: Array, default: [] },
    me: { type: Boolean, default: false },
    subject: { type: String, default: 'All' },
    time: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChatEntry', chatEntrySchema);
