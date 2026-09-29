const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    rollNumber: { type: String, trim: true },
    branch: { type: String, trim: true },
    semester: { type: Number },
    passwordHash: { type: String },
    isVerified: { type: Boolean, default: false },
    otpHash: { type: String },
    otpExpiresAt: { type: Date },
    downloadedNotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Note' }],
    downloadedPyqs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pyq' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
