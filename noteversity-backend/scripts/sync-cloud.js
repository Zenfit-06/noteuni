/**
 * One-time cloud sync: run this LOCALLY against your production MongoDB
 * Atlas cluster to upload the PDF library into GridFS and seed the
 * collections. Idempotent — files already in GridFS are skipped.
 *
 * Usage (from noteversity-backend/):
 *   MONGO_URI="mongodb+srv://user:pass@cluster/..." npm run sync:cloud
 *   (or set MONGO_URI in noteversity-backend/.env)
 *
 * Note: forces TLS 1.2 — Node 24's default TLS 1.3 handshake is rejected
 * mid-session by some Atlas/network combinations ("tlsv1 alert internal
 * error"). Harmless on other setups.
 */
process.env.STORAGE_MODE = 'gridfs'; // force GridFS writes even though we run locally
process.env.NODE_ENV = 'production'; // fail fast if Atlas is unreachable — no local fallback

require('tls').DEFAULT_MAX_VERSION = 'TLSv1.2';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const storage = require('../services/storage');

const UPLOADS_DIR = storage.UPLOADS_DIR;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function uploadWithRetry(buffer, filename, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await storage.putPdf(buffer, filename);
      return true;
    } catch (err) {
      console.warn(`    attempt ${i} failed: ${err.message.slice(0, 90)}`);
      if (i < attempts) await sleep(1500);
    }
  }
  return false;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri || uri.includes('127.0.0.1')) {
    console.error('\n[!] Set MONGO_URI to your production Atlas connection string, e.g.:');
    console.error('    MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/noteversity" npm run sync:cloud\n');
    process.exit(1);
  }

  console.log('Syncing local uploads/ into the cloud database...');
  await connectDB();

  // ── Phase 1: upload every PDF into GridFS (retry per file) ──
  const files = fs.existsSync(UPLOADS_DIR)
    ? fs.readdirSync(UPLOADS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'))
    : [];
  let uploaded = 0, skipped = 0;
  const failed = [];

  for (const file of files) {
    if (await storage.hasPdf(file)) { skipped++; continue; }
    process.stdout.write(`  uploading ${file} ... `);
    const ok = await uploadWithRetry(fs.readFileSync(path.join(UPLOADS_DIR, file)), file);
    if (ok) { uploaded++; console.log('ok'); }
    else { failed.push(file); console.log('FAILED'); }
  }
  console.log(`\nGridFS: ${uploaded} uploaded, ${skipped} already present, ${failed.length} failed`);
  if (failed.length) {
    console.log('  Failed files (re-run the script to retry):');
    failed.forEach((f) => console.log('   - ' + f));
  }

  // ── Phase 2: seed users / notes / PYQs (small ops, reads extracted text) ──
  const seedInitialData = require('../config/seeder');
  await seedInitialData();

  const Note = require('../models/Note');
  const Pyq = require('../models/Pyq');
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'pdfs' });
  const gridfsCount = await bucket.find().toArray();

  console.log('\n✓ Sync complete.');
  console.log(`  Notes in database:  ${await Note.countDocuments()}`);
  console.log(`  PYQs in database:   ${await Pyq.countDocuments()}`);
  console.log(`  PDFs in GridFS:     ${gridfsCount.length}`);
  console.log('\nNext: add your env vars in Vercel (MONGO_URI, JWT_SECRET, ADMIN_PASSWORD_HASH,');
  console.log('GEMINI_API_KEY) and deploy. The deployed app connects to this same database.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[!] Sync failed:', err.message);
  process.exit(1);
});
