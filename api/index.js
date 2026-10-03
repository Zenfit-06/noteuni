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
// sockets to Atlas die while frozen. On every request, make sure the
// connection is genuinely alive (readyState 1 = connected) and re-connect
// when it isn't — never serve DB-backed routes from a dead connection.
let connecting = null;

async function ensureDb() {
  const state = mongoose.connection.readyState;
  if (state === 1) return;
  if (state === 2 && connecting) {
    await connecting;
    return;
  }
  connecting = connectDB().finally(() => { connecting = null; });
  await connecting;
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
