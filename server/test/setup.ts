import { afterAll } from 'vitest';
import { applyTestEnv } from './env.js';

// Körs i varje worker INNAN testfilens imports — config.ts läser env vid import.
applyTestEnv();

afterAll(async () => {
  // Dynamisk import så att poolen inte skapas förrän env är satt.
  const { closePool } = await import('../src/db/pool.js');
  await closePool();
});
