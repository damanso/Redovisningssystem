// Delade hjälpfunktioner för mcp:install och mcp:token: hitta och läsa/skriva
// claude_desktop_config.json och plocka värden ur redovisning-blocket.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_KEY = 'redovisning';

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function mcpServerEntry() {
  return path.join(repoRoot(), 'server', 'dist', 'mcp', 'server.js');
}

/** Standardsökvägen till Claude Desktops config per plattform. */
export function defaultConfigPath() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i += 1; }
      else args[key] = true;
    }
  }
  return args;
}

export function readConfig(configPath) {
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, 'utf8');
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`kunde inte tolka ${configPath} som JSON: ${err.message}`);
  }
}

export function writeConfig(configPath, config) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Nuvarande env-värden i redovisning-blocket (om det finns). */
export function existingEnv(config) {
  return config?.mcpServers?.[SERVER_KEY]?.env ?? {};
}

/** exp ur ett JWT utan verifiering — bara för att kunna visa utgångsdatum. */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (!payload.exp) return null;
    const expiresAt = new Date(payload.exp * 1000);
    return {
      expiresAt,
      daysLeft: Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000),
    };
  } catch {
    return null;
  }
}
