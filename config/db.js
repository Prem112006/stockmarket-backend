const mongoose = require('mongoose');

let cachedConnection = null;

const connectDB = async () => {
  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If a connection is already in progress, await it
  if (cachedConnection) {
    return cachedConnection;
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    const err = new Error('MONGO_URI is not set in environment variables');
    err.statusCode = 500;
    throw err;
  }

  mongoose.set('strictQuery', true);
  mongoose.set('bufferCommands', false); // Fail fast, no query buffering

  cachedConnection = mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000 // 5 seconds timeout
  }).then((mongooseInstance) => {
    console.log('MongoDB connected successfully');
    return mongooseInstance;
  }).catch((err) => {
    cachedConnection = null; // Reset cache on failure so we can retry on next request
    console.error('Failed to establish MongoDB connection:', err.message);
    throw err;
  });

  return cachedConnection;
};

module.exports = connectDB;
