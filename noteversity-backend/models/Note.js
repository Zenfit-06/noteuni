const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    branch: { type: String, required: true },
    semester: { type: Number, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String },
    // Plain text extracted once at upload/seed time so the AI can read the
    // document without touching the filesystem on every request.
    extractedText: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    downloads: { type: Number, default: 0 },
  },
  { timestamps: true, bufferCommands: false, autoIndex: false }
);

module.exports = mongoose.model('Note', noteSchema);
