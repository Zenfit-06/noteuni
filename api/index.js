/**
 * Vercel serverless entry point. Boots the database connection once per
 * lambda instance, then delegates every request to the Express app.
 */
const app = require('../noteversity-backend/app');
const connectDB = require('../noteversity-backend/config/db');

let readyPromise = null;

module.exports = async (req, res) => {
  try {
    if (!readyPromise) {
      readyPromise = connectDB();
    }
    await readyPromise;
    return app(req, res);
  } catch (err) {
    console.error('[Boot failure]');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Server boot failed. Check environment variables and database.' }));
  }
};
