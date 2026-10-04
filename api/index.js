/**
 * Vercel serverless entry point. Keeps a cached MongoDB connection across
 * invocations, then delegates every request to Express.
 */

// Stubs for pdf-parse browser globals on headless Linux
globalThis.DOMMatrix = globalThis.DOMMatrix || class DOMMatrix {};
globalThis.ImageData = globalThis.ImageData || class ImageData {};
globalThis.Path2D = globalThis.Path2D || class Path2D {};

const mongoose = require('mongoose');

// Configure Mongoose BEFORE compiling models or routes
mongoose.set('bufferCommands', false);
mongoose.set('autoIndex', false);

const app = require('../noteversity-backend/app');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/noteversity';

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function ensureDb() {
  const state = mongoose.connection.readyState;

  if (state === 1) {
    cached.conn = cached.conn || mongoose.connection;
    return cached.conn;
  }

  // readyState 2 (connecting): ride the in-flight promise. 0 (disconnected)
  // or 3 (disconnecting): start a fresh connect — previously an old resolved
  // promise could be awaited here, letting requests run against a closed
  // connection and throwing on the first query.
  if (state !== 2 || !cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, {
      bufferCommands: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    }).then((m) => {
      console.log('MongoDB connected successfully');
      return m;
    }).catch((err) => {
      cached.promise = null;
      cached.conn = null;
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    console.error('MongoDB connect error:', err.message);
    throw err;
  }

  return cached.conn;
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
