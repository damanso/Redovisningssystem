// VIKTIGT: config importeras FÖRST — den laddar .env och fail-fastar om
// JWT_SECRET saknas, innan någon annan modul hinner läsa miljön.
import { config } from './config.js';
import { assertAppRoleEnforcesRls, closePool } from './db/pool.js';
import { createApp } from './http/app.js';

// Fail-fast: vägra ta emot trafik om DATABASE_URL pekar på en roll som kringgår
// RLS (superuser/BYPASSRLS/tabellägare) — annars vore tenant-isoleringens andra
// lager tyst avstängt.
try {
  await assertAppRoleEnforcesRls();
} catch (err) {
  console.error(`FATAL: ${err instanceof Error ? err.message : err}`);
  await closePool();
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.PORT, config.HOST, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.PORT;
  console.log(`API lyssnar på ${config.HOST}:${port} (${config.NODE_ENV})`);
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
