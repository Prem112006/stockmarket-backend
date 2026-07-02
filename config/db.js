const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    const err = new Error('MONGO_URI is not set in environment variables');
    err.statusCode = 500;
    throw err;
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
};

module.exports = connectDB;
