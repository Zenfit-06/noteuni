const fs = require('fs');
const path = require('path');
const { IS_PROD } = require('../config/env');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const PYQS_FILE = path.join(DATA_DIR, 'pyqs.json');

// In production Mongo is the source of truth and the serverless filesystem is
// ephemeral — JSON mirroring only exists for local development convenience.
const SYNC_ENABLED = !IS_PROD;

function readJson(filePath, fallback = []) {
  if (IS_PROD) return fallback;
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[JSON Store] Warning reading ${filePath}:`, err.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  if (IS_PROD) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[JSON Store] Error writing ${filePath}:`, err.message);
  }
}

async function syncUsersToJson(UserModel) {
  if (!SYNC_ENABLED) return;
  try {
    const users = await UserModel.find({}).lean();
    writeJson(USERS_FILE, users);
  } catch (e) {
    console.warn('[JSON Store] syncUsersToJson error:', e.message);
  }
}

async function syncNotesToJson(NoteModel) {
  if (!SYNC_ENABLED) return;
  try {
    const notes = await NoteModel.find({}).lean();
    writeJson(NOTES_FILE, notes);
  } catch (e) {
    console.warn('[JSON Store] syncNotesToJson error:', e.message);
  }
}

async function syncPyqsToJson(PyqModel) {
  if (!SYNC_ENABLED) return;
  try {
    const pyqs = await PyqModel.find({}).lean();
    writeJson(PYQS_FILE, pyqs);
  } catch (e) {
    console.warn('[JSON Store] syncPyqsToJson error:', e.message);
  }
}

module.exports = {
  SYNC_ENABLED,
  USERS_FILE,
  NOTES_FILE,
  PYQS_FILE,
  readJson,
  writeJson,
  syncUsersToJson,
  syncNotesToJson,
  syncPyqsToJson,
};
