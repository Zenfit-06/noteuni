require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/db');
const requireAuth = require('./middleware/auth');
const Message = require('./models/Message');

const authRoutes = require('./routes/auth');
const notesRoutes = require('./routes/notes');
const pyqsRoutes = require('./routes/pyqs');
const dashboardRoutes = require('./routes/dashboard');
const chatRoutes = require('./routes/chat');

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: true,
  credentials: true,
};

const io = new Server(server, { 
  cors: { 
    origin: true, 
    methods: ['GET', 'POST'],
    credentials: true,
  } 
});

app.use(cors(corsOptions));
app.use(express.json());

// Uploaded notes/PYQs require a signed-in session (JWT via header or ?token=
// for iframe/download links). Filenames are sanitized against path traversal.
const UPLOADS_DIR = path.join(__dirname, 'uploads');
app.get('/uploads/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }
  res.sendFile(filePath);
});

// Serve frontend prototype
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'noteversity-prototype.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/pyqs', pyqsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/chat', chatRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---- Central error handler: multer problems → clean JSON 400, everything
// else → generic JSON 500 with the stack logged server-side only ----
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Maximum size is 20MB.'
      : 'Upload error: ' + err.code;
    return res.status(400).json({ message });
  }
  if (err && err.message && err.message.startsWith('Unsupported file type')) {
    return res.status(400).json({ message: err.message });
  }
  console.error('[Server Error]:', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

// ---- Socket.io real-time chat ----
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token || token === 'undefined' || token === 'null') {
    return next(new Error('Unauthorized socket connection'));
  }
  try {
    const secret = process.env.JWT_SECRET || 'noteversity_dev_secret_key_2026_jwt_token_secure';
    const decoded = jwt.verify(token, secret);
    socket.userId = decoded.userId;
    return next();
  } catch (err) {
    return next(new Error('Unauthorized socket connection'));
  }
});

io.on('connection', (socket) => {
  socket.on('join-room', (room) => {
    socket.join(room);
  });

  socket.on('send-message', async ({ room, text }) => {
    if (!text?.trim()) return;
    const message = await Message.create({ room, sender: socket.userId, text: text.trim() });
    const populated = await message.populate('sender', 'name');
    io.to(room).emit('new-message', populated);
  });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  server.listen(PORT, () => console.log(`Noteversity API running on port ${PORT}`));
});
