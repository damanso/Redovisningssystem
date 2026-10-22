// Story 8.4, FR-23: en ny väg ut till en kund får aldrig förbli osedd.
// Lagren är källträdets importgraf, registrets CRM-åtgärder och dagsytan.
// Negativa kontroller med planterade brott körs före motsvarande källträdsprov.
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { ACTIONS } from '../src/actions/registry.js';
import { api, app, createCompany, registerUser } from './helpers.js';
import {
  CRM_ATGARDER, EPOST, REGISTER, TILLATNA_KOSKRIVARE, TILLATNA_SANDVAGAR,
  crmbrister, crmsidan, handlerbrister, handlermoduler, installningsbrister, koskrivarbrister,
  provaN1, provaN2, provaN3, provaN4, sandvagsbrister, sandvagsmangd,
} from './sandvagHelper.js';

/** Hela server/src med samma modulnycklar som utskicksprovet. */
async function kodbasen(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) filer.set(fil.split('\\').join('/'), await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}
/** Migrationerna läses som text; inga databasskrivningar görs av kontrollen. */
async function migrationerna(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.sql')) filer.set(`migrations/${fil.split('\\').join('/')}`, await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}
const CRM_TJANSTER = [
  'services/crm.ts', 'services/crmDerivations.ts', 'services/crmIngest.ts', 'services/crmMerge.ts',
  'services/crmProvenance.ts', 'services/crmRelations.ts', 'services/crmStadning.ts', 'services/crmThread.ts',
];
const MENING = 'Ingenting går härifrån ut till en kund';
const crmnamn = () => ACTIONS.map((a) => a.name).filter((n) => n.includes('crm') || n === 'log_contact');

describe('CRM:s sändspärr är kod och ingen inställning (FR-23)', () => {
  const korda = new Set<string>();
  it('N1 grafen fäller varje planterad sändväg med rätt kontroll', () => {
    provaN1();
    korda.add('N1');
  });
  it('S1 sändvägsmängden motsvarar exakt dagens tillåtelselista', async () => {
    const filer = await kodbasen();
    expect(filer.size).toBeGreaterThanOrEqual(140);
    for (const fil of [REGISTER, EPOST, 'services/notifications.ts']) expect(filer.has(fil), fil).toBe(true);
    expect(sandvagsmangd(filer)).toEqual(expect.arrayContaining([REGISTER, 'services/notifications.ts']));
    expect(sandvagsbrister(filer, TILLATNA_SANDVAGAR)).toEqual([]);
    expect(TILLATNA_SANDVAGAR).toHaveLength(36);
    expect(new Set(TILLATNA_SANDVAGAR).size).toBe(36);
    korda.add('S1');
  });
  it('S2 ingen CRM-tjänst når e-postkön, också utanför registrets graf', async () => {
    const filer = await kodbasen();
    for (const fil of CRM_TJANSTER) expect(filer.has(fil), fil).toBe(true);
    expect(crmbrister(filer)).toEqual([]);
    korda.add('S2');
  });
  it('N4 kölistan fäller SQL utan import och en inaktuell tillåtelse', () => {
    provaN4();
    korda.add('N4');
  });
  it('S4 e-postköns tabell nämns bara i de tre granskade filerna', async () => {
    const migrationer = await migrationerna();
    expect(migrationer.size).toBeGreaterThanOrEqual(80);
    expect(migrationer.has('migrations/0021_notifications.sql')).toBe(true);
    expect(koskrivarbrister(new Map([...await kodbasen(), ...migrationer]), TILLATNA_KOSKRIVARE)).toEqual([]);
    expect(TILLATNA_KOSKRIVARE).toHaveLength(3);
    expect(new Set(TILLATNA_KOSKRIVARE).size).toBe(3);
    korda.add('S4');
  });
  it('N2 handlersvepet fäller sändande handlers, saknade block och vägar genom ACTIONS', () => {
    provaN2();
    korda.add('N2');
  });
  it('S3 varje CRM-åtgärd sveps och de två modulankarna håller', async () => {
    const filer = await kodbasen();
    const namn = crmnamn();
    expect(namn).toEqual(expect.arrayContaining([...CRM_ATGARDER]));
    expect(handlerbrister(filer, namn)).toEqual([]);
    expect(handlermoduler(filer, 'log_contact')).toEqual(['lib/validation.ts', 'services/crmRelations.ts']);
    expect(handlermoduler(filer, 'ingest_crm_events')).toEqual(['lib/validation.ts', 'services/crmIngest.ts']);
    korda.add('S3');
  });
  it('N3 inställningskontrollen fäller config på båda CRM-sidorna och ett direkt köanrop', () => {
    provaN3();
    korda.add('N3');
  });
  it('D1 en inloggad dagsyta med ett kort bär fortfarande spärrtexten', async () => {
    const user = await registerUser('sandvag');
    const companyId = await createCompany(user.token, 'Sändvägen AB');
    const ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, JSON.stringify(login.body)).toBe(302);
    const org = await api.post(`/api/companies/${companyId}/actions/upsert_crm_organization`)
      .set('Authorization', `Bearer ${user.token}`).send({ name: 'Tysta Relationen AB' });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    const sida = await ua.get(`/app/c/${companyId}/idag`);
    expect(sida.status, JSON.stringify(sida.body)).toBe(200);
    expect((sida.text.match(/class="today__card"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(sida.text).toContain(MENING);
    korda.add('D1');
  });
  it('D2 spärrtexten har exakt en förekomst i källträdet, i dagsytans rendering', async () => {
    const forekomster = [...await kodbasen()].flatMap(([fil, text]) => Array<string>(text.split(MENING).length - 1).fill(fil));
    expect(forekomster).toEqual(['http/view/routes.ts']);
    korda.add('D2');
  });
  it('D3 CRM-sidan omfattar tjänster och handlers och importerar aldrig config', async () => {
    const filer = await kodbasen();
    const namn = crmnamn();
    expect(crmsidan(filer, namn)).toEqual(expect.arrayContaining([...CRM_TJANSTER, 'lib/validation.ts']));
    expect(installningsbrister(filer, namn)).toEqual([]);
    korda.add('D3');
  });
  it('KV alla elva fall före kontrollvakten kördes till slut', () => {
    expect([...korda].sort()).toEqual(['D1', 'D2', 'D3', 'N1', 'N2', 'N3', 'N4', 'S1', 'S2', 'S3', 'S4']);
  });
});
