const multer = require('multer');
const path = require('path');

/**
 * Memory storage: file bytes stay in RAM and are written to the storage
 * backend (disk in dev, GridFS in production) by the route handler after
 * validation. Disk storage would fail on serverless ephemeral filesystems.
 */
const storage = multer.memoryStorage();

const allowedTypes = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.jpg', '.png'];

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) cb(null, true);
  else cb(new Error('Unsupported file type. Allowed: ' + allowedTypes.join(', ')));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

module.exports = upload;
