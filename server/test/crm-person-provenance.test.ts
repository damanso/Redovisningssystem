// FR-8 avsteg 1 (crm 1.9): personens external_ref (länken till personkortet) och
// notes bär ursprung och skyddas när en människa satt dem, så att nästa nattsynk
// inte skriver över en rättelse. Prövar också låsordningen i upsertPerson
// (A-1 (3) och (5)): organisationerna, sedan personens rad, sist vakten.
// Genom hela stacken: åtgärden och intaget över HTTP med människans nyckel och
// agentens token; facit läses direkt ur databasen och ur dokumenten.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let a: TestUser;
let b: TestUser;
let companyA: string;
let companyB: string;
let agentToken: string;

beforeAll(async () => {
  a = await registerUser('personursprung-a');
  b = await registerUser('personursprung-b');
  companyA = await createCompany(a.token, 'Personursprung A');
  companyB = await createCompany(b.token, 'Personursprung B');
  const token = await api.post(`/api/companies/${companyA}/agent-tokens`)
    .set('Authorization', `Bearer ${a.token}`).send({ name: 'Personursprungsagent' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token;
});

const action = (name: string, input: Record<string, unknown>, token = a.token) =>
  api.post(`/api/companies/${companyA}/actions/${name}`).set('Authorization', `Bearer ${token}`).send(input);
async function act(name: string, input: Record<string, unknown>, token = a.token) {
  const r = await action(name, input, token);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
/** Intagets svar som det är, också när en händelse hamnat i `skipped`. */
async function ingestRaw(events: Record<string, unknown>[]) {
  return act('ingest_crm_events', { events });
}
async function ingest(event: Record<string, unknown>) {
  const r = await ingestRaw([event]);
  expect(r.skipped).toEqual([]);
  return r;
}
/** En kontaktpunkt som bär personen; utan organisation när `org` är null. */
function personHandelse(sourceRef: string, org: string | null, person: Record<string, string>) {
  return {
    kind: 'interaction', ...(org === null ? {} : { organization: { name: org } }), person,
    occurred_at: '2026-11-01T10:00:00Z', source_system: 'gmail', source_ref: sourceRef,
    channel: 'email', direction: 'inbound', summary: 'Möte om personkortet',
  };
}

type PersonRad = {
  name: string; email: string | null; organization_id: string | null; external_ref: string | null;
  notes: string | null; sfar: string; role_title: string | null;
};
type Ursprung = { field: string; source: string; source_system: string | null; source_ref: string | null };

async function personRad(id: string): Promise<PersonRad> {
  const rad = await withAdmin(async (db) => (await db.query<PersonRad>(
    `SELECT name, email, organization_id, external_ref, notes, sfar, role_title
     FROM crm.people WHERE company_id = $1 AND id = $2`, [companyA, id])).rows[0]);
  expect(rad, `personen ${id}`).toBeDefined();
  return rad!;
}
async function personUrsprung(id: string): Promise<Ursprung[]> {
  return withAdmin(async (db) => (await db.query<Ursprung>(
    `SELECT field, source, source_system, source_ref FROM crm.field_provenance
     WHERE company_id = $1 AND person_id = $2 ORDER BY field`, [companyA, id])).rows);
}
async function personAudit(id: string, auditAction: string): Promise<number> {
  return withAdmin(async (db) => (await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = $3',
    [companyA, id, auditAction])).rows[0]!.n);
}
/** Intaget svarar inte med personens id; e-posten är unik i fallets namnrymd. */
async function personPaEpost(email: string): Promise<string> {
  const id = await withAdmin(async (db) => (await db.query<{ id: string }>(
    'SELECT id FROM crm.people WHERE company_id = $1 AND lower(email) = lower($2)', [companyA, email])).rows[0]?.id);
  expect(id, email).toBeDefined();
  return id!;
}
/** Ursprunget för just kortlänken och anteckningen, som [fält, källa]. */
async function tvaFaltensUrsprung(id: string): Promise<string[][]> {
  return (await personUrsprung(id))
    .filter((p) => p.field === 'external_ref' || p.field === 'notes')
    .map((p) => [p.field, p.source]);
}

describe('Ursprunget och skyddet (story 1.9)', () => {
  it('PP1 ursprunget skrivs när personen skapas: människan ger human och agenten ai', async () => {
    const manniska = await act('upsert_crm_person',
      { name: 'PP1 Människa', external_ref: 'kontakter/pp1-manniska', notes: 'Människans anteckning' });
    const agent = await act('upsert_crm_person',
      { name: 'PP1 Agent', external_ref: 'kontakter/pp1-agent', notes: 'Agentens anteckning' }, agentToken);
    expect(manniska).toMatchObject({ created: true, external_ref: 'kontakter/pp1-manniska', notes: 'Människans anteckning' });
    expect(agent).toMatchObject({ created: true, external_ref: 'kontakter/pp1-agent', notes: 'Agentens anteckning' });
    expect(await tvaFaltensUrsprung(manniska.id)).toEqual([['external_ref', 'human'], ['notes', 'human']]);
    expect(await tvaFaltensUrsprung(agent.id)).toEqual([['external_ref', 'ai'], ['notes', 'ai']]);
  });

  it('PP2 intaget med ett annat external_ref skriver inte över det människan satt och redovisar fältet', async () => {
    const person = { name: 'PP2 Person', email: 'pp2@person.example' };
    await ingest(personHandelse('gmail:pp2a', 'PP2 Bolaget AB', { ...person, external_ref: 'kontakter/pp2-synk' }));
    const id = await personPaEpost('pp2@person.example');
    const satt = await act('upsert_crm_person',
      { person_id: id, external_ref: 'kontakter/pp2-manniska', notes: 'Davids anteckning' });
    expect(satt).toMatchObject({ created: false, kept_human_fields: [] });

    const r = await ingestRaw([personHandelse('gmail:pp2b', 'PP2 Bolaget AB', { ...person, external_ref: 'kontakter/pp2-ny' })]);
    expect(r.skipped).toEqual([]);
    expect(r.kept_human_fields).toEqual(['PP2 Person: external_ref']);
    expect(await personRad(id)).toMatchObject({ external_ref: 'kontakter/pp2-manniska', notes: 'Davids anteckning' });
    expect(await tvaFaltensUrsprung(id)).toEqual([['external_ref', 'human'], ['notes', 'human']]);
  });

  it('PP3 ett synksatt och ett ursprungslöst external_ref följer källan och får ursprunget sync', async () => {
    const handelse = (sourceRef: string, externalRef: string) => personHandelse(sourceRef, 'PP3 Bolaget AB',
      { name: 'PP3 Person', email: 'pp3@person.example', external_ref: externalRef });
    const egna = (r: { kept_human_fields: string[] }) => r.kept_human_fields.filter((s) => s.startsWith('PP3 Person: '));
    const kortlankensUrsprung = async (id: string) => (await personUrsprung(id)).find((p) => p.field === 'external_ref');
    await ingest(handelse('gmail:pp3a', 'kontakter/pp3-a'));
    const id = await personPaEpost('pp3@person.example');

    const synksatt = await ingest(handelse('gmail:pp3b', 'kontakter/pp3-b'));
    expect(egna(synksatt)).toEqual([]);
    expect((await personRad(id)).external_ref).toBe('kontakter/pp3-b');
    expect(await kortlankensUrsprung(id))
      .toEqual({ field: 'external_ref', source: 'sync', source_system: 'gmail', source_ref: 'gmail:pp3b' });

    // Ett värde från före bygget: ingen ursprungsrad, alltså oskyddat (ingen bakåtfyllnad).
    const borttagen = await withAdmin((db) => db.query(
      `DELETE FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 AND field = 'external_ref'`, [companyA, id]));
    expect(borttagen.rowCount, 'ursprungsraden ska ha funnits').toBe(1);
    const ursprungslos = await ingest(handelse('gmail:pp3c', 'kontakter/pp3-c'));
    expect(egna(ursprungslos)).toEqual([]);
    expect((await personRad(id)).external_ref).toBe('kontakter/pp3-c');
    expect(await kortlankensUrsprung(id))
      .toEqual({ field: 'external_ref', source: 'sync', source_system: 'gmail', source_ref: 'gmail:pp3c' });
  });

  it('PP4 agenten skriver inte över människans kortlänk och anteckning, men människan själv gör det', async () => {
    const skapad = await act('upsert_crm_person',
      { name: 'PP4 Person', external_ref: 'kontakter/pp4-manniska', notes: 'Människans anteckning' });
    const fore = await personRad(skapad.id);

    const agentens = await action('upsert_crm_person',
      { person_id: skapad.id, external_ref: 'kontakter/pp4-agent', notes: 'Agentens anteckning' }, agentToken);
    expect(agentens.status, JSON.stringify(agentens.body)).toBe(200);
    expect(agentens.body.result.kept_human_fields).toEqual(['external_ref', 'notes']);
    expect(await personRad(skapad.id)).toEqual(fore);
    expect(await tvaFaltensUrsprung(skapad.id)).toEqual([['external_ref', 'human'], ['notes', 'human']]);
    const senaste = await withAdmin(async (db) => (await db.query<{ details: { kept_human_fields?: string[] } }>(
      `SELECT details FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.person_updated'
       ORDER BY id DESC LIMIT 1`, [companyA, skapad.id])).rows[0]);
    expect(senaste?.details.kept_human_fields).toEqual(['external_ref', 'notes']);

    const manniskans = await act('upsert_crm_person',
      { person_id: skapad.id, external_ref: 'kontakter/pp4-ny', notes: 'Ny anteckning' });
    expect(manniskans.kept_human_fields).toEqual([]);
    expect(await personRad(skapad.id)).toMatchObject({ external_ref: 'kontakter/pp4-ny', notes: 'Ny anteckning' });
    expect(await tvaFaltensUrsprung(skapad.id)).toEqual([['external_ref', 'human'], ['notes', 'human']]);
  });

  it('PP5 negativ kontroll: med ursprunget planterat som sync skriver intaget över kortlänken', async () => {
    const person = { name: 'PP5 Person', email: 'pp5@person.example' };
    await ingest(personHandelse('gmail:pp5a', 'PP5 Bolaget AB', { ...person, external_ref: 'kontakter/pp5-synk' }));
    const id = await personPaEpost('pp5@person.example');
    await act('upsert_crm_person', { person_id: id, external_ref: 'kontakter/pp5-manniska', notes: 'Davids anteckning' });
    const planterad = await withAdmin((db) => db.query(
      `UPDATE crm.field_provenance SET source = 'sync'
       WHERE company_id = $1 AND person_id = $2 AND field = 'external_ref'`, [companyA, id]));
    expect(planterad.rowCount, 'planteringen får inte vara tom').toBe(1);

    const r = await ingest(personHandelse('gmail:pp5b', 'PP5 Bolaget AB', { ...person, external_ref: 'kontakter/pp5-ny' }));
    expect(r.kept_human_fields).not.toContain('PP5 Person: external_ref');
    expect((await personRad(id)).external_ref).toBe('kontakter/pp5-ny');
    expect((await personUrsprung(id)).find((p) => p.field === 'external_ref'))
      .toMatchObject({ source: 'sync', source_ref: 'gmail:pp5b' });
  });

  it('PP6 ett annat bolag når inte personen: 404 och ingenting ändrat', async () => {
    const skapad = await act('upsert_crm_person', { name: 'PP6 Person', external_ref: 'kontakter/pp6' });
    const fore = { rad: await personRad(skapad.id), ursprung: await personUrsprung(skapad.id) };
    const r = await api.post(`/api/companies/${companyB}/actions/upsert_crm_person`)
      .set('Authorization', `Bearer ${b.token}`).send({ person_id: skapad.id, external_ref: 'kontakter/pp6-b' });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect({ rad: await personRad(skapad.id), ursprung: await personUrsprung(skapad.id) }).toEqual(fore);
  });
});

describe('Låsordningen (story 1.9)', () => {
  /** En egen anslutning som ägarrollen, som håller låset; fallet avslutar den i finally. */
  async function lasHallare(): Promise<{ db: pg.Client; pid: number }> {
    const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await db.connect();
    try {
      return { db, pid: (await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid };
    } catch (err) {
      await db.end();
      throw err;
    }
  }
  /** Väntar (högst två sekunder) tills någon anslutning blockeras av hållaren. */
  async function vantarPaLas(pid: number): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      const blockerad = await withAdmin(async (db) => (await db.query<{ blockerad: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blockerad',
        [pid])).rows[0]!.blockerad);
      if (blockerad) return true;
      await new Promise((klar) => setTimeout(klar, 20));
    }
    return false;
  }
  /** Går personens rad att låsa just nu? Felkoden 55P03 betyder att någon håller den. */
  async function nowaitPerson(id: string): Promise<string> {
    const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await db.connect();
    try {
      await db.query('BEGIN');
      return await utfall(db.query(
        'SELECT id FROM crm.people WHERE company_id = $1 AND id = $2 FOR UPDATE NOWAIT', [companyA, id]));
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  }
  /** Satsens utfall som värde, så att till exempel ett dödläge (40P01) syns och fäller fallet. */
  const utfall = (sats: Promise<unknown>) =>
    sats.then(() => 'gick igenom', (err: { code?: string }) => err.code ?? 'okänt fel');
  const flytta = (db: pg.Client, id: string, organizationId: string) => utfall(db.query(
    'UPDATE crm.people SET organization_id = $3 WHERE company_id = $1 AND id = $2', [companyA, id, organizationId]));

  it('PL1 en samtidig människoskrivning håller personens rad: intaget väntar, och människans kortlänk och ursprung står kvar', async () => {
    const person = { name: 'PL1 Person', email: 'pl1@person.example' };
    await ingest(personHandelse('gmail:pl1a', 'PL1 Bolaget AB', { ...person, external_ref: 'kontakter/pl1-synk' }));
    const id = await personPaEpost('pl1@person.example');
    const h = await lasHallare();
    let pagaende: Promise<unknown> | undefined;
    try {
      await h.db.query('BEGIN');
      await h.db.query('SELECT id FROM crm.people WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyA, id]);
      await h.db.query(`UPDATE crm.people SET external_ref = 'kontakter/pl1-manniska' WHERE company_id = $1 AND id = $2`,
        [companyA, id]);
      // Synkens rad från uppställningen; den finns bara när listan bär fältet.
      const gjordOm = await h.db.query(
        `UPDATE crm.field_provenance SET source = 'human', source_system = NULL, source_ref = NULL, reason = NULL
         WHERE company_id = $1 AND person_id = $2 AND field = 'external_ref'`, [companyA, id]);
      expect(gjordOm.rowCount, 'synkens ursprungsrad för external_ref').toBe(1);
      // .then startar supertest-anropet nu, så att det faktiskt når låset.
      const svar = action('ingest_crm_events', { events: [
        personHandelse('gmail:pl1b', 'PL1 Bolaget AB', { ...person, external_ref: 'kontakter/pl1-ny' }),
      ] }).then((r) => r);
      pagaende = svar;
      const vantade = await vantarPaLas(h.pid);
      await h.db.query('COMMIT');
      const r = await svar;
      expect(vantade, 'intaget måste ha väntat på människans radlås').toBe(true);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result.skipped).toEqual([]);
      expect(r.body.result.kept_human_fields).toEqual(['PL1 Person: external_ref']);
    } finally {
      await h.db.query('ROLLBACK');
      await pagaende?.catch(() => undefined);
      await h.db.end();
    }
    expect((await personRad(id)).external_ref).toBe('kontakter/pl1-manniska');
    expect((await personUrsprung(id)).find((p) => p.field === 'external_ref')).toMatchObject({ source: 'human' });
  });

  it('PL2 en upsert som väntar på organisationen i indata håller inte personens rad', async () => {
    const hemma = (await act('upsert_crm_organization', { name: 'PL2 Hemma AB' })).id;
    const borta = (await act('upsert_crm_organization', { name: 'PL2 Borta AB' })).id;
    const id = (await act('upsert_crm_person', { name: 'PL2 Person', organization_id: hemma })).id;
    const h = await lasHallare();
    let pagaende: Promise<unknown> | undefined;
    try {
      await h.db.query('BEGIN');
      await h.db.query('SELECT id FROM crm.organizations WHERE id = $1 FOR UPDATE', [borta]);
      const svar = action('upsert_crm_person', { person_id: id, organization_id: borta }).then((r) => r);
      pagaende = svar;
      const vantade = await vantarPaLas(h.pid);
      const nowait = await nowaitPerson(id);
      await h.db.query('COMMIT');
      const r = await svar;
      expect({ vantade, nowait }).toEqual({ vantade: true, nowait: 'gick igenom' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    } finally {
      await h.db.query('ROLLBACK');
      await pagaende?.catch(() => undefined);
      await h.db.end();
    }
    expect((await personRad(id)).organization_id).toBe(borta);
  });

  it('PL3 en upsert som väntar på organisationen personen lämnar: sammanslagningens flytt går igenom och upserten svarar 409 utan att skriva', async () => {
    const hemma = (await act('upsert_crm_organization', { name: 'PL3 Hemma AB' })).id;
    const borta = (await act('upsert_crm_organization', { name: 'PL3 Borta AB' })).id;
    const kvar = (await act('upsert_crm_organization', { name: 'PL3 Kvar AB' })).id;
    const id = (await act('upsert_crm_person', { name: 'PL3 Person', organization_id: hemma })).id;
    const fore = { audit: await personAudit(id, 'crm.person_updated'), ursprung: await personUrsprung(id) };
    const h = await lasHallare();
    let pagaende: Promise<unknown> | undefined;
    try {
      await h.db.query('BEGIN');
      // Som sammanslagningen: organisationerna i stigande id-ordning, sedan personerna.
      await h.db.query('SELECT id FROM crm.organizations WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[hemma, kvar]]);
      const svar = action('upsert_crm_person', { person_id: id, organization_id: borta }).then((r) => r);
      pagaende = svar;
      const vantade = await vantarPaLas(h.pid);
      const nowait = await nowaitPerson(id);
      const flytten = await flytta(h.db, id, kvar);
      await h.db.query(flytten === 'gick igenom' ? 'COMMIT' : 'ROLLBACK');
      const r = await svar;
      expect({ vantade, nowait, flytten }).toEqual({ vantade: true, nowait: 'gick igenom', flytten: 'gick igenom' });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body).toEqual({ error: 'person_flyttad_samtidigt' });
    } finally {
      await h.db.query('ROLLBACK');
      await pagaende?.catch(() => undefined);
      await h.db.end();
    }
    expect((await personRad(id)).organization_id).toBe(kvar);
    expect({ audit: await personAudit(id, 'crm.person_updated'), ursprung: await personUrsprung(id) }).toEqual(fore);
  });

  it('PL4 samma flytt i intaget: händelsen hamnar i skipped med skälet, och samma batch igen går igenom', async () => {
    const person = { name: 'PL4 Person', email: 'pl4@person.example' };
    await ingest(personHandelse('gmail:pl4a', 'PL4 Hemma AB', person));
    const id = await personPaEpost('pl4@person.example');
    const hemma = (await personRad(id)).organization_id;
    expect(hemma, 'personen ska ligga på PL4 Hemma AB').not.toBeNull();
    const kvar = (await act('upsert_crm_organization', { name: 'PL4 Kvar AB' })).id;
    const events = [personHandelse('gmail:pl4b', null, { ...person, role_title: 'Ny roll' })];
    const h = await lasHallare();
    let pagaende: Promise<unknown> | undefined;
    try {
      await h.db.query('BEGIN');
      await h.db.query('SELECT id FROM crm.organizations WHERE id = $1 FOR UPDATE', [hemma]);
      const svar = action('ingest_crm_events', { events }).then((r) => r);
      pagaende = svar;
      const vantade = await vantarPaLas(h.pid);
      const flytten = await flytta(h.db, id, kvar);
      await h.db.query(flytten === 'gick igenom' ? 'COMMIT' : 'ROLLBACK');
      const r = await svar;
      expect({ vantade, flytten }).toEqual({ vantade: true, flytten: 'gick igenom' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result.skipped).toEqual([{
        index: 0, reason: 'personen bytte organisation medan skrivningen väntade på sitt lås — skicka ändringen igen',
      }]);
      expect(r.body.result.interactions_created).toBe(0);
    } finally {
      await h.db.query('ROLLBACK');
      await pagaende?.catch(() => undefined);
      await h.db.end();
    }
    expect(await personRad(id)).toMatchObject({ role_title: null, organization_id: kvar });

    const igen = await ingestRaw(events);
    expect(igen.skipped).toEqual([]);
    expect(igen.interactions_created).toBe(1);
    expect((await personRad(id)).role_title).toBe('Ny roll');
  });

  it('PL5 agentens sfärbyte på en befintlig person ger fortfarande 409 byt_med_set_crm_sfar', async () => {
    const skapad = await act('upsert_crm_person', { name: 'PL5 Person', sfar: 'foretag' }, agentToken);
    expect(skapad).toMatchObject({ created: true, sfar: 'foretag' });
    expect((await personUrsprung(skapad.id)).find((p) => p.field === 'sfar')).toMatchObject({ source: 'ai' });
    const fore = await personRad(skapad.id);
    const r = await action('upsert_crm_person', { person_id: skapad.id, sfar: 'privat' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body).toMatchObject({ error: 'byt_med_set_crm_sfar', details: { atgard: 'set_crm_sfar' } });
    expect(await personRad(skapad.id)).toEqual(fore);
    expect(fore.sfar).toBe('foretag');
  });
});

describe('Dokumenten (story 1.9)', () => {
  it('PD1 «Människan vinner» säger att personens external_ref och notes skyddas och hur konflikten redovisas', async () => {
    const doc = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    expect(doc.match(/^## Människan vinner$/gm)).toHaveLength(1);
    // Dokumentet är hårt radbrutet: blanktecknen slås ihop innan meningen jämförs.
    const avsnitt = doc.split('## Människan vinner\n')[1]!.split('\n## ')[0]!.replace(/\s+/g, ' ');
    for (const del of [
      'Personens `external_ref` och `notes` skyddas som personens andra fält.',
      '`upsert_crm_person`', '`kept_human_fields`', '`person_flyttad_samtidigt`', '`skipped`',
      '"<personens namn>: external_ref"',
    ]) {
      expect(avsnitt, del).toContain(del);
    }
  });

  it('PD2 åtgärdsdokumentet har ett eget avsnitt för personens kortlänk och anteckning', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const delar = doc.split('## Personens kortlänk och anteckning (crm 1.9)\n');
    expect(delar).toHaveLength(2);
    const avsnitt = delar[1]!.split('\n## ')[0]!;
    for (const term of [
      'upsert_crm_person', 'ingest_crm_events', 'external_ref', 'notes', 'kept_human_fields',
      'person_flyttad_samtidigt', 'byt_med_set_crm_sfar',
    ]) {
      expect(avsnitt, term).toContain(`\`${term}\``);
    }
    expect(avsnitt).not.toMatch(/^### /m);
  });
});
