const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  // Bearer header for API calls, ?token= query for iframe/download links
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token && typeof req.query.token === 'string') {
    token = req.query.token.trim();
  }

  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'noteversity_dev_secret_key_2026_jwt_token_secure';
    const decoded = jwt.verify(token, secret);
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
