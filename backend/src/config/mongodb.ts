import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/redovisning';

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Connect to MongoDB
 */
export const connectMongoDB = async (): Promise<Db> => {
  if (db) {
    return db;
  }

  try {
    client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db();
    console.log('✓ MongoDB connected successfully');
    return db;
  } catch (error) {
    console.error('⚠ MongoDB connection error:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

/**
 * Get MongoDB database instance
 */
export const getDB = (): Db => {
  if (!db) {
    throw new Error('MongoDB not connected. Call connectMongoDB() first.');
  }
  return db;
};

/**
 * Close MongoDB connection
 */
export const closeMongoDB = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
};

export default { connectMongoDB, getDB, closeMongoDB };
