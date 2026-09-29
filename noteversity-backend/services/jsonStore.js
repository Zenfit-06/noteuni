const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 4 distinct JSON files for clear data separation
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const PYQS_FILE = path.join(DATA_DIR, 'pyqs.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

function readJson(filePath, fallback = []) {
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
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[JSON Store] Error writing ${filePath}:`, err.message);
  }
}

/**
 * Sync Mongoose collections to their respective JSON files
 */
async function syncUsersToJson(UserModel) {
  try {
    const users = await UserModel.find({}).lean();
    writeJson(USERS_FILE, users);
  } catch (e) {
    console.warn('[JSON Store] syncUsersToJson error:', e.message);
  }
}

async function syncNotesToJson(NoteModel) {
  try {
    const notes = await NoteModel.find({}).lean();
    writeJson(NOTES_FILE, notes);
  } catch (e) {
    console.warn('[JSON Store] syncNotesToJson error:', e.message);
  }
}

async function syncPyqsToJson(PyqModel) {
  try {
    const pyqs = await PyqModel.find({}).lean();
    writeJson(PYQS_FILE, pyqs);
  } catch (e) {
    console.warn('[JSON Store] syncPyqsToJson error:', e.message);
  }
}

/**
 * Chat history persistence per user
 */
function getUserChats(userId) {
  const allChats = readJson(CHATS_FILE, {});
  return allChats[String(userId)] || [];
}

function appendUserChat(userId, chatItem) {
  const allChats = readJson(CHATS_FILE, {});
  const uid = String(userId);
  if (!allChats[uid]) {
    allChats[uid] = [];
  }
  allChats[uid].push(chatItem);
  // Cap at 150 items per user to preserve performance
  if (allChats[uid].length > 150) {
    allChats[uid] = allChats[uid].slice(-150);
  }
  writeJson(CHATS_FILE, allChats);
}

function clearUserChats(userId) {
  const allChats = readJson(CHATS_FILE, {});
  delete allChats[String(userId)];
  writeJson(CHATS_FILE, allChats);
}

module.exports = {
  USERS_FILE,
  NOTES_FILE,
  PYQS_FILE,
  CHATS_FILE,
  readJson,
  writeJson,
  syncUsersToJson,
  syncNotesToJson,
  syncPyqsToJson,
  getUserChats,
  appendUserChat,
  clearUserChats,
};
