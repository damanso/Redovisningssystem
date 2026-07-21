#!/usr/bin/env node
// K5: `npm run mcp:token` — förnyar agent-tokenet utan handpåläggning i övrigt:
// loggar in som ÄGARE (människan i loopen behålls — inga sparade lösenord),
// mintar ett nytt företagsscopat agent-token, uppdaterar redovisning-blocket i
// claude_desktop_config.json och skriver ut utgångsdatumet.
//
//   node scripts/mcp-token.mjs [--config <path>] [--api-url <url>]
//                              [--company-id <uuid>] [--ttl-days <1-90>]
//                              [--email <ägarens e-post>]
//
// Agent-tokens kan bara BEGÄRA actions, aldrig godkänna — därför är standard-
// giltigheten här 90 dagar (maxvärdet servern tillåter).
import { createInterface } from 'node:readline';
import {
  defaultConfigPath, existingEnv, parseArgs, readConfig, SERVER_KEY, tokenExpiry, writeConfig,
} from './mcp-config.mjs';

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? defaultConfigPath();
const config = readConfig(configPath);
const previous = existingEnv(config);

const apiUrl = (args['api-url'] ?? process.env.REDOVISNING_API_URL ?? previous.REDOVISNING_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const companyId = args['company-id'] ?? process.env.REDOVISNING_COMPANY_ID ?? previous.REDOVISNING_COMPANY_ID;
const ttlDays = Number(args['ttl-days'] ?? 90);

if (!companyId) {
  console.error('FEL: company-id saknas (--company-id, REDOVISNING_COMPANY_ID eller befintligt config-block).');
  process.exit(1);
}
if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 90) {
  console.error('FEL: --ttl-days måste vara 1–90.');
  process.exit(1);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hidden) {
      // Dölj inmatningen: skriv frågan själva och tysta echo:t.
      process.stderr.write(question);
      const original = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = (s) => { if (s.includes('\n') || s.includes('\r')) original?.(s); };
      rl.question('', (answer) => { process.stderr.write('\n'); rl.close(); resolve(answer); });
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

const email = args.email ?? (await ask('Ägarens e-post: '));
const password = await ask('Lösenord: ', { hidden: true });

let login;
try {
  login = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
} catch (err) {
  console.error(`FEL: kunde inte nå API:t på ${apiUrl}: ${err.message}`);
  process.exit(1);
}
if (login.status !== 200) {
  console.error(`FEL: inloggningen misslyckades (HTTP ${login.status}).`);
  process.exit(1);
}
const { token: humanToken } = await login.json();

const mint = await fetch(`${apiUrl}/api/companies/${companyId}/agent-tokens`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${humanToken}` },
  body: JSON.stringify({ name: 'mcp-token-script', ttl_days: ttlDays }),
});
if (mint.status !== 201) {
  const body = await mint.text();
  console.error(`FEL: kunde inte minta agent-token (HTTP ${mint.status}): ${body}`);
  console.error('Kontrollera att kontot är ÄGARE i bolaget.');
  process.exit(1);
}
const minted = await mint.json();

config.mcpServers = config.mcpServers ?? {};
config.mcpServers[SERVER_KEY] = config.mcpServers[SERVER_KEY] ?? { command: 'node', args: [], env: {} };
config.mcpServers[SERVER_KEY].env = {
  ...config.mcpServers[SERVER_KEY].env,
  REDOVISNING_API_URL: apiUrl,
  REDOVISNING_COMPANY_ID: companyId,
  REDOVISNING_AGENT_TOKEN: minted.token,
};
writeConfig(configPath, config);

const expiry = minted.expires_at ?? tokenExpiry(minted.token)?.expiresAt?.toISOString();
console.log(`✓ nytt agent-token (${ttlDays} dagar) skrivet till ${configPath}`);
console.log(`  går ut: ${String(expiry).slice(0, 10)}`);
console.log('  Starta om Claude Desktop/Cowork-anslutningen så det nya tokenet läses in.');
// Explicit exit: en piped/interaktiv stdin håller annars event-loopen vid liv.
process.exit(0);
