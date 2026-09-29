const User = require('../models/User');

const ADMIN_EMAIL = 'admin@paruluniversity.ac.in';

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({
        message: 'Access denied: Only Admin (Parul Admin) is authorized to upload or delete files.'
      });
    }
    req.adminUser = user;
    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    res.status(500).json({ message: 'Authorization check failed' });
  }
}

module.exports = { requireAdmin, ADMIN_EMAIL };
