#!/usr/bin/env node
// K5: `npm run mcp:install` — skriver/reparerar redovisning-blocket i
// claude_desktop_config.json (path till server/dist/mcp/server.js, API-URL,
// company-id, agent-token) och verifierar med ett testanrop. Idempotent —
// kör den efter varje appuppdatering; befintliga värden i blocket behålls
// om inget nytt anges via flaggor eller env.
//
//   node scripts/mcp-install.mjs [--config <path>] [--api-url <url>]
//                                [--company-id <uuid>] [--token <jwt>]
//                                [--server-entry <path>] [--skip-verify]
//
// Värdeprioritet: flagga > env (REDOVISNING_*) > befintligt config-block > default.
import { existsSync } from 'node:fs';
import {
  defaultConfigPath, existingEnv, mcpServerEntry, parseArgs,
  readConfig, SERVER_KEY, tokenExpiry, writeConfig,
} from './mcp-config.mjs';

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? defaultConfigPath();

let config;
try {
  config = readConfig(configPath);
} catch (err) {
  console.error(`FEL: ${err.message}`);
  console.error('Rätta filen för hand eller peka på en annan med --config.');
  process.exit(1);
}
const previous = existingEnv(config);

const apiUrl = (args['api-url'] ?? process.env.REDOVISNING_API_URL ?? previous.REDOVISNING_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const companyId = args['company-id'] ?? process.env.REDOVISNING_COMPANY_ID ?? previous.REDOVISNING_COMPANY_ID;
const token = args.token ?? process.env.REDOVISNING_AGENT_TOKEN ?? previous.REDOVISNING_AGENT_TOKEN;

const problems = [];
if (!companyId) problems.push('company-id saknas (--company-id, REDOVISNING_COMPANY_ID eller befintligt block)');
if (!token) problems.push('agent-token saknas (--token, REDOVISNING_AGENT_TOKEN eller befintligt block) — minta med `npm run mcp:token`');

const entry = args['server-entry'] ?? mcpServerEntry();
if (!existsSync(entry)) {
  problems.push(`byggd MCP-server saknas (${entry}) — kör \`npm run build -w server\` först`);
}

config.mcpServers = config.mcpServers ?? {};
config.mcpServers[SERVER_KEY] = {
  command: 'node',
  args: [entry],
  env: {
    REDOVISNING_API_URL: apiUrl,
    ...(companyId ? { REDOVISNING_COMPANY_ID: companyId } : {}),
    ...(token ? { REDOVISNING_AGENT_TOKEN: token } : {}),
  },
};
writeConfig(configPath, config);
console.log(`✓ redovisning-blocket skrivet i ${configPath}`);
console.log(`  server : ${entry}`);
console.log(`  api    : ${apiUrl}`);
console.log(`  bolag  : ${companyId ?? '(saknas)'}`);

if (token) {
  const expiry = tokenExpiry(token);
  if (expiry) {
    const note = expiry.daysLeft <= 14 ? '  ⚠ förnya snart med `npm run mcp:token`' : '';
    console.log(`  token  : går ut ${expiry.expiresAt.toISOString().slice(0, 10)} (${expiry.daysLeft} dagar kvar)${note}`);
  }
}

for (const p of problems) console.error(`⚠ ${p}`);

// Verifiering: /health + manifestanropet med tokenet — samma väg som MCP-servern tar.
if (!args['skip-verify']) {
  if (!companyId || !token) {
    console.error('⚠ verifiering hoppas över — komplettera värdena ovan och kör om.');
    process.exit(problems.length ? 1 : 0);
  }
  try {
    const health = await fetch(`${apiUrl}/health`);
    console.log(`  /health: HTTP ${health.status}${health.ok ? ' ✓' : ' ⚠'}`);
    const manifest = await fetch(`${apiUrl}/api/companies/${companyId}/actions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (manifest.status === 200) {
      const body = await manifest.json();
      console.log(`  manifest: ${body.actions?.length ?? '?'} actions ✓`);
    } else {
      console.error(`⚠ manifestanropet gav HTTP ${manifest.status} — kontrollera token/company-id.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`⚠ kunde inte nå API:t på ${apiUrl}: ${err.message}`);
    console.error('  (configen är skriven — starta API:t och kör om för verifiering, eller använd --skip-verify)');
    process.exit(1);
  }
}
process.exit(problems.length ? 1 : 0);
