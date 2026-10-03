const mongoose = require('mongoose');
const seedInitialData = require('./seeder');
const { IS_PROD } = require('./env');

function maskedUri(uri) {
  // Never log embedded credentials — show scheme + host + db only
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}`;
  } catch (e) {
    return '<unparseable mongo uri>';
  }
}

async function connectDB() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/noteversity';
  try {
    console.log(`Connecting to MongoDB at ${maskedUri(mongoUri)}...`);
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: IS_PROD ? 10000 : 2500,
    });
    console.log('MongoDB connected successfully');
    await seedInitialData();
  } catch (err) {
    if (IS_PROD) {
      // Serverless has no persistent disk — the in-memory fallback cannot save us.
      console.error('MongoDB connection failed in production:', err.message);
      throw err;
    }
    console.warn(`Could not connect to external MongoDB (${err.message}).`);
    console.log('Starting embedded in-memory MongoDB instance for development...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log(`Embedded MongoDB started and connected at ${maskedUri(uri)}`);
      await seedInitialData();
    } catch (memErr) {
      console.error('Failed to start embedded MongoDB:', memErr.message);
      process.exit(1);
    }
  }
}

module.exports = connectDB;
