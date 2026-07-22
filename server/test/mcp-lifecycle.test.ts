// K5: MCP-setup och token-livscykel. npm run mcp:install skriver/reparerar
// redovisning-blocket i claude_desktop_config.json idempotent och verifierar
// mot API:t; npm run mcp:token förnyar agent-tokenet efter ÄGARINLOGGNING
// (människan i loopen); agent-tokens kan mintas med upp till 90 dagars
// giltighet (de kan bara begära, aldrig godkänna).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

// Filbaserade sökvägar (inte cwd) så testet fungerar oavsett var vitest körs.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, '..', '..');
const INSTALL = path.join(ROOT, 'scripts', 'mcp-install.mjs');
const TOKEN_SCRIPT = path.join(ROOT, 'scripts', 'mcp-token.mjs');
// En fil som garanterat finns — dist/ byggs inte av testsviten.
const ENTRY = path.resolve(TEST_DIR, '..', 'src', 'mcp', 'server.ts');

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let user: TestUser;
let companyId: string;
let agentToken: string;
let tmp: string;

function runScript(
  script: string, args: string[], opts: { stdinLines?: string[] } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { stdout += d; });
    child.stderr.on('data', (d: string) => { stderr += d; });
    if (opts.stdinLines) {
      // Vänta in prompterna innan svaren skrivs (readline i följd).
      let i = 0;
      const feed = () => {
        if (i < opts.stdinLines!.length) { child.stdin.write(`${opts.stdinLines![i]}\n`); i += 1; setTimeout(feed, 150); }
      };
      setTimeout(feed, 300);
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

beforeAll(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  tmp = mkdtempSync(path.join(tmpdir(), 'mcp-lifecycle-'));

  user = await registerUser('mcplife');
  companyId = await createCompany(user.token, 'Livscykel AB');
  const tok = await api.post(`/api/companies/${companyId}/agent-tokens`)
    .set({ Authorization: `Bearer ${user.token}` }).send({ name: 'Cowork', ttl_days: 90 });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('agent-tokens med förlängd giltighet', () => {
  it('ttl_days=90 ger ~90 dagars expires_at', async () => {
    const res = await api.post(`/api/companies/${companyId}/agent-tokens`)
      .set({ Authorization: `Bearer ${user.token}` }).send({ ttl_days: 90 });
    expect(res.status).toBe(201);
    expect(res.body.expires_in).toBe(90 * 24 * 60 * 60);
    const days = (new Date(res.body.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('mer än 90 dagar avvisas', async () => {
    const res = await api.post(`/api/companies/${companyId}/agent-tokens`)
      .set({ Authorization: `Bearer ${user.token}` }).send({ ttl_days: 91 });
    expect(res.status).toBe(400);
  });
});

describe('npm run mcp:install', () => {
  it('skriver redovisning-blocket från noll och verifierar mot API:t', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    const res = await runScript(INSTALL, [
      '--config', cfg, '--api-url', baseUrl, '--company-id', companyId,
      '--token', agentToken, '--server-entry', ENTRY,
    ]);
    expect(res.code, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('/health: HTTP 200');
    expect(res.stdout).toMatch(/manifest: \d+ actions/);
    expect(res.stdout).toMatch(/går ut \d{4}-\d{2}-\d{2} \(\d+ dagar kvar\)/);

    const written = JSON.parse(readFileSync(cfg, 'utf8'));
    // Absolut node-sökväg (a46fa86): GUI-appar (Claude Desktop) saknar nvm-PATH.
    expect(written.mcpServers.redovisning.command).toBe(process.execPath);
    expect(written.mcpServers.redovisning.args).toEqual([ENTRY]);
    expect(written.mcpServers.redovisning.env.REDOVISNING_COMPANY_ID).toBe(companyId);
    expect(written.mcpServers.redovisning.env.REDOVISNING_AGENT_TOKEN).toBe(agentToken);
  });

  it('reparerar ett raderat block idempotent och rör inte andra servrar', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    // Simulera scenariot från lönekörningen: blocket har försvunnit ur configen.
    const damaged = { mcpServers: { other: { command: 'other-server', args: [] } } };
    writeFileSync(cfg, JSON.stringify(damaged));
    // Utan flaggor finns inga värden kvar → komplettera; med flaggor repareras.
    const res = await runScript(INSTALL, [
      '--config', cfg, '--api-url', baseUrl, '--company-id', companyId,
      '--token', agentToken, '--server-entry', ENTRY,
    ]);
    expect(res.code, res.stdout + res.stderr).toBe(0);
    const repaired = JSON.parse(readFileSync(cfg, 'utf8'));
    expect(repaired.mcpServers.other.command).toBe('other-server'); // orörd
    expect(repaired.mcpServers.redovisning.env.REDOVISNING_COMPANY_ID).toBe(companyId);

    // Omkörning utan flaggor: värdena läses ur befintligt block (idempotent).
    const again = await runScript(INSTALL, ['--config', cfg, '--server-entry', ENTRY]);
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(JSON.parse(readFileSync(cfg, 'utf8'))).toEqual(repaired);
  });

  it('ogiltigt token ger tydligt fel och exit 1', async () => {
    const cfg = path.join(tmp, 'broken.json');
    const res = await runScript(INSTALL, [
      '--config', cfg, '--api-url', baseUrl, '--company-id', companyId,
      '--token', 'ogiltigt.token.här', '--server-entry', ENTRY,
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('manifestanropet gav HTTP 401');
  });
});

describe('npm run mcp:token (tokenförnyelse med ägarinloggning)', () => {
  it('loggar in, mintar 90-dagarstoken och uppdaterar configen', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    const before = JSON.parse(readFileSync(cfg, 'utf8'));
    const res = await runScript(TOKEN_SCRIPT, [
      '--config', cfg, '--api-url', baseUrl, '--company-id', companyId, '--email', user.email,
    ], { stdinLines: ['mycket-hemligt-losen-123'] });
    expect(res.code, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/går ut: \d{4}-\d{2}-\d{2}/);
    const after = JSON.parse(readFileSync(cfg, 'utf8'));
    expect(after.mcpServers.redovisning.env.REDOVISNING_AGENT_TOKEN).not.toBe(before.mcpServers.redovisning.env.REDOVISNING_AGENT_TOKEN);
    // Det nya tokenet fungerar mot action-API:t.
    const probe = await api.post(`/api/companies/${companyId}/actions/list_fiscal_years`)
      .set({ Authorization: `Bearer ${after.mcpServers.redovisning.env.REDOVISNING_AGENT_TOKEN}` }).send({});
    expect(probe.status).toBe(200);
  });

  it('fel lösenord ger exit 1 utan configändring', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    const before = readFileSync(cfg, 'utf8');
    const res = await runScript(TOKEN_SCRIPT, [
      '--config', cfg, '--api-url', baseUrl, '--company-id', companyId, '--email', user.email,
    ], { stdinLines: ['fel-losenord'] });
    expect(res.code).toBe(1);
    expect(readFileSync(cfg, 'utf8')).toBe(before);
  });
});
