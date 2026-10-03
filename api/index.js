/**
 * Vercel serverless entry point. Boots the database connection once per
 * lambda instance, then delegates every request to the Express app.
 */

// pdf-parse (via pdf.js) references browser globals at module load when its
// optional @napi-rs/canvas package is absent (as on Vercel's Linux builder).
// We only extract text, never render pages, so minimal stubs are enough.
globalThis.DOMMatrix = globalThis.DOMMatrix || class DOMMatrix {};
globalThis.ImageData = globalThis.ImageData || class ImageData {};
globalThis.Path2D = globalThis.Path2D || class Path2D {};

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
