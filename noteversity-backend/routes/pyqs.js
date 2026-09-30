const express = require('express');
const Pyq = require('../models/Pyq');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const upload = require('../middleware/upload');
const { syncPyqsToJson, syncUsersToJson } = require('../services/jsonStore');

const router = express.Router();

const VALID_SUBJECTS = ['DAA', 'AI', 'AWS', 'EPJ', 'TOC', 'QR'];

// GET /api/pyqs?subject=DAA&year=2024&examType=EndSem
router.get('/', requireAuth, async (req, res) => {
  const { subject, semester, branch, year, examType, search } = req.query;
  const filter = {};
  if (subject) filter.subject = subject;
  if (semester) filter.semester = Number(semester);
  if (branch) filter.branch = branch;
  if (year) filter.year = Number(year);
  if (examType) filter.examType = examType;
  if (search) filter.title = { $regex: search, $options: 'i' };

  const pyqs = await Pyq.find(filter).populate('uploadedBy', 'name').sort({ year: -1 });
  res.json(pyqs);
});

// POST /api/pyqs - ADMIN ONLY
router.post('/', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const { title, subject, branch, semester, year, examType, isSolved } = req.body;
    if (!req.file) return res.status(400).json({ message: 'File is required' });
    if (!title || !title.trim() || !VALID_SUBJECTS.includes(subject)) {
      if (req.file.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: 'Title and subject are required' });
    }
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      if (req.file.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: 'A valid year is required' });
    }

    const pyq = await Pyq.create({
      title,
      subject,
      branch,
      semester,
      year: yearNum,
      examType,
      isSolved: isSolved === 'true',
      fileUrl: `/uploads/${req.file.filename}`,
      uploadedBy: req.userId,
    });

    await syncPyqsToJson(Pyq);
    res.status(201).json(pyq);
  } catch (err) {
    console.error(err);
    // Remove the just-saved file so failed creates don't leave orphans
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ message: 'Upload failed' });
  }
});

// DELETE /api/pyqs/:id - ADMIN ONLY
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pyq = await Pyq.findById(req.params.id);
    if (!pyq) return res.status(404).json({ message: 'PYQ not found' });

    if (pyq.fileUrl && !pyq.fileUrl.includes('sample-document.pdf')) {
      const filePath = path.join(__dirname, '..', pyq.fileUrl);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.warn('Could not unlink file:', e.message); }
      }
    }

    await Pyq.findByIdAndDelete(req.params.id);
    await syncPyqsToJson(Pyq);
    res.json({ message: 'PYQ deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Failed to delete PYQ' });
  }
});

// POST /api/pyqs/:id/download
router.post('/:id/download', requireAuth, async (req, res) => {
  const pyq = await Pyq.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
  if (!pyq) return res.status(404).json({ message: 'PYQ not found' });

  await User.findByIdAndUpdate(req.userId, { $addToSet: { downloadedPyqs: pyq._id } });
  await syncPyqsToJson(Pyq);
  await syncUsersToJson(User);
  res.json({ fileUrl: pyq.fileUrl });
});

module.exports = router;
