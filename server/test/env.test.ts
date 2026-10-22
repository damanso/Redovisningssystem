import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const databaseNames = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'MAINTENANCE_DATABASE_URL'];
const envModule = new URL('./env.ts', import.meta.url).href;
// Barnet importerar bara miljöfunktionen, aldrig pg, setup eller migrate.
// Därmed kan inget av de avvisade värdena öppna en databasanslutning.
const program = `
  import { applyTestEnv } from ${JSON.stringify(envModule)};
  applyTestEnv();
  process.stdout.write(JSON.stringify(${JSON.stringify(databaseNames)}.map((name) => {
    const url = new URL(process.env[name]);
    return [url.hostname, url.port];
  })));
`;

function applyInChild(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', program], {
    // Ingen ärvd TEST_*- eller dotenv-konfiguration. De vanliga variablerna
    // ska skrivas över även om de redan pekar utanför testmiljön.
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: 'postgres://127.0.0.1:5434/otillaten',
      DATABASE_ADMIN_URL: 'postgres://127.0.0.1:5434/otillaten',
      MAINTENANCE_DATABASE_URL: 'postgres://127.0.0.1:5434/otillaten',
      ...overrides,
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

type Fall = { label: string; value: string; reason: string };
const urlCases: Fall[] = [
  { label: 'driftport', value: 'postgres://127.0.0.1:5434/test', reason: 'porten' },
  { label: 'annan värd', value: 'postgres://localhost:5433/test', reason: 'värden' },
  { label: 'lösenord och otillåten port', value: 'postgres://skyddad-anvandare:hemligt@127.0.0.1:5999/test', reason: 'porten' },
  { label: 'otolkbar URL med lösenord', value: 'postgres://skyddad-anvandare:hemligt@[ogiltig/test', reason: 'går inte att tolka' },
  { label: 'värd i frågeparameter', value: 'postgres://127.0.0.1:5433/test?host=localhost', reason: 'värden' },
  { label: 'port i frågeparameter', value: 'postgres://127.0.0.1:5433/test?port=5434', reason: 'porten' },
  { label: 'annat protokoll', value: 'http://127.0.0.1:5433/test', reason: 'Postgres-URL' },
];
const inputs: { name: string; resolvedName: string; cases: Fall[] }[] = [
  {
    name: 'TEST_PG_HOST', resolvedName: 'DATABASE_URL', cases: [
      { label: 'driftport via värddelen', value: '127.0.0.1:5434/test?', reason: 'porten' },
      { label: 'annan värd', value: 'localhost', reason: 'värden' },
      { label: 'URL med lösenord', value: 'skyddad-anvandare:hemligt@localhost', reason: 'värden' },
      { label: 'otolkbar URL', value: '[ogiltig', reason: 'går inte att tolka' },
    ],
  },
  {
    name: 'TEST_PG_PORT', resolvedName: 'DATABASE_URL', cases: [
      { label: 'driftport', value: '5434', reason: 'porten' },
      { label: 'annan värd via portdelen', value: '5433@localhost:5433', reason: 'värden' },
      { label: 'URL med lösenord', value: '5433@skyddad-anvandare:hemligt@localhost:5433', reason: 'värden' },
      { label: 'otolkbar URL', value: 'ogiltig', reason: 'går inte att tolka' },
    ],
  },
  ...databaseNames.map((name) => ({ name: `TEST_${name}`, resolvedName: name, cases: urlCases })),
];

describe('testmiljöns tillåtelselista före pg', () => {
  it('godtar standardmiljön och skriver över vanliga databasvariabler', () => {
    const result = applyInChild();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(databaseNames.map(() => ['127.0.0.1', '5433']));
  });

  it('godtar uttryckliga TEST_*-värden på tillåten värd och port', () => {
    const result = applyInChild({
      TEST_PG_HOST: '127.0.0.1', TEST_PG_PORT: '5433',
      ...Object.fromEntries(databaseNames.map((name) => [
        `TEST_${name}`, 'postgresql://127.0.0.1:5433/test',
      ])),
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(databaseNames.map(() => ['127.0.0.1', '5433']));
  });

  for (const { name, resolvedName, cases } of inputs) {
    describe(name, () => {
      it.each(cases)('avvisar $label utan att skriva anslutningsuppgifter', ({ value, reason }) => {
        const result = applyInChild({ [name]: value });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`Testspärr: ${resolvedName}:`);
        expect(result.stderr).toContain(reason);
        expect(result.stdout).toBe('');
        const output = result.stdout + result.stderr;
        expect(output).not.toContain('hemligt');
        expect(output).not.toContain('skyddad-anvandare');
        expect(output).not.toContain('postgres://');
        expect(output).not.toContain(value);
        expect(output).not.toContain('ECONNREFUSED');
      });
    });
  }
});
