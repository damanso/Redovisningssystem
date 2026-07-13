// VIKTIGT: config importeras FÖRST — den laddar .env och fail-fastar om
// JWT_SECRET saknas, innan någon annan modul hinner läsa miljön.
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { createApp } from './http/app.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.PORT;
  console.log(`API lyssnar på port ${port} (${config.NODE_ENV})`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} mottagen — stänger ner`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  // Tvinga exit om aktiva anslutningar håller processen vid liv
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
