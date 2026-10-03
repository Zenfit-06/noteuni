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

let connectingPromise = null;
let lastVerified = 0;
const VERIFY_INTERVAL_MS = 15000;

function ping() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return Promise.reject(new Error('not connected'));
  }
  return Promise.race([
    mongoose.connection.db.admin().command({ ping: 1 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 3000)),
  ]);
}

async function reconnect() {
  console.log('[DB] Reconnecting to MongoDB (resetting connection)...');
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
    } catch (e) {
      console.warn('[DB] disconnect error during reconnect:', e.message);
    }
  }
  await connectDB();
  await ping();
  lastVerified = Date.now();
  console.log('[DB] Connection verified healthy');
}

/**
 * Ensure a genuinely alive DB connection. Serialized so concurrent requests
 * share one connect/verify cycle. Handles container freezes/thaws by verifying
 * responsiveness and forcing a clean disconnect/reconnect if the socket is dead.
 */
async function ensureDb() {
  if (connectingPromise) {
    await connectingPromise;
    return;
  }

  // Fast path: already connected and verified within the interval
  if (mongoose.connection.readyState === 1 && (Date.now() - lastVerified < VERIFY_INTERVAL_MS)) {
    return;
  }

  connectingPromise = (async () => {
    // If readyState claims 1, test if socket is genuinely alive (frozen lambda check)
    if (mongoose.connection.readyState === 1) {
      try {
        await ping();
        lastVerified = Date.now();
        return;
      } catch (err) {
        console.warn('[DB] Stale/frozen connection detected:', err.message);
      }
    }

    // Not connected or ping failed — perform clean reconnect
    await reconnect();
  })();

  try {
    await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

module.exports = async (req, res) => {
  try {
    await ensureDb();
    return app(req, res);
  } catch (err) {
    console.error('[DB unavailable]:', err && err.message ? err.message : err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Database is temporarily unreachable. Please try again.' }));
  }
};
