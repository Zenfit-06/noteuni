/**
 * PDF storage with two interchangeable backends:
 *  - disk   (development): files live in noteversity-backend/uploads/
 *  - gridfs (production / STORAGE_MODE=gridfs): files live in MongoDB GridFS,
 *    because serverless filesystems are ephemeral and read-only.
 *
 * One interface for the rest of the app; mode is chosen once per environment.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { IS_PROD } = require('../config/env');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const USE_GRIDFS = IS_PROD || process.env.STORAGE_MODE === 'gridfs';
const MAX_EXTRACTED_TEXT = 120000; // ~120KB per document — far above RAG's 24KB/doc budget

function gridfsBucket() {
  if (!mongoose.connection || !mongoose.connection.db) {
    throw new Error('Database connection is not ready for GridFS');
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'pdfs' });
}

function safeName(filename) {
  return path.basename(String(filename || ''));
}

/** Store a PDF buffer under the given filename; returns its public fileUrl. */
async function putPdf(buffer, filename) {
  const name = safeName(filename);
  if (!USE_GRIDFS) {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
    return `/uploads/${name}`;
  }
  const bucket = await gridfsBucket();
  await deletePdf(name); // replace any previous version silently
  await new Promise((resolve, reject) => {
    const ws = bucket.openUploadStream(name, { contentType: 'application/pdf' });
    ws.on('finish', resolve);
    ws.on('error', reject);
    ws.end(buffer);
  });
  return `/uploads/${name}`;
}

/** Returns a readable stream for the PDF, or null when it doesn't exist. */
async function getPdfStream(filename) {
  const name = safeName(filename);
  if (!USE_GRIDFS) {
    const filePath = path.join(UPLOADS_DIR, name);
    if (!fs.existsSync(filePath)) return null;
    return fs.createReadStream(filePath);
  }
  const bucket = await gridfsBucket();
  const files = await bucket.find({ filename: name }).limit(1).toArray();
  if (!files.length) return null;
  return bucket.openDownloadStream(files[0]._id);
}

async function hasPdf(filename) {
  const name = safeName(filename);
  if (!USE_GRIDFS) {
    return fs.existsSync(path.join(UPLOADS_DIR, name));
  }
  const bucket = await gridfsBucket();
  const count = await bucket.find({ filename: name }).limit(1).toArray();
  return count.length > 0;
}

async function deletePdf(filename) {
  const name = safeName(filename);
  if (!USE_GRIDFS) {
    const filePath = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { console.warn('Could not unlink file:', e.message); }
    }
    return;
  }
  const bucket = await gridfsBucket();
  const files = await bucket.find({ filename: name }).toArray();
  for (const f of files) {
    try { await bucket.delete(f._id); } catch (e) { console.warn('GridFS delete failed:', e.message); }
  }
}

/** Extract plain text from a PDF buffer (used at upload/seed time, not per request). */
async function extractPdfText(buffer) {
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    await parser.load();
    const result = await parser.getText();
    const text = result && result.text ? result.text.trim() : '';
    return text.slice(0, MAX_EXTRACTED_TEXT);
  } catch (err) {
    console.warn('[Storage] PDF text extraction failed:', err.message);
    return '';
  }
}

module.exports = { USE_GRIDFS, putPdf, getPdfStream, hasPdf, deletePdf, extractPdfText, UPLOADS_DIR };
