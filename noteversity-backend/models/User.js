const mongoose = require('mongoose');

/**
 * Users are anonymous identities: guest sessions (created server-side per
 * browser, no credentials) and the system admin record used for upload
 * attribution. There is no user login, no passwords, no profiles.
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    rollNumber: { type: String, trim: true },
    branch: { type: String, trim: true },
    semester: { type: Number },
    isVerified: { type: Boolean, default: false },
    downloadedNotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Note' }],
    downloadedPyqs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pyq' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
