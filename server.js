const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const stockRoutes = require('./routes/stockRoutes');
const predictionRoutes = require('./routes/predictionRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const sentimentRoutes = require('./routes/sentimentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const http = require('http');
const socketIo = require('socket.io');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.json({ message: 'Stock Market Prediction Backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/prediction', predictionRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/sentiment', sentimentRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    message: err.message || 'Server error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
});

const PORT = process.env.PORT || 5000;

// Set up server and Socket.io for active user tracking
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

let activeConnections = 0;
io.on('connection', (socket) => {
  activeConnections++;
  global.activeUsersCount = activeConnections;
  io.emit('activeUsers', activeConnections);

  socket.on('disconnect', () => {
    activeConnections = Math.max(0, activeConnections - 1);
    global.activeUsersCount = activeConnections;
    io.emit('activeUsers', activeConnections);
  });
});

connectDB()
  .then(() => {
    if (!process.env.VERCEL) {
      server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} already in use. Please stop the other process or use a different PORT.`);
          process.exit(1);
        } else {
          console.error('Server error:', err);
          process.exit(1);
        }
      });
    } else {
      console.log('MongoDB connected successfully (running on Vercel)');
    }
  })
  .catch((err) => {
    console.error('Failed to start database connection:', err);
  });

module.exports = app;
