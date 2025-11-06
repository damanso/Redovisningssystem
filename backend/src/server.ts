import app from './app.js';
import dotenv from 'dotenv';
import pool from './config/database.js';
import { connectMongoDB, closeMongoDB } from './config/mongodb.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Test PostgreSQL connection (non-blocking)
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('⚠ PostgreSQL connection warning:', err.message);
    console.log('  Server will continue, but database operations may fail');
  } else {
    console.log('✓ PostgreSQL connected successfully');
  }
});

// Connect to MongoDB (non-blocking)
connectMongoDB().catch((err) => {
  console.error('⚠ MongoDB connection warning:', err.message);
  console.log('  Server will continue, but chatbot features may fail');
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ API available at http://localhost:${PORT}/api/v1`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    await closeMongoDB();
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    await closeMongoDB();
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});
