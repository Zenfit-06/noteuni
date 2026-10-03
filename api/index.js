/**
 * Vercel serverless entry point. Keeps a verified MongoDB connection across
 * frozen/thawed lambda instances, then delegates every request to Express.
 */

// pdf-parse (via pdf.js) references browser globals at module load when its
// optional @napi-rs/canvas package is absent (as on Vercel's Linux builder).
// We only extract text, never render pages, so minimal stubs are enough.
globalThis.DOMMatrix = globalThis.DOMMatrix || class DOMMatrix {};
globalThis.ImageData = globalThis.ImageData || class ImageData {};
globalThis.Path2D = globalThis.Path2D || class Path2D {};

const app = require('../noteversity-backend/app');
const connectDB = require('../noteversity-backend/config/db');
const mongoose = require('mongoose');

let connecting = null;
let lastVerified = 0;
const VERIFY_INTERVAL_MS = 30000;

function ping() {
  return Promise.race([
    mongoose.connection.db.admin().command({ ping: 1 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 5000)),
  ]);
}

/**
 * Ensure a genuinely alive DB connection. Serialized so concurrent requests
 * share one connect/verify cycle. Never force-disconnect — mongoose.connect
 * re-establishes from any non-connected state, and disconnecting would pull
 * the rug out from under concurrent requests.
 */
async function ensureDb() {
  if (connecting) {
    await connecting;
    return;
  }
  if (mongoose.connection.readyState === 1 && Date.now() - lastVerified < VERIFY_INTERVAL_MS) {
    return;
  }

  connecting = (async () => {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
      return;
    }
    // readyState claims "connected" — verify the socket is truly alive
    // (it dies whenever Vercel freezes the lambda for a while).
    try {
      await ping();
      lastVerified = Date.now();
    } catch (err) {
      console.warn('[DB] stale connection detected, reconnecting');
      await connectDB();
      lastVerified = Date.now();
    }
  })();

  try {
    await connecting;
    lastVerified = Date.now();
  } catch (err) {
    // One clean retry through a fresh connect before giving up
    await connectDB();
    lastVerified = Date.now();
  } finally {
    connecting = null;
  }
}

module.exports = async (req, res) => {
  try {
    await ensureDb();
    return app(req, res);
  } catch (err) {
    console.error('[DB unavailable]');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Database is temporarily unreachable. Please try again.' }));
  }
};
