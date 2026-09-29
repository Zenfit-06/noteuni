const express = require('express');
const Note = require('../models/Note');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const upload = require('../middleware/upload');
const { syncNotesToJson, syncUsersToJson } = require('../services/jsonStore');

const router = express.Router();

// GET /api/notes?subject=DAA&semester=5
router.get('/', requireAuth, async (req, res) => {
  const { subject, semester, branch, search } = req.query;
  const filter = {};
  if (subject) filter.subject = subject;
  if (semester) filter.semester = Number(semester);
  if (branch) filter.branch = branch;
  if (search) filter.title = { $regex: search, $options: 'i' };

  const notes = await Note.find(filter).populate('uploadedBy', 'name').sort({ createdAt: -1 });
  res.json(notes);
});

// POST /api/notes  (multipart/form-data, field name: file) - ADMIN ONLY
router.post('/', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const { title, subject, branch, semester } = req.body;
    if (!req.file) return res.status(400).json({ message: 'File is required' });

    const note = await Note.create({
      title,
      subject,
      branch,
      semester,
      fileUrl: `/uploads/${req.file.filename}`,
      fileType: req.file.mimetype,
      uploadedBy: req.userId,
    });

    await syncNotesToJson(Note);
    res.status(201).json(note);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// DELETE /api/notes/:id - ADMIN ONLY
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    if (note.fileUrl && !note.fileUrl.includes('sample-document.pdf')) {
      const filePath = path.join(__dirname, '..', note.fileUrl);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.warn('Could not unlink file:', e.message); }
      }
    }

    await Note.findByIdAndDelete(req.params.id);
    await syncNotesToJson(Note);
    res.json({ message: 'Note deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Failed to delete note' });
  }
});

// POST /api/notes/:id/download  — increments count + tracks on user dashboard
router.post('/:id/download', requireAuth, async (req, res) => {
  const note = await Note.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
  if (!note) return res.status(404).json({ message: 'Note not found' });

  await User.findByIdAndUpdate(req.userId, { $addToSet: { downloadedNotes: note._id } });
  await syncNotesToJson(Note);
  await syncUsersToJson(User);
  res.json({ fileUrl: note.fileUrl });
});

module.exports = router;
