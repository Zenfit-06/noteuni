const mongoose = require('mongoose');

const pyqSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    branch: { type: String, required: true },
    semester: { type: Number, required: true },
    year: { type: Number, required: true },
    examType: { type: String, enum: ['MidSem1', 'MidSem2', 'EndSem', 'BackPaper'], required: true },
    isSolved: { type: Boolean, default: false },
    fileUrl: { type: String, required: true },
    // Plain text extracted once at upload/seed time (see Note.extractedText)
    extractedText: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    downloads: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Pyq', pyqSchema);
