const express = require('express');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard — everything the dashboard view needs in one call
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId)
    .populate({ path: 'downloadedNotes', options: { sort: { createdAt: -1 }, limit: 10 } })
    .populate({ path: 'downloadedPyqs', options: { sort: { createdAt: -1 }, limit: 10 } });

  if (!user) return res.status(404).json({ message: 'User not found' });

  res.json({
    profile: {
      name: user.name,
      email: user.email,
      branch: user.branch,
      semester: user.semester,
      rollNumber: user.rollNumber,
    },
    stats: {
      notesDownloaded: user.downloadedNotes.length,
      pyqsDownloaded: user.downloadedPyqs.length,
    },
    recentNotes: user.downloadedNotes,
    recentPyqs: user.downloadedPyqs,
  });
});

module.exports = router;
