import app from './app.js';
import dotenv from 'dotenv';
import pool from './config/database.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Test database connection (non-blocking)
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('⚠ Database connection warning:', err.message);
    console.log('  Server will continue, but database operations may fail');
  } else {
    console.log('✓ Database connected successfully');
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ API available at http://localhost:${PORT}/api/v1`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});
