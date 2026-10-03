const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret } = require('../config/env');

/**
 * Session resolution order: Authorization header (API testing) →
 * nv_admin cookie (an active admin session is the current identity) →
 * nv_session cookie (guests) → query ?token= for legacy/back-compat callers.
 */
function resolveToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const t = header.slice(7).trim();
    if (t && t !== 'undefined' && t !== 'null') return t;
  }
  if (req.cookies && req.cookies.nv_admin) return req.cookies.nv_admin;
  if (req.cookies && req.cookies.nv_session) return req.cookies.nv_session;
  if (typeof req.query.token === 'string') {
    const t = req.query.token.trim();
    if (t && t !== 'undefined' && t !== 'null') return t;
  }
  return null;
}

async function requireAuth(req, res, next) {
  const token = resolveToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret());
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User account no longer exists.' });
    }
    req.userId = user._id;
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Session expired or invalid token. Please sign in again.' });
  }
}

module.exports = requireAuth;
