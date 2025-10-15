import { Pool } from 'pg';

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'redovisning',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

console.log('Database config:', { ...config, password: '***' });

const pool = new Pool(config);

export const query = async (text: string, params?: any[]) => {
  const res = await pool.query(text, params);
  return res;
};

export default pool;
