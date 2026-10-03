const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

const ADMIN_EMAIL = 'admin@paruluniversity.ac.in';

/**
 * Server-side gate for every admin operation. Verifies the signed nv_admin
 * cookie (set only by /api/auth/admin/login after a bcrypt password check).
 * Guest session tokens are rejected by the `typ` check — knowing the admin
 * UI routes or having a normal session grants nothing.
 */
async function requireAdmin(req, res, next) {
  const token = req.cookies ? req.cookies.nv_admin : null;
  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required. Please sign in as admin.' });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded.typ !== 'admin' || !decoded.userId) {
      return res.status(403).json({ message: 'Admin access denied.' });
    }
    req.adminUserId = decoded.userId;
    req.adminUser = { id: decoded.userId, email: ADMIN_EMAIL };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Admin session expired or invalid. Please sign in again.' });
  }
}

module.exports = { requireAdmin, ADMIN_EMAIL };
