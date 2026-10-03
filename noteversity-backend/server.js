/**
 * Development bootstrap: runs the Express app as a normal local server.
 * Production runs the same app through api/index.js on Vercel.
 */
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  http.createServer(app).listen(PORT, () => {
    console.log(`Noteversity server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
