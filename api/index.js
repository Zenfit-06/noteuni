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
const mongoose = require('mongoose');

// Serverless hardening: Vercel freezes lambdas between requests and their
// sockets to Atlas die while frozen. Verify liveness with a real ping
// (cached for 30s so we don't ping per request) and reconnect when stale.
let connecting = null;
let lastVerified = 0;
const VERIFY_INTERVAL_MS = 30000;

async function reconnectDb() {
  try { await mongoose.disconnect(); } catch (e) { /* already down */ }
  if (!connecting) {
    connecting = connectDB().finally(() => { connecting = null; });
  }
  await connecting;
}

async function ensureDb() {
  if (mongoose.connection.readyState !== 1 || Date.now() - lastVerified > VERIFY_INTERVAL_MS) {
    if (mongoose.connection.readyState !== 1) {
      await reconnectDb();
    }
    await Promise.race([
      mongoose.connection.db.admin().command({ ping: 1 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 5000)),
    ]);
    lastVerified = Date.now();
  }
}

module.exports = async (req, res) => {
  try {
    await ensureDb();
    return app(req, res);
  } catch (err) {
    console.error('[Boot/connection failure]');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Server boot failed. Check environment variables and database.' }));
  }
};
