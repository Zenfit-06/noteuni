const mongoose = require('mongoose');
const seedInitialData = require('./seeder');

async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/noteversity';
    console.log(`Connecting to MongoDB at ${mongoUri}...`);
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 2500,
    });
    console.log('MongoDB connected successfully');
    await seedInitialData();
  } catch (err) {
    console.warn(`Could not connect to external MongoDB (${err.message}).`);
    console.log('Starting embedded in-memory MongoDB instance for development...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log(`Embedded MongoDB started and connected at ${uri}`);
      await seedInitialData();
    } catch (memErr) {
      console.error('Failed to start embedded MongoDB:', memErr.message);
      process.exit(1);
    }
  }
}

module.exports = connectDB;
