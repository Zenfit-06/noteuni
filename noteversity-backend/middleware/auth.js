const jwt = require('jsonwebtoken');
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

/**
 * JWT-only authentication — no database round-trip. The JWT signature is the
 * source of truth for req.userId; handlers that need the user document fetch
 * it themselves. This keeps a flaky DB connection from ever surfacing as a
 * bogus 401 "session expired" on a perfectly valid cookie.
 */
function requireAuth(req, res, next) {
  const token = resolveToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret());
  } catch (err) {
    return res.status(401).json({ message: 'Session expired or invalid token. Please sign in again.' });
  }

  if (!decoded || !decoded.userId) {
    return res.status(401).json({ message: 'Session expired or invalid token. Please sign in again.' });
  }

  req.userId = decoded.userId;
  return next();
}

module.exports = requireAuth;
