// Acceptanskriterium (KICKOFF §4, Fas 0): "Env laddas före alla imports; appen
// VÄGRAR starta (fail-fast) om JWT_SECRET saknas." Gamla koden startade glatt
// och föll tillbaka på den publika hemligheten 'your-secret'.
import { spawn } from 'node:child_process';
import { loadavg } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function tsxBin(): string {
  const candidates = [
    path.join(serverDir, 'node_modules', '.bin', 'tsx'),
    path.join(serverDir, '..', 'node_modules', '.bin', 'tsx'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('hittar inte tsx-binären');
  return found;
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function startServer(
  env: Record<string, string>,
  opts: { killOnListen?: boolean } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin(), ['src/server.ts'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH ?? '',
        // Peka dotenv mot en fil som inte finns så att en lokal .env
        // inte kan smuggla in JWT_SECRET i testet.
        DOTENV_CONFIG_PATH: '/nonexistent/.env',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    // 60 s, inte 20. Den 25 augusti 2026 föll det här provet i en full svit
    // med tomma stdout OCH stderr — barnet hann inte skriva någonting alls.
    // `uptime` samtidigt: load average 3.85, 42.51, 32.98. Samma prov ensamt,
    // med last 3.85: 1,26 s. Provet mätte maskinens belastning, inte serverns
    // hälsa. Timeouten är fortfarande ändlig: en oändlig hade bytt en flaka
    // mot en hängning, vilket är sämre.
    const VANTAN_MS = 60_000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const last = loadavg().map((n) => n.toFixed(2)).join(', ');
      const skrev = stdout.length === 0 && stderr.length === 0
        ? 'barnet skrev INGENTING alls — det hann troligen inte starta'
        : 'barnet skrev något, men inte startraden';
      reject(new Error(
        `timeout efter ${VANTAN_MS / 1000} s. ${skrev}.\n` +
        `load average vid timeout: ${last}\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`,
      ));
    }, VANTAN_MS);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (opts.killOnListen && stdout.includes('API lyssnar')) {
        clearTimeout(timer);
        child.kill('SIGKILL');
        resolve({ code: null, stdout, stderr });
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', reject);
  });
}

describe('fail-fast vid start', () => {
  it('utan JWT_SECRET: processen vägrar starta med tydligt fel', async () => {
    const result = await startServer({
      DATABASE_URL: process.env.DATABASE_URL!,
      PORT: '0',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('JWT_SECRET');
    expect(result.stdout).not.toContain('API lyssnar');
  });

  it('med för kort JWT_SECRET: processen vägrar starta', async () => {
    const result = await startServer({
      DATABASE_URL: process.env.DATABASE_URL!,
      JWT_SECRET: 'kort',
      PORT: '0',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('JWT_SECRET');
  });

  it('med giltig JWT_SECRET: servern startar', async () => {
    const result = await startServer(
      {
        DATABASE_URL: process.env.DATABASE_URL!,
        JWT_SECRET: process.env.JWT_SECRET!,
        PORT: '0',
        NODE_ENV: 'test',
      },
      { killOnListen: true },
    );
    expect(result.stdout).toContain('API lyssnar');
  });
});
