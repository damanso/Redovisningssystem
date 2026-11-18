// Privat och företag i samma CRM, steg 3 av 3 (Davids beställning 9/11, leads
// beslut 18/11). Proven följer orderns KLART NÄR:
//
//   A  gränsen färdig: en privat person ligger aldrig på en kundkopplad
//      organisation, och står aldrig på en kontaktpunkt eller ett åtagande där —
//      i tjänsten (ny, flyttad, blir privat, kundkoppling, synk, sammanslagning)
//      och i databasen (varje väg direkt i SQL, samtidiga skrivningar, låsordningen
//      mot sammanslagningen, migrationens lock_timeout). GDPR-knappen.
//   B  set_crm_sfar: organisation med och utan kaskad, person, åtagande, varje
//      vägran, auditloggen, agenten mot en människas beslut, och ytan.
//   C  «Privat (<förnamn>)»: skapas idempotent första gången, förvald på Min sida
//      i Privat-läget, och sidan själv skriver ingenting.
//   D  förslaget: läsningen rör ingenting, bara kryssade rader flyttas, bara
//      ägaren i en webbsession kan flytta, agenten (MCP) kan inte, ångra
//      återställer exakt, och svepet är grönt efter en flytt.
//   E  dagsytan: en privat relation får aldrig prospektskäl eller «ingen
//      registrerad kontakt alls».
//   F  krav 9: ett privat ärende hos en leverantör länkar till /privat.
//   R  rättningsvarv 3b: en agents sfärbyte på en befintlig post väntar på Davids
//      beslut i Att göra, omvägarna via upsert och en omsänd händelse är stängda,
//      och kaskaden och ångra rör aldrig ett åtagande som inte är öppet.
//      (Ingen fritext i adressen från förslagssidan: D7–D10.)
//   S  svepet över varje tabell i public, sist i filen.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { actionManifest } from '../src/actions/registry.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { angraPrivatFlytt, sakerstallPrivatIntern } from '../src/services/crmPrivat.js';
import { setCrmSfar } from '../src/services/crmSfarByte.js';
import { privataId, svepaBokforingen } from './crm-sfar-svep.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rad = Record<string, any>;
type Svar = { status: number; body: Rad };

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
const auth = () => ({ Authorization: `Bearer ${user.token}` });

function bolaget(companyId: string) {
  return (name: string, body: Record<string, unknown> = {}): Promise<Svar> =>
    api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body) as unknown as Promise<Svar>;
}
function ok(res: Svar): any {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
/** Gränsfelet: samma kod för alla fall, regeln och skälet i details. */
function grans(res: Svar, regel: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.error).toBe('privat_bokforingsgrans');
  expect(res.body.details?.regel, JSON.stringify(res.body)).toBe(regel);
  expect(String(res.body.details?.skal ?? '')).toMatch(/kundregistret/);
}
/** Godkänn en känslig åtgärd direkt, och lämna svaret på godkännandet. */
function godkannare(companyId: string) {
  return async (name: string, body: Record<string, unknown>): Promise<Svar> => {
    const res = await api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return api.post(`/api/companies/${companyId}/approvals/${res.body.approval.id}/approve`)
      .set(auth()).send({}) as unknown as Promise<Svar>;
  };
}
/** En SQL-sats direkt som ägarrollen: databasens felkod, eller 'gick igenom'. */
const direkt = (sql: string, params: unknown[]) => withAdmin(async (admin) => {
  try {
    await admin.query(sql, params);
    return 'gick igenom';
  } catch (err) {
    return (err as { code?: string }).code;
  }
});
/** Samma sak i en transaktion som rullas tillbaka: kontrollen ska gå igenom utan att lämna spår. */
const direktProv = (sql: string, params: unknown[]) => withAdmin(async (admin) => {
  await admin.query('BEGIN');
  try {
    await admin.query(sql, params);
    return 'gick igenom';
  } catch (err) {
    return (err as { code?: string }).code;
  } finally {
    await admin.query('ROLLBACK');
  }
});
/** Formulärkropp med upprepade fält (val=…&val=…), som en webbläsare skickar dem. */
const formular = (par: [string, string][]): string =>
  par.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
async function inloggad(u: TestUser): Promise<ReturnType<typeof supertest.agent>> {
  const ua = supertest.agent(app);
  const r = await ua.post('/app/login').type('form').send({ email: u.email, password: PASSWORD });
  expect(r.status).toBe(302);
  return ua;
}
async function agentToken(companyId: string): Promise<string> {
  const t = await api.post(`/api/companies/${companyId}/agent-tokens`).set(auth()).send({ name: 'Hermes' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  return t.body.token as string;
}
const crmLogg = async (companyId: string, action: string) => (await withAdmin((admin) => admin.query<{ entity_id: string; details: Rad }>(
  'SELECT entity_id, details FROM crm.audit_log WHERE company_id = $1 AND action = $2 ORDER BY id', [companyId, action]))).rows;

const NAR = '2026-11-10T09:00:00Z';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const atagande = (extra: Record<string, unknown>) => ({
  direction: 'we_owe', body: 'Ett löfte', occurred_at: NAR, source_system: 'manual', ...extra,
});
const kontakt = (extra: Record<string, unknown>) => ({
  occurred_at: NAR, channel: 'email', summary: 'Hej', source_system: 'manual', ...extra,
});

/**
 * Två anslutningar som ägarrollen. Den första skrivningen hålls öppen, den andra
 * startas och ska VÄNTA på radlåset; när den första committas prövas den andra mot
 * det som blev kvar.
 */
async function kapplopning(forsta: [string, unknown[]], andra: [string, unknown[]]) {
  const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  const t2 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await t1.connect();
  await t2.connect();
  try {
    const pid = (await t2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await t1.query('BEGIN');
    await t1.query(...forsta);
    await t2.query('BEGIN');
    const utfall = t2.query(...andra).then(() => 'gick igenom', (err: { code?: string }) => err.code);
    const vantade = await vantarPaLas(pid);
    await t1.query('COMMIT');
    const svar = await utfall;
    await t2.query('ROLLBACK');
    return { vantade, svar };
  } finally {
    await t1.end();
    await t2.end();
  }
}
/** Väntar (högst två sekunder) tills anslutningen står och väntar på ett lås. */
async function vantarPaLas(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const r = await withAdmin((admin) => admin.query<{ w: string | null }>(
      'SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1', [pid]));
    if (r.rows[0]?.w === 'Lock') return true;
    await new Promise((klar) => setTimeout(klar, 20));
  }
  return false;
}

beforeAll(async () => {
  user = await registerUser('sfar3');
  // Förnamnet i «Privat (<förnamn>)» är bolagsägarens.
  await withAdmin((admin) => admin.query("UPDATE users SET name = 'David Mancilla' WHERE id = $1", [user.userId]));
});

// ---------------------------------------------------------------------------
// A: gränsen färdig
// ---------------------------------------------------------------------------

describe('A en privat person ligger aldrig hos kunden', () => {
  let act: ReturnType<typeof bolaget>;
  let godkann: ReturnType<typeof godkannare>;
  let companyId: string;
  let kundOrg: string;
  let ledigKund: string;
  let foretagOrg: string;
  let privatOrg: string;
  let pia: string; // privat person utan organisation
  let kim: string; // företagsperson hos kunden
  let ulf: string; // företagsperson på företagsorganisationen

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Gränsen färdig AB');
    act = bolaget(companyId);
    godkann = godkannare(companyId);
    const kund = ok(await act('create_customer', { name: 'Kunden AB' })).id;
    kundOrg = ok(await act('upsert_crm_organization', { name: 'Kunden AB', customer_id: kund })).id;
    ledigKund = ok(await act('create_customer', { name: 'Ledig Kund AB' })).id;
    foretagOrg = ok(await act('upsert_crm_organization', { name: 'Företaget Utan Kund AB' })).id;
    privatOrg = ok(await act('upsert_crm_organization', { name: 'Hemförsäkringen', sfar: 'privat' })).id;
    pia = ok(await act('upsert_crm_person', { name: 'Pia Privat', email: 'pia@example.se', sfar: 'privat' })).id;
    kim = ok(await act('upsert_crm_person', { name: 'Kim Kontakt', email: 'kim@example.se', organization_id: kundOrg })).id;
    ulf = ok(await act('upsert_crm_person', { name: 'Ulf Företag', email: 'ulf@example.se', organization_id: foretagOrg })).id;
  });

  const personen = async (id: string) => (await withAdmin((admin) => admin.query(
    'SELECT organization_id, sfar FROM crm.people WHERE id = $1', [id]))).rows[0];

  it('A1 tjänsten: ny, flyttad eller bytt sfär — en privat person hamnar aldrig på kundens organisation', async () => {
    // Ny.
    grans(await act('upsert_crm_person', { name: 'Nya Nora', sfar: 'privat', organization_id: kundOrg }),
      'privat_person_kundkopplad_organisation');
    // Flyttad.
    grans(await act('upsert_crm_person', { name: 'Pia Privat', email: 'pia@example.se', organization_id: kundOrg }),
      'privat_person_kundkopplad_organisation');
    // Bytt sfär hos kunden.
    grans(await act('upsert_crm_person', { name: 'Kim Kontakt', email: 'kim@example.se', sfar: 'privat' }),
      'privat_person_kundkopplad_organisation');
    expect(await personen(pia)).toEqual({ organization_id: null, sfar: 'privat' });
    expect(await personen(kim)).toEqual({ organization_id: kundOrg, sfar: 'foretag' });
    const nora = await withAdmin((admin) => admin.query("SELECT 1 FROM crm.people WHERE name = 'Nya Nora'"));
    expect(nora.rows, 'den nya personen skapades inte').toEqual([]);
    // Kontrollerna: privat på en privat organisation, och företag hos kunden.
    expect(ok(await act('upsert_crm_person', { name: 'Hilda Hemma', sfar: 'privat', organization_id: privatOrg })))
      .toMatchObject({ sfar: 'privat', organization_id: privatOrg });
    expect(ok(await act('upsert_crm_person', { name: 'Fia Företag', organization_id: kundOrg })))
      .toMatchObject({ sfar: 'foretag', organization_id: kundOrg });
  });

  it('A2 tjänsten: en kontaktpunkt eller ett åtagande hos kunden bär aldrig en privat person (granskningens extra väg)', async () => {
    grans(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: pia })), 'privat_person_kundkopplad_post');
    grans(await act('record_crm_commitment', atagande({ organization_id: kundOrg, person_id: pia, sfar: 'foretag' })),
      'privat_person_kundkopplad_post');
    grans(await act('log_contact', { organization_id: kundOrg, person_id: pia }), 'privat_person_kundkopplad_post');
    // En omsänd kontaktpunkt som flyttar till kunden.
    ok(await act('record_crm_interaction', kontakt({ person_id: pia, source_system: 'gmail', source_ref: 'gmail:a2' })));
    grans(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: pia, source_system: 'gmail', source_ref: 'gmail:a2' })),
      'privat_person_kundkopplad_post');
    const poster = await withAdmin((admin) => admin.query(
      `SELECT 'i' FROM crm.interactions WHERE organization_id = $1 AND person_id = $2
       UNION ALL SELECT 'c' FROM crm.commitments WHERE organization_id = $1 AND person_id = $2`, [kundOrg, pia]));
    expect(poster.rows).toEqual([]);
    // Kontrollen: företagspersonen hos kunden.
    expect(ok(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: kim }))).created).toBe(true);
  });

  it('A3 tjänsten: en person som står på poster hos kunden blir inte privat', async () => {
    ok(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: ulf, summary: 'Ulf hos kunden' })));
    grans(await act('upsert_crm_person', { name: 'Ulf Företag', email: 'ulf@example.se', sfar: 'privat' }),
      'privat_person_kundkopplad_post');
    expect(await personen(ulf)).toEqual({ organization_id: foretagOrg, sfar: 'foretag' });
  });

  it('A4 kundkopplingen: en organisation med en privat person, eller en post med en, kopplas inte — uttryckligen eller av synken', async () => {
    const hem = ok(await act('upsert_crm_organization', { name: 'Grannföreningen' })).id;
    ok(await act('upsert_crm_person', { name: 'Granne Privat', sfar: 'privat', organization_id: hem }));
    const hemKund = ok(await act('create_customer', { name: 'Grannföreningen' })).id;
    grans(await act('upsert_crm_organization', { name: 'Grannföreningen', customer_id: hemKund }), 'privat_person_kundkoppling');
    // Synken skulle annars ha slagit upp kunden på namnet. Händelsen går igenom, okopplad.
    const svar = ok(await act('ingest_crm_events', {
      events: [{ kind: 'interaction', organization: { name: 'Grannföreningen' }, occurred_at: NAR,
        source_system: 'gmail', source_ref: 'gmail:a4', channel: 'email', summary: 'Hej' }],
    }));
    expect(svar).toMatchObject({ interactions_created: 1, skipped: [], unlinked_organizations: ['Grannföreningen'] });
    expect(ok(await act('get_crm_organization', { organization_id: hem })).customer_id).toBeNull();

    // Bara en post med den privata personen (P2), ingen person på organisationen.
    const post = ok(await act('upsert_crm_organization', { name: 'Postorganisationen' })).id;
    ok(await act('record_crm_interaction', kontakt({ organization_id: post, person_id: pia, summary: 'Pia här' })));
    grans(await act('upsert_crm_organization', { organization_id: post, name: 'Postorganisationen', customer_id: ledigKund }),
      'privat_person_kundkoppling');
  });

  it('A5 synken: en privat person flyttas inte till kunden, och händelsen hoppas över med skäl', async () => {
    const svar = ok(await act('ingest_crm_events', {
      events: [{ kind: 'interaction', organization: { name: 'Kunden AB' }, person: { name: 'Pia Privat', email: 'pia@example.se' },
        occurred_at: NAR, source_system: 'gmail', source_ref: 'gmail:a5', channel: 'email', summary: 'Hej' }],
    }));
    expect(svar.skipped).toHaveLength(1);
    expect(svar.skipped[0].reason).toMatch(/kundregistret/);
    expect(await personen(pia)).toEqual({ organization_id: null, sfar: 'privat' });
  });

  it('A6 sammanslagningen: organisationer med privata personer slås inte in under en kundkoppling, åt något håll', async () => {
    const medPrivat = ok(await act('upsert_crm_organization', { name: 'Med Privat Person' })).id;
    ok(await act('upsert_crm_person', { name: 'Privata Petra', sfar: 'privat', organization_id: medPrivat }));
    grans(await godkann('merge_crm_organizations', { keep_id: kundOrg, merge_id: medPrivat }), 'privat_person_kundkoppling');
    grans(await godkann('merge_crm_organizations', { keep_id: medPrivat, merge_id: kundOrg }), 'privat_person_kundkoppling');
    // P2: bara en kontaktpunkt med den privata personen på organisationen.
    const medPost = ok(await act('upsert_crm_organization', { name: 'Med Privat Post' })).id;
    ok(await act('record_crm_interaction', kontakt({ organization_id: medPost, person_id: pia, summary: 'Pia på posten' })));
    grans(await godkann('merge_crm_organizations', { keep_id: kundOrg, merge_id: medPost }), 'privat_person_kundkoppling');
    const kvar = await withAdmin((admin) => admin.query(
      'SELECT count(*)::int AS n FROM crm.organizations WHERE id = ANY($1::uuid[])', [[kundOrg, medPrivat, medPost]]));
    expect(kvar.rows[0].n, 'ingen organisation försvann').toBe(3);
    // Personer: en privat och en företagsperson slås inte ihop (steg 2), här mot en
    // kontakt hos kunden. Båda utan e-post, så att e-postregeln inte avgör först.
    const hosKunden = ok(await act('upsert_crm_person', { name: 'A6 Kontakt', organization_id: kundOrg })).id;
    const privatUtan = ok(await act('upsert_crm_person', { name: 'A6 Privat', sfar: 'privat' })).id;
    const konflikt = await godkann('merge_crm_people', { keep_id: hosKunden, merge_id: privatUtan });
    expect(konflikt.status, JSON.stringify(konflikt.body)).toBe(400);
    expect(konflikt.body.error).toBe('sfar_conflict');
  });

  it('A7 databasen: varje väg från P1 och P2, direkt i SQL, och kontrollerna går igenom', async () => {
    const hosKund = ok(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: kim, summary: 'Kim A7' }))).id;
    const medPia = ok(await act('upsert_crm_organization', { name: 'A7 Pias Organisation' })).id;
    ok(await act('record_crm_interaction', kontakt({ organization_id: medPia, person_id: pia, summary: 'Pia A7' })));
    const medPrivatPerson = ok(await act('upsert_crm_organization', { name: 'A7 Privat Person' })).id;
    ok(await act('upsert_crm_person', { name: 'A7 Privata', sfar: 'privat', organization_id: medPrivatPerson }));
    const kund2 = ok(await act('create_customer', { name: 'A7 Kund två' })).id;
    const kund3 = ok(await act('create_customer', { name: 'A7 Kund tre' })).id;
    // Egen person med en post hos kunden, så att provet inte hänger på A3.
    const besokare = ok(await act('upsert_crm_person', { name: 'A7 Besökare', organization_id: foretagOrg })).id;
    ok(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: besokare, summary: 'Besök A7' })));

    const vagar: [string, string, unknown[]][] = [
      ['ny privat person hos kunden',
        "INSERT INTO crm.people (company_id, name, organization_id, sfar) VALUES ($1, 'Smugglad', $2, 'privat')", [companyId, kundOrg]],
      ['privat person flyttas till kunden', 'UPDATE crm.people SET organization_id = $1 WHERE id = $2', [kundOrg, pia]],
      ['person hos kunden blir privat', "UPDATE crm.people SET sfar = 'privat' WHERE id = $1", [kim]],
      ['person med post hos kunden blir privat', "UPDATE crm.people SET sfar = 'privat' WHERE id = $1", [besokare]],
      ['kontaktpunkt hos kunden med privat person',
        `INSERT INTO crm.interactions (company_id, organization_id, person_id, occurred_at, channel, summary, source_system)
         VALUES ($1, $2, $3, now(), 'note', 'Smugglad', 'manual')`, [companyId, kundOrg, pia]],
      ['kontaktpunkt byter till privat person', 'UPDATE crm.interactions SET person_id = $1 WHERE id = $2', [pia, hosKund]],
      ['företagsåtagande hos kunden med privat person',
        `INSERT INTO crm.commitments (company_id, organization_id, person_id, direction, body, occurred_at, source_system, sfar)
         VALUES ($1, $2, $3, 'we_owe', 'Smugglat', now(), 'manual', 'foretag')`, [companyId, kundOrg, pia]],
      ['organisation med privat person kopplas', 'UPDATE crm.organizations SET customer_id = $1 WHERE id = $2', [kund2, medPrivatPerson]],
      ['organisation med post med privat person kopplas', 'UPDATE crm.organizations SET customer_id = $1 WHERE id = $2', [kund3, medPia]],
    ];
    const utfall: Record<string, string | undefined> = {};
    for (const [namn, sql, p] of vagar) utfall[namn] = await direkt(sql, p);
    expect(utfall).toEqual(Object.fromEntries(vagar.map(([namn]) => [namn, 'P0001'])));

    // Kontrollerna: samma satser för företagspersoner och organisationer utan privat går igenom.
    const fri = ok(await act('upsert_crm_person', { name: 'A7 Fri Person', organization_id: foretagOrg })).id;
    expect(await direktProv(
      "INSERT INTO crm.people (company_id, name, organization_id, sfar) VALUES ($1, 'Kontroll', $2, 'foretag')", [companyId, kundOrg])).toBe('gick igenom');
    expect(await direktProv(
      `INSERT INTO crm.interactions (company_id, organization_id, person_id, occurred_at, channel, summary, source_system)
       VALUES ($1, $2, $3, now(), 'note', 'Kontroll', 'manual')`, [companyId, kundOrg, kim])).toBe('gick igenom');
    expect(await direktProv("UPDATE crm.people SET sfar = 'privat' WHERE id = $1", [fri])).toBe('gick igenom');
    expect(await direktProv('UPDATE crm.organizations SET customer_id = $1 WHERE id = $2', [kund2, foretagOrg])).toBe('gick igenom');

    const brott = await withAdmin((admin) => admin.query(
      `SELECT p.id FROM crm.people p JOIN crm.organizations o ON o.id = p.organization_id
        WHERE p.company_id = $1 AND p.sfar = 'privat' AND o.customer_id IS NOT NULL
       UNION ALL
       SELECT x.person_id FROM (SELECT organization_id, person_id FROM crm.interactions WHERE company_id = $1
                                UNION ALL SELECT organization_id, person_id FROM crm.commitments WHERE company_id = $1) x
         JOIN crm.people p ON p.id = x.person_id JOIN crm.organizations o ON o.id = x.organization_id
        WHERE p.sfar = 'privat' AND o.customer_id IS NOT NULL`, [companyId]));
    expect(brott.rows, 'inget av försöken blev kvar').toEqual([]);
  });

  it('A8 databasen: två samtidiga skrivningar öppnar inte vägen tillsammans (radlåset), åt båda hållen och för posten', async () => {
    const kandidat = async (namn: string) => ({
      org: ok(await act('upsert_crm_organization', { name: namn })).id as string,
      kund: ok(await act('create_customer', { name: `${namn} kundregistret` })).id as string,
    });
    const koppla = 'UPDATE crm.organizations SET customer_id = $1 WHERE id = $2';
    const blirPrivat = "UPDATE crm.people SET sfar = 'privat' WHERE id = $1";

    // a) Personen blir privat först, organisationen kopplas sedan.
    const a = await kandidat('A8 a AB');
    const pa = ok(await act('upsert_crm_person', { name: 'A8 a person', organization_id: a.org })).id;
    expect(await kapplopning([blirPrivat, [pa]], [koppla, [a.kund, a.org]])).toEqual({ vantade: true, svar: 'P0001' });
    // b) Organisationen kopplas först, personen blir privat sedan.
    const b = await kandidat('A8 b AB');
    const pb = ok(await act('upsert_crm_person', { name: 'A8 b person', organization_id: b.org })).id;
    expect(await kapplopning([koppla, [b.kund, b.org]], [blirPrivat, [pb]])).toEqual({ vantade: true, svar: 'P0001' });
    // c) P2: en kontaktpunkt med den privata personen, organisationen kopplas sedan.
    const c = await kandidat('A8 c AB');
    expect(await kapplopning(
      [`INSERT INTO crm.interactions (company_id, organization_id, person_id, occurred_at, channel, summary, source_system)
        VALUES ($1, $2, $3, now(), 'note', 'Kapplöpning', 'manual')`, [companyId, c.org, pia]],
      [koppla, [c.kund, c.org]])).toEqual({ vantade: true, svar: 'P0001' });
  });

  it('A9 låsordningen: ett nytt privat åtagande väntar på organisationen innan det låser personen, så en samtidig sammanslagning inte låser sig (40P01)', async () => {
    // Granskningens fynd om 0088: åtagandet låste personen och väntade sedan på
    // hennes organisation, medan sammanslagningen höll organisationerna och ville
    // flytta personen. Här håller den första transaktionen organisationerna som
    // mergeOrganizations gör (FOR UPDATE, stigande id) och flyttar sedan personen.
    const gone = ok(await act('upsert_crm_organization', { name: 'A9 Den som går upp' })).id;
    const keep = ok(await act('upsert_crm_organization', { name: 'A9 Den som blir kvar' })).id;
    const person = ok(await act('upsert_crm_person', { name: 'A9 Personen', organization_id: gone })).id;
    const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    const t2 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await t1.connect();
    await t2.connect();
    try {
      const pid = (await t2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await t1.query('BEGIN');
      await t1.query('SELECT id FROM crm.organizations WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[gone, keep]]);
      await t2.query('BEGIN');
      const t2utfall = t2.query(
        `INSERT INTO crm.commitments (company_id, person_id, direction, body, occurred_at, source_system, sfar)
         VALUES ($1, $2, 'we_owe', 'Under sammanslagningen', now(), 'manual', 'privat')`, [companyId, person])
        .then(() => 'gick igenom', (err: { code?: string }) => err.code);
      const vantade = await vantarPaLas(pid);
      const t1utfall = await t1.query('UPDATE crm.people SET organization_id = $1 WHERE organization_id = $2', [keep, gone])
        .then(() => 'gick igenom', (err: { code?: string }) => err.code);
      await t1.query(t1utfall === 'gick igenom' ? 'COMMIT' : 'ROLLBACK');
      const svar = await t2utfall;
      await t2.query('ROLLBACK');
      expect({ vantade, sammanslagningen: t1utfall, atagandet: svar })
        .toEqual({ vantade: true, sammanslagningen: 'gick igenom', atagandet: 'gick igenom' });
    } finally {
      await t1.end();
      await t2.end();
    }
    expect(await personen(person)).toEqual({ organization_id: keep, sfar: 'foretag' });
  });

  it('A10 migrationen: additiv, ingen DROP TRIGGER, lock_timeout satt, och den fäller hellre än köar — läsningarna köar inte bakom den', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../migrations/0089_crm_privat_person_utanfor_kunden.sql', import.meta.url)), 'utf8');
    const satser = sql.replace(/--[^\n]*/g, '');
    expect(satser).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(satser).not.toMatch(/\bDROP\b/i);
    expect(satser).not.toMatch(/\bALTER\s+TABLE\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+crm\./i);
    // Varje sats är en ny version av funktionen eller en ny trigger.
    expect(satser.match(/CREATE (OR REPLACE FUNCTION|TRIGGER) [a-z_.]+/g)).toEqual([
      'CREATE OR REPLACE FUNCTION crm.privat_utanfor_bokforingen',
      'CREATE TRIGGER people_sfar_privat_utanfor_bokforingen',
      'CREATE TRIGGER interactions_privat_utanfor_bokforingen',
    ]);

    // En lång skrivtransaktion håller crm.people. Migrationen (med egna
    // triggernamn, så att inget behöver tas bort) väntar högst lock_timeout och
    // fäller sedan med 55P03. Under tiden går en läsning av tabellen igenom.
    const prov = sql.replace(/people_sfar_privat_utanfor_bokforingen/g, 'people_sfar_prov')
      .replace(/interactions_privat_utanfor_bokforingen/g, 'interactions_prov');
    const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    const t2 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await t1.connect();
    await t2.connect();
    try {
      await t1.query('BEGIN');
      await t1.query('LOCK TABLE crm.people IN ROW EXCLUSIVE MODE');
      const pid = (await t2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await t2.query('BEGIN');
      const start = Date.now();
      const migrering = t2.query(prov).then(() => 'gick igenom', (err: { code?: string }) => err.code);
      expect(await vantarPaLas(pid), 'migrationen väntar på låset').toBe(true);
      const lasStart = Date.now();
      const antal = await withAdmin((admin) => admin.query('SELECT count(*)::int AS n FROM crm.people'));
      const lasTid = Date.now() - lasStart;
      expect(antal.rows[0].n).toBeGreaterThan(0);
      expect(lasTid, 'läsningen köade inte bakom migrationen').toBeLessThan(1500);
      expect(await migrering).toBe('55P03');
      expect(Date.now() - start).toBeLessThan(9000);
      await t2.query('ROLLBACK');
      await t1.query('ROLLBACK');
    } finally {
      await t1.end();
      await t2.end();
    }
    const triggrar = await withAdmin((admin) => admin.query(
      "SELECT tgname FROM pg_trigger WHERE tgname IN ('people_sfar_prov', 'interactions_prov')"));
    expect(triggrar.rows, 'den fällda migrationen lämnade inget efter sig').toEqual([]);
  });

  describe('GDPR: Aktivera visas inte för en raderad kund, och åtgärden vägrar', () => {
    let raderad: string;
    let inaktiv: string;
    let ua: ReturnType<typeof supertest.agent>;
    const aktiv = async (id: string) => (await withAdmin((admin) => admin.query<{ is_active: boolean }>(
      'SELECT is_active FROM customers WHERE id = $1', [id]))).rows[0]!.is_active;
    const uppdaterad = async (id: string) => (await withAdmin((admin) => admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'customer.updated' AND entity_id = $1", [id]))).rows[0].n as number;

    beforeAll(async () => {
      ua = await inloggad(user);
      raderad = ok(await act('create_customer', { name: 'Raderas AB', email: 'r@example.se' })).id;
      const begaran = await api.post(`/api/companies/${companyId}/actions/anonymize_party`).set(auth())
        .send({ party_type: 'customer', party_id: raderad });
      expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
      const beslut = await api.post(`/api/companies/${companyId}/approvals/${begaran.body.approval.id}/approve`).set(auth()).send({});
      expect(beslut.status, JSON.stringify(beslut.body)).toBe(200);
      inaktiv = ok(await act('create_customer', { name: 'Bara Inaktiv AB' })).id;
      ok(await act('update_customer', { customer_id: inaktiv, is_active: false }));
    });

    it('G1 kundkortet: ingen Aktivera-knapp för den raderade, men för en vanlig inaktiv kund', async () => {
      expect(await aktiv(raderad)).toBe(false);
      const kort = await ua.get(`/app/c/${companyId}/customers/${raderad}`);
      expect(kort.status).toBe(200);
      expect(kort.text).not.toContain('Aktivera kund');
      expect(kort.text).not.toContain(`action="/app/c/${companyId}/customers/${raderad}/aktiv"`);
      expect(kort.text).toContain('Raderad enligt GDPR — kan inte aktiveras');
      const kontroll = await ua.get(`/app/c/${companyId}/customers/${inaktiv}`);
      expect(kontroll.text).toContain('Aktivera kund');
    });

    it('G2 åtgärden vägrar: från ytan, via API:t och som agent — och leverantören likaså', async () => {
      const fore = await uppdaterad(raderad);
      const ytan = await ua.post(`/app/c/${companyId}/customers/${raderad}/aktiv`).type('form').send({ is_active: 'true' });
      expect(ytan.status).toBe(302);
      expect(decodeURIComponent(String(ytan.headers.location))).toContain('raderad enligt GDPR');
      const viaApi = await act('update_customer', { customer_id: raderad, is_active: true });
      expect(viaApi.status, JSON.stringify(viaApi.body)).toBe(409);
      expect(viaApi.body.error).toBe('gdpr_raderad');
      const token = await agentToken(companyId);
      const somAgent = await api.post(`/api/companies/${companyId}/actions/update_customer`)
        .set({ Authorization: `Bearer ${token}` }).send({ customer_id: raderad, is_active: true });
      expect(somAgent.status).toBe(409);
      expect(await aktiv(raderad)).toBe(false);
      expect(await uppdaterad(raderad), 'ingen auditrad för ett byte som inte skedde').toBe(fore);
      // Att inaktivera, eller rätta något annat, vägras inte.
      ok(await act('update_customer', { customer_id: raderad, is_active: false }));
      // Kontrollen: den vanliga inaktiva kunden aktiveras.
      expect(ok(await act('update_customer', { customer_id: inaktiv, is_active: true })).is_active).toBe(true);

      const lev = ok(await act('create_supplier', { name: 'Raderad Leverantör AB' })).id;
      const b2 = await api.post(`/api/companies/${companyId}/actions/anonymize_party`).set(auth())
        .send({ party_type: 'supplier', party_id: lev });
      expect((await api.post(`/api/companies/${companyId}/approvals/${b2.body.approval.id}/approve`).set(auth()).send({})).status).toBe(200);
      const levSvar = await act('update_supplier', { supplier_id: lev, is_active: true });
      expect(levSvar.status).toBe(409);
      expect(levSvar.body.error).toBe('gdpr_raderad');
    });
  });
});

// ---------------------------------------------------------------------------
// B: set_crm_sfar
// ---------------------------------------------------------------------------

describe('B set_crm_sfar: byta sfär på organisation, person och åtagande', () => {
  let act: ReturnType<typeof bolaget>;
  let companyId: string;
  let kundOrg: string;
  let kim: string;
  const sfarPa = async (tabell: 'organizations' | 'people' | 'commitments', ids: string[]) => Object.fromEntries(
    (await withAdmin((admin) => admin.query<{ id: string; sfar: string }>(
      `SELECT id, sfar FROM crm.${tabell} WHERE id = ANY($1::uuid[])`, [ids]))).rows.map((r) => [r.id, r.sfar]));
  const sfarLogg = () => crmLogg(companyId, 'crm.sfar_set');

  /** En organisation med två öppna, ett klart och ett avskrivet åtagande, alla företag. */
  async function medAtaganden(namn: string) {
    const org = ok(await act('upsert_crm_organization', { name: namn })).id as string;
    const ids: Record<string, string> = {};
    for (const nyckel of ['oppet1', 'oppet2', 'klart', 'avskrivet']) {
      ids[nyckel] = ok(await act('record_crm_commitment', atagande({ organization_id: org, body: `${namn} ${nyckel}` }))).id;
    }
    ok(await act('set_crm_commitment_status', { commitment_id: ids.klart, status: 'done' }));
    ok(await act('set_crm_commitment_status', { commitment_id: ids.avskrivet, status: 'dropped' }));
    return { org, ...ids } as { org: string; oppet1: string; oppet2: string; klart: string; avskrivet: string };
  }

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Sfärbytet AB');
    act = bolaget(companyId);
    const kund = ok(await act('create_customer', { name: 'Bytets Kund AB' })).id;
    kundOrg = ok(await act('upsert_crm_organization', { name: 'Bytets Kund AB', customer_id: kund })).id;
    kim = ok(await act('upsert_crm_person', { name: 'Kim hos kunden', organization_id: kundOrg })).id;
  });

  it('B1 utan kaskad: organisationen byter sfär, åtagandena stannar — och auditraden säger det', async () => {
    const o = await medAtaganden('Utan Kaskad AB');
    const svar = ok(await act('set_crm_sfar', { organization_id: o.org, sfar: 'privat' }));
    expect(svar).toEqual({ mal: 'organization', id: o.org, sfar_fran: 'foretag', sfar: 'privat', andrad: true, foljde_med: [] });
    expect(await sfarPa('organizations', [o.org])).toEqual({ [o.org]: 'privat' });
    expect(Object.values(await sfarPa('commitments', [o.oppet1, o.oppet2, o.klart, o.avskrivet]))).toEqual(
      ['foretag', 'foretag', 'foretag', 'foretag']);
    // cascade_open_commitments: false är samma sak som utelämnad.
    ok(await act('set_crm_sfar', { organization_id: o.org, sfar: 'foretag', cascade_open_commitments: false }));
    expect(Object.values(await sfarPa('commitments', [o.oppet1, o.oppet2]))).toEqual(['foretag', 'foretag']);
    const logg = (await sfarLogg()).filter((r) => r.entity_id === o.org);
    expect(logg.map((r) => r.details)).toEqual([
      { fran: 'foretag', till: 'privat', cascade: false, foljde_med: [], source: 'human' },
      { fran: 'privat', till: 'foretag', cascade: false, foljde_med: [], source: 'human' },
    ]);
  });

  it('B2 med kaskad: de öppna åtagandena följer med åt båda hållen, klara och avskrivna rörs aldrig', async () => {
    const o = await medAtaganden('Med Kaskad AB');
    const svar = ok(await act('set_crm_sfar', { organization_id: o.org, sfar: 'privat', cascade_open_commitments: true }));
    expect(svar.foljde_med.sort()).toEqual([o.oppet1, o.oppet2].sort());
    expect(await sfarPa('commitments', [o.oppet1, o.oppet2, o.klart, o.avskrivet])).toEqual({
      [o.oppet1]: 'privat', [o.oppet2]: 'privat', [o.klart]: 'foretag', [o.avskrivet]: 'foretag',
    });
    ok(await act('set_crm_sfar', { organization_id: o.org, sfar: 'foretag', cascade_open_commitments: true }));
    expect(await sfarPa('commitments', [o.oppet1, o.oppet2, o.klart, o.avskrivet])).toEqual({
      [o.oppet1]: 'foretag', [o.oppet2]: 'foretag', [o.klart]: 'foretag', [o.avskrivet]: 'foretag',
    });
    // Organisationen bär redan sfären: kaskaden flyttar ändå de öppna som står kvar i den andra.
    const ett = ok(await act('record_crm_commitment', atagande({ organization_id: o.org, sfar: 'privat', body: 'Redan privat' }))).id;
    const svar3 = ok(await act('set_crm_sfar', { organization_id: o.org, sfar: 'foretag', cascade_open_commitments: true }));
    expect(svar3).toMatchObject({ andrad: false, foljde_med: [ett] });
    const logg = (await sfarLogg()).filter((r) => r.entity_id === o.org).map((r) => r.details);
    expect(logg).toHaveLength(3);
    expect(logg[0]).toMatchObject({ fran: 'foretag', till: 'privat', cascade: true });
    expect(logg[0]!.foljde_med.sort()).toEqual([o.oppet1, o.oppet2].sort());
    // Ett anrop som inte ändrar något skriver ingen auditrad.
    ok(await act('set_crm_sfar', { organization_id: o.org, sfar: 'foretag', cascade_open_commitments: true }));
    expect((await sfarLogg()).filter((r) => r.entity_id === o.org)).toHaveLength(3);
  });

  it('B3 personen och åtagandet byter sfär; ett klart eller avskrivet åtagande byter inte', async () => {
    const p = ok(await act('upsert_crm_person', { name: 'Byt Mig' })).id;
    expect(ok(await act('set_crm_sfar', { person_id: p, sfar: 'privat' }))).toMatchObject({ mal: 'person', sfar: 'privat', andrad: true });
    const o = await medAtaganden('Enskilda AB');
    expect(ok(await act('set_crm_sfar', { commitment_id: o.oppet1, sfar: 'privat' }))).toMatchObject({ mal: 'commitment', sfar: 'privat' });
    for (const id of [o.klart, o.avskrivet]) {
      const r = await act('set_crm_sfar', { commitment_id: id, sfar: 'privat' });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('atagandet_ar_stangt');
    }
    expect(await sfarPa('commitments', [o.oppet1, o.klart, o.avskrivet])).toEqual({
      [o.oppet1]: 'privat', [o.klart]: 'foretag', [o.avskrivet]: 'foretag',
    });
    expect(await sfarPa('people', [p])).toEqual({ [p]: 'privat' });
    const logg = await sfarLogg();
    expect(logg.find((r) => r.entity_id === p)?.details).toEqual({ fran: 'foretag', till: 'privat', source: 'human' });
    expect(logg.find((r) => r.entity_id === o.oppet1)?.details).toEqual({ fran: 'foretag', till: 'privat', source: 'human' });
  });

  it('B4 varje vägran: gränsen i 0087, 0088 och 0089, med ett begripligt skäl — och ingenting ändras eller loggas', async () => {
    const fore = (await sfarLogg()).length;
    // En kundkopplad organisation blir inte privat.
    grans(await act('set_crm_sfar', { organization_id: kundOrg, sfar: 'privat' }), 'privat_organisation_kundkoppling');
    // Status kund utan koppling.
    const kundstatus = ok(await act('upsert_crm_organization', { name: 'Kundstatus Utan Koppling', status: 'customer' })).id;
    const ks = await act('set_crm_sfar', { organization_id: kundstatus, sfar: 'privat' });
    expect(ks.body).toMatchObject({ error: 'privat_bokforingsgrans', details: { regel: 'privat_organisation_kundstatus' } });
    // Kaskaden: ett öppet åtagande ligger på en person hos kunden (0088). Hela bytet vägras.
    const blandad = ok(await act('upsert_crm_organization', { name: 'Blandad AB' })).id;
    const viaKim = ok(await act('record_crm_commitment', atagande({ organization_id: blandad, person_id: kim, body: 'Via Kim' }))).id;
    grans(await act('set_crm_sfar', { organization_id: blandad, sfar: 'privat', cascade_open_commitments: true }),
      'privat_atagande_kundkopplad_person');
    // Personen hos kunden (P1), och personen med en post hos kunden (P2).
    grans(await act('set_crm_sfar', { person_id: kim, sfar: 'privat' }), 'privat_person_kundkopplad_organisation');
    const besokare = ok(await act('upsert_crm_person', { name: 'Besökaren' })).id;
    ok(await act('record_crm_interaction', kontakt({ organization_id: kundOrg, person_id: besokare })));
    grans(await act('set_crm_sfar', { person_id: besokare, sfar: 'privat' }), 'privat_person_kundkopplad_post');
    // Åtagandet hos kunden (0087) och via personen (0088).
    const hosKund = ok(await act('record_crm_commitment', atagande({ organization_id: kundOrg, body: 'Hos kunden' }))).id;
    grans(await act('set_crm_sfar', { commitment_id: hosKund, sfar: 'privat' }), 'privat_atagande_kundkopplad_organisation');
    grans(await act('set_crm_sfar', { commitment_id: viaKim, sfar: 'privat' }), 'privat_atagande_kundkopplad_person');
    // Felaktiga anrop.
    for (const fel of [
      { sfar: 'privat' },
      { organization_id: blandad, person_id: besokare, sfar: 'privat' },
      { person_id: besokare, sfar: 'privat', cascade_open_commitments: true },
      { organization_id: blandad, sfar: 'hemma' },
    ]) {
      expect((await act('set_crm_sfar', fel)).status, JSON.stringify(fel)).toBe(400);
    }
    expect(await sfarPa('organizations', [kundOrg, kundstatus, blandad])).toEqual({
      [kundOrg]: 'foretag', [kundstatus]: 'foretag', [blandad]: 'foretag',
    });
    expect(await sfarPa('people', [kim, besokare])).toEqual({ [kim]: 'foretag', [besokare]: 'foretag' });
    expect(await sfarPa('commitments', [viaKim, hosKund])).toEqual({ [viaKim]: 'foretag', [hosKund]: 'foretag' });
    expect((await sfarLogg()).length, 'ingen auditrad för ett byte som inte skedde').toBe(fore);
  });

  it('B5 människan vinner: en agent byter inte en sfär en människa bestämt, och en som ingen bestämt bara med en människas godkännande', async () => {
    const token = await agentToken(companyId);
    const agent = (body: Record<string, unknown>) => api.post(`/api/companies/${companyId}/actions/set_crm_sfar`)
      .set({ Authorization: `Bearer ${token}` }).send(body) as unknown as Promise<Svar>;
    const bestamd = ok(await act('upsert_crm_organization', { name: 'Bestämd Privat', sfar: 'privat' })).id;
    const r = await agent({ organization_id: bestamd, sfar: 'foretag' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('manniskans_beslut');
    expect(await sfarPa('organizations', [bestamd])).toEqual({ [bestamd]: 'privat' });
    // Synkens organisation (ingen människa har bestämt sfären): rättningsvarv 3b,
    // krav 8. Agentens byte blir ett förslag i Att göra och verkställs först när en
    // människa godkänt det, då med människans ursprung.
    ok(await act('ingest_crm_events', { events: [{ kind: 'interaction', organization: { name: 'Synkad AB' }, occurred_at: NAR,
      source_system: 'gmail', source_ref: 'gmail:b5', channel: 'email', summary: 'Hej' }] }));
    const synkad = (await withAdmin((admin) => admin.query("SELECT id FROM crm.organizations WHERE name = 'Synkad AB'"))).rows[0].id;
    const koad = await agent({ organization_id: synkad, sfar: 'privat' });
    expect(koad.status, JSON.stringify(koad.body)).toBe(202);
    expect(await sfarPa('organizations', [synkad])).toEqual({ [synkad]: 'foretag' });
    expect((await sfarLogg()).find((x) => x.entity_id === synkad)).toBeUndefined();
    const godkant = await api.post(`/api/companies/${companyId}/approvals/${koad.body.approval.id}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
    expect(await sfarPa('organizations', [synkad])).toEqual({ [synkad]: 'privat' });
    expect((await sfarLogg()).find((x) => x.entity_id === synkad)?.details.source).toBe('human');
  });

  it('B6 ytan: «Rätta uppgifter» byter sfär med och utan kaskad, per person och per åtagande, och visar vägran', async () => {
    const ua = await inloggad(user);
    const o = await medAtaganden('Ytbytet AB');
    const person = ok(await act('upsert_crm_person', { name: 'Ytpersonen', organization_id: o.org })).id;
    const kort = await ua.get(`/app/c/${companyId}/relations/${o.org}`);
    expect(kort.status).toBe(200);
    expect(kort.text).toContain(`action="/app/c/${companyId}/relations/${o.org}/sfar"`);
    expect(kort.text).toContain('<input type="checkbox" name="cascade" value="1">');
    const vag = `/app/c/${companyId}/relations/${o.org}/sfar`;
    const back = `/app/c/${companyId}/relations/${o.org}`;

    // Utan rutan: bara organisationen.
    const utan = await ua.post(vag).type('form').send({ back, mal: 'organisation', sfar: 'privat' });
    expect(utan.status).toBe(302);
    expect(utan.headers.location).toBe(back);
    expect(await sfarPa('commitments', [o.oppet1, o.oppet2])).toEqual({ [o.oppet1]: 'foretag', [o.oppet2]: 'foretag' });
    // Med rutan: de öppna följer med, inte de stängda.
    await ua.post(vag).type('form').send({ back, mal: 'organisation', sfar: 'privat', cascade: '1' });
    expect(await sfarPa('commitments', [o.oppet1, o.oppet2, o.klart])).toEqual({
      [o.oppet1]: 'privat', [o.oppet2]: 'privat', [o.klart]: 'foretag',
    });
    // Per person och per åtagande.
    await ua.post(vag).type('form').send({ back, mal: 'person', mal_id: person, sfar: 'privat' });
    await ua.post(vag).type('form').send({ back, mal: 'atagande', mal_id: o.oppet1, sfar: 'foretag' });
    expect(await sfarPa('people', [person])).toEqual({ [person]: 'privat' });
    expect(await sfarPa('commitments', [o.oppet1])).toEqual({ [o.oppet1]: 'foretag' });
    // Vägran syns som notis med skälet.
    const kundVag = `/app/c/${companyId}/relations/${kundOrg}/sfar`;
    const vagran = await ua.post(kundVag).type('form').send({ back: `/app/c/${companyId}/relations/${kundOrg}`, mal: 'organisation', sfar: 'privat' });
    expect(vagran.status).toBe(302);
    const notis = await ua.get(String(vagran.headers.location));
    expect(notis.text).toContain('class="notice"');
    expect(notis.text).toContain('kopplad till kundregistret och kan därför inte bli privat');
    // Annat ursprung.
    const csrf = await ua.post(vag).set('Origin', 'https://angripare.example').type('form').send({ back, mal: 'organisation', sfar: 'foretag' });
    expect(csrf.status).toBe(403);
    expect(await sfarPa('organizations', [o.org, kundOrg])).toEqual({ [o.org]: 'privat', [kundOrg]: 'foretag' });
  });
});

// ---------------------------------------------------------------------------
// C: «Privat (<förnamn>)»
// ---------------------------------------------------------------------------

describe('C «Privat (<förnamn>)»: en per bolag, skapad första gången den behövs', () => {
  let companyId: string;
  let act: ReturnType<typeof bolaget>;
  let ua: ReturnType<typeof supertest.agent>;
  const privatInterna = async (id: string) => (await withAdmin((admin) => admin.query(
    "SELECT id, name, sfar, roll, status FROM crm.organizations WHERE company_id = $1 AND sfar = 'privat' AND roll = 'intern'", [id]))).rows;
  const hörTill = (text: string) => {
    const select = /<select name="org" aria-label="Hör till">([\s\S]*?)<\/select>/.exec(text)?.[1] ?? '';
    return [...select.matchAll(/<option value="([^"]*)" (selected)?>([^<]*)<\/option>/g)]
      .map((m) => ({ value: m[1], vald: m[2] === 'selected', namn: m[3] }));
  };

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Locollabs Privatprov AB');
    act = bolaget(companyId);
    ua = await inloggad(user);
    const intern = ok(await act('upsert_crm_organization', { name: 'Locollabs AB (intern)', status: 'partner' })).id;
    ok(await act('record_crm_commitment', atagande({ organization_id: intern, body: 'Bokföra november', due_date: '2026-11-30' })));
  });

  it('C1 Min sida i Privat-läget: «Privat (David)» är förvald — och sidan skapar ingenting', async () => {
    const res = await ua.get(`/app/c/${companyId}/min-sida?sfar=privat`);
    expect(res.status).toBe(200);
    expect(hörTill(res.text).filter((o) => o.vald)).toEqual([{ value: 'privat-intern', vald: true, namn: 'Privat (David)' }]);
    expect(await privatInterna(companyId), 'en GET skriver ingenting').toEqual([]);
    // I Alla-läget står den interna företagsorganisationen kvar som förval.
    const alla = await ua.get(`/app/c/${companyId}/min-sida`);
    expect(hörTill(alla.text).find((o) => o.vald)?.namn).toBe('Locollabs AB (intern)');
  });

  it('C2 snabbrutan skapar den första gången och lägger saken där, privat — och sedan inte igen', async () => {
    const back = `/app/c/${companyId}/min-sida?sfar=privat`;
    const forsta = await ua.post(`/app/c/${companyId}/min-sida/ny`).type('form')
      .send({ back, text: 'Boka tandläkare', datum: '2026-11-25', org: 'privat-intern' });
    expect(forsta.status).toBe(302);
    expect(forsta.headers.location).toBe(back);
    const rader = await privatInterna(companyId);
    expect(rader).toEqual([{ id: rader[0].id, name: 'Privat (David)', sfar: 'privat', roll: 'intern', status: 'partner' }]);
    const andra = await ua.post(`/app/c/${companyId}/min-sida/ny`).type('form')
      .send({ back, text: 'Förnya passet', org: 'privat-intern' });
    expect(andra.status).toBe(302);
    expect(await privatInterna(companyId)).toHaveLength(1);
    const saker = await withAdmin((admin) => admin.query(
      'SELECT body, sfar FROM crm.commitments WHERE organization_id = $1 ORDER BY body', [rader[0].id]));
    expect(saker.rows).toEqual([{ body: 'Boka tandläkare', sfar: 'privat' }, { body: 'Förnya passet', sfar: 'privat' }]);
    // Nu är den riktiga raden förvald.
    const res = await ua.get(`/app/c/${companyId}/min-sida?sfar=privat`);
    expect(hörTill(res.text).filter((o) => o.vald)).toEqual([{ value: rader[0].id, vald: true, namn: 'Privat (David)' }]);
    const logg = await crmLogg(companyId, 'crm.organization_created');
    expect(logg.filter((r) => r.details.privat_intern)).toEqual([{
      entity_id: rader[0].id,
      details: { status: 'partner', sfar: 'privat', roll: 'intern', linked_customer: false, source: 'human', privat_intern: true },
    }]);
  });

  it('C3 idempotent också samtidigt: tre parallella första gånger ger en rad', async () => {
    const nytt = await createCompany(user.token, 'Samtidigt Privat AB');
    const svar = await Promise.all([1, 2, 3].map(() =>
      withTenantTransaction(user.userId, nytt, (client) => sakerstallPrivatIntern(client, nytt, user.userId, 'human'))));
    expect(new Set(svar.map((s) => s.id)).size).toBe(1);
    expect(svar.filter((s) => s.created)).toHaveLength(1);
    expect(await privatInterna(nytt)).toHaveLength(1);
  });

  it('C4 samma väg för agenten: record_crm_commitment med privat_intern, aldrig tillsammans med organization_id', async () => {
    const nytt = await createCompany(user.token, 'Agentens Privat AB');
    const token = await agentToken(nytt);
    const agent = (body: Record<string, unknown>) => api.post(`/api/companies/${nytt}/actions/record_crm_commitment`)
      .set({ Authorization: `Bearer ${token}` }).send(body) as unknown as Promise<Svar>;
    const forsta = ok(await agent(atagande({ privat_intern: true, body: 'Förnya körkortet' })));
    const andra = ok(await agent(atagande({ privat_intern: true, body: 'Boka service på bilen' })));
    expect([forsta.sfar, andra.sfar]).toEqual(['privat', 'privat']);
    const rader = await privatInterna(nytt);
    expect(rader).toHaveLength(1);
    const pa = await withAdmin((admin) => admin.query(
      'SELECT count(*)::int AS n FROM crm.commitments WHERE organization_id = $1', [rader[0].id]));
    expect(pa.rows[0].n).toBe(2);
    const annan = ok(await bolaget(nytt)('upsert_crm_organization', { name: 'Någon Annan AB' })).id;
    expect((await agent(atagande({ privat_intern: true, organization_id: annan }))).status).toBe(400);
    expect((await agent(atagande({ privat_intern: false, organization_id: annan }))).status).toBe(400);
  });

  it('C5 namnet upptaget av en annan organisation: ingen gissning, ett begripligt fel', async () => {
    const nytt = await createCompany(user.token, 'Upptaget Namn AB');
    ok(await bolaget(nytt)('upsert_crm_organization', { name: 'Privat (David)' }));
    const res = await ua.post(`/app/c/${nytt}/min-sida/ny`).type('form').send({ text: 'Något', org: 'privat-intern' });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(String(res.headers.location))).toContain('heter redan Privat (David)');
    expect(await privatInterna(nytt)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D: förslaget på privata poster (krav 8)
// ---------------------------------------------------------------------------

/** Kortet på Min sida för ett åtagande. */
function kortFor(text: string, id: string): string {
  const start = text.indexOf(`id="k-${id.slice(0, 8)}"`);
  expect(start, `kortet för ${id}`).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf('</article>', start));
}

/** Alla filer under src, med sökväg relativt src. */
function kallfiler(dir = fileURLToPath(new URL('../src', import.meta.url)), rot = dir): string[] {
  return readdirSync(dir).flatMap((namn) => {
    const full = path.join(dir, namn);
    return statSync(full).isDirectory() ? kallfiler(full, rot) : [path.relative(rot, full)];
  });
}

describe('D förslaget: David godkänner, inget flyttas före det', () => {
  let companyId: string;
  let act: ReturnType<typeof bolaget>;
  let ua: ReturnType<typeof supertest.agent>;
  const id = {} as {
    svealand: string; avtal: string; elavtal: string; svealandKlart: string; intern: string; tandlakare: string;
    takpannor: string; isk: string; offert: string; lakarKlart: string; kundOrg: string; kim: string;
    hamtaBarnen: string; elnat: string; natavtal: string; bilverkstad: string; nvr: string; privatIntern: string;
  };
  let flyttId: string;
  let kvittoVag: string;
  const forslagVag = () => `/app/c/${companyId}/relations/privata-forslag`;
  const flyttVag = () => `${forslagVag()}/flytta`;
  const angraVag = () => `${forslagVag()}/angra`;
  /** Rättningsvarv 3b: en omdirigering från förslagssidan bär bara en kod och en radnyckel, aldrig text. */
  const feladress = () => new RegExp(`^/app/c/${companyId}/relations/privata-forslag(/kvitto/${UUID})?`
    + `(\\?(fel=[a-z_]+(&rad=(organisation|atagande):${UUID})?|angrad=1))?$`);

  /** Allt flytten kan röra, plus loggarnas längd: en läsning ska lämna det exakt som det var. */
  const ogonblick = () => withAdmin(async (admin) => ({
    organisationer: (await admin.query(
      'SELECT id, name, sfar, roll, customer_id, status, notes FROM crm.organizations WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    personer: (await admin.query('SELECT id, sfar, organization_id FROM crm.people WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    ataganden: (await admin.query(
      'SELECT id, organization_id, person_id, sfar, status, body FROM crm.commitments WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    ursprung: (await admin.query(
      'SELECT organization_id, person_id, field, source FROM crm.field_provenance WHERE company_id = $1 ORDER BY 1, 2, 3', [companyId])).rows,
    crmLogg: (await admin.query('SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1', [companyId])).rows[0].n,
  }));
  /** De rader flytten och ångra rör, kolumn för kolumn. */
  const raderna = (ids: string[]) => withAdmin(async (admin) => ({
    organisationer: (await admin.query(
      'SELECT id, name, sfar, roll, customer_id, status, notes FROM crm.organizations WHERE id = ANY($1::uuid[]) ORDER BY id', [ids])).rows,
    ataganden: (await admin.query(
      'SELECT id, organization_id, person_id, sfar, status, body, due_date::text FROM crm.commitments WHERE id = ANY($1::uuid[]) ORDER BY id', [ids])).rows,
  }));
  let foreFlytten: Awaited<ReturnType<typeof raderna>>;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Locollabs Förslag AB');
    act = bolaget(companyId);
    ua = await inloggad(user);
    const at = async (org: string, body: string, extra: Record<string, unknown> = {}) =>
      ok(await act('record_crm_commitment', atagande({ organization_id: org, body, ...extra }))).id as string;

    // Svealand som den ligger i drift: partner, en markering i anteckningen, två öppna ärenden.
    id.svealand = ok(await act('upsert_crm_organization', {
      name: 'Svealands Elbolag AB', status: 'partner', notes: 'Privat leverantör till David (el till huset).',
    })).id;
    id.avtal = await at(id.svealand, 'Avtalskopior från Svealand', { due_date: '2026-11-25' });
    id.elavtal = await at(id.svealand, 'Byte av elavtal', { due_date: '2026-11-19' });
    id.svealandKlart = await at(id.svealand, 'Första fakturan från Svealand betald');
    ok(await act('set_crm_commitment_status', { commitment_id: id.svealandKlart, status: 'done' }));

    // Den interna organisationen och dess åtaganden.
    id.intern = ok(await act('upsert_crm_organization', { name: 'Locollabs AB (intern)', status: 'partner' })).id;
    id.tandlakare = await at(id.intern, 'Boka tandläkare', { due_date: '2026-11-28' });
    id.takpannor = await at(id.intern, 'Byt takpannor på huset');
    id.isk = await at(id.intern, 'Flytta ISK-sparandet');
    id.offert = await at(id.intern, 'Skicka offert till NVR');
    id.lakarKlart = await at(id.intern, 'Läkarintyg till försäkringen');
    ok(await act('set_crm_commitment_status', { commitment_id: id.lakarKlart, status: 'done' }));
    const kund = ok(await act('create_customer', { name: 'Kundbolaget AB' })).id;
    id.kundOrg = ok(await act('upsert_crm_organization', {
      name: 'Kundbolaget AB', customer_id: kund, notes: 'Privata önskemål om fakturering.',
    })).id;
    id.kim = ok(await act('upsert_crm_person', { name: 'Kim på kundbolaget', organization_id: id.kundOrg })).id;
    id.hamtaBarnen = await at(id.intern, 'Hämta barnen på förskolan', { person_id: id.kim });

    // Anteckningen markerar privat, utan kund- eller leverantörskoppling.
    id.elnat = ok(await act('upsert_crm_organization', {
      name: 'Hemmets Elnät', notes: 'Elnätet till villan. Privat avtal, inte bolagets.',
    })).id;
    id.natavtal = await at(id.elnat, 'Säg upp nätavtalet');
    // Anteckningen säger privat, men organisationen finns i leverantörsregistret.
    id.bilverkstad = ok(await act('upsert_crm_organization', { name: 'Bilverkstaden AB', notes: 'privat bil' })).id;
    ok(await act('create_supplier', { name: 'Bilverkstaden AB' }));
    id.nvr = ok(await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB' })).id;
  });

  it('D1 förslaget: rätt rader med skälet på varje, bara Svealand förkryssad, och raden med hinder går inte att kryssa i', async () => {
    const f = ok(await act('list_crm_privata_forslag'));
    expect(f.privat_intern).toEqual({ id: null, namn: 'Privat (David)' });
    const per = Object.fromEntries(f.rader.map((r: Rad) => [r.nyckel, r]));
    expect(Object.keys(per).sort()).toEqual([
      `organisation:${id.svealand}`, `organisation:${id.elnat}`,
      `atagande:${id.tandlakare}`, `atagande:${id.takpannor}`, `atagande:${id.isk}`, `atagande:${id.hamtaBarnen}`,
    ].sort());
    expect(per[`organisation:${id.svealand}`]).toMatchObject({
      regel: 'svealand', forkryssad: true, hinder: null, oppna_ataganden: 2,
      skal: 'Leverantör till dig personligen, inte till bolaget (din beställning 9/11).',
      forslag: 'Privat, roll leverantör — de 2 öppna åtagandena följer med.',
    });
    expect(per[`organisation:${id.elnat}`]).toMatchObject({
      regel: 'anteckning', forkryssad: false, hinder: null, oppna_ataganden: 1,
      skal: 'Anteckningen markerar den som privat: «Privat avtal, inte bolagets». Ingen koppling till kund- eller leverantörsregistret.',
      forslag: 'Privat — det öppna åtagandet följer med.',
    });
    const internt = (nyckel: string) => per[nyckel] as Rad;
    expect(internt(`atagande:${id.tandlakare}`)).toMatchObject({
      regel: 'intern_text', organisation: 'Locollabs AB (intern)', forkryssad: false, hinder: null,
      skal: 'Texten pekar på hälsa («tandläkare»).',
      forslag: 'Flytta till Privat (David) (skapas vid flytten) och gör det privat.',
    });
    expect(internt(`atagande:${id.takpannor}`).skal).toBe('Texten pekar på hus («huset»).');
    expect(internt(`atagande:${id.isk}`).skal).toBe('Texten pekar på privatekonomi («ISK»).');
    expect(internt(`atagande:${id.hamtaBarnen}`)).toMatchObject({
      skal: 'Texten pekar på familj («barnen»).',
      hinder: 'personen på åtagandet hör till en kund, och ett privat åtagande kan inte ligga där',
    });

    const sida = await ua.get(forslagVag());
    expect(sida.status).toBe(200);
    const rutor = [...sida.text.matchAll(/<input type="checkbox" name="val" value="([^"]+)" id="pf-\d+"( checked)?( disabled)?>/g)]
      .map((m) => ({ nyckel: m[1], ikryssad: Boolean(m[2]), last: Boolean(m[3]) }));
    expect(rutor).toHaveLength(6);
    expect(rutor.filter((r) => r.ikryssad)).toEqual([{ nyckel: `organisation:${id.svealand}`, ikryssad: true, last: false }]);
    expect(rutor.filter((r) => r.last)).toEqual([{ nyckel: `atagande:${id.hamtaBarnen}`, ikryssad: false, last: true }]);
    expect(sida.text).toContain('Flytta de valda till Privat');
    expect(sida.text).toContain('Texten pekar på hälsa («tandläkare»).');
    // Länkarna dit: relationslistan och Min sida.
    for (const vag of [`/app/c/${companyId}/relations`, `/app/c/${companyId}/min-sida`]) {
      expect((await ua.get(vag)).text).toContain(`href="${forslagVag()}"`);
    }
  });

  it('D2 att läsa förslaget rör ingenting — sidan, åtgärden, agenten och Min sida i Privat-läget', async () => {
    const fore = await ogonblick();
    await ua.get(forslagVag());
    ok(await act('list_crm_privata_forslag'));
    const token = await agentToken(companyId);
    const agentLas = await api.post(`/api/companies/${companyId}/actions/list_crm_privata_forslag`)
      .set({ Authorization: `Bearer ${token}` }).send({});
    expect(agentLas.status).toBe(200);
    expect(agentLas.body.result.rader).toHaveLength(6);
    await ua.get(`/app/c/${companyId}/min-sida?sfar=privat`);
    expect(await ogonblick()).toEqual(fore);
  });

  it('D3 agenten kan läsa men inte verkställa: ingen åtgärd flyttar listan, och vyns väg släpper inte in den', async () => {
    const fore = await ogonblick();
    const token = await agentToken(companyId);
    const kropp = formular([['val', `organisation:${id.svealand}`]]);
    // Som Bearer: vyns POST-vägar har ingen agentväg (auth.ts), det blir inloggningen.
    const bearer = await supertest(app).post(flyttVag()).set({ Authorization: `Bearer ${token}` }).type('form').send(kropp);
    expect(bearer.status).toBe(302);
    expect(String(bearer.headers.location)).toMatch(/^\/app\/login/);
    // Som sessionskaka: ett agent-token är aldrig en webbsession.
    const kaka = await supertest(app).post(flyttVag()).set('Cookie', `session=${token}`).type('form').send(kropp);
    expect(kaka.status).toBe(302);
    expect(String(kaka.headers.location)).toMatch(/^\/app\/login/);
    // Manifestet (som MCP speglar): förslaget är en läsning, och ingen åtgärd heter något med flytt.
    const manifest = actionManifest();
    expect(manifest.find((a) => a.name === 'list_crm_privata_forslag')).toMatchObject({ sensitivity: 'read', requires_approval: false });
    expect(manifest.filter((a) => /flytt|privata_forslag/.test(a.name)).map((a) => a.name)).toEqual(['list_crm_privata_forslag']);
    // Källkoden: flytten och ångra anropas bara från vyn.
    const anropare = kallfiler().filter((f) => /\.ts$/.test(f)).filter((f) => {
      const text = readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
      return /flyttaTillPrivat\(|angraPrivatFlytt\(/.test(text);
    }).sort();
    expect(anropare).toEqual([path.join('http', 'view', 'routes.ts'), path.join('services', 'crmPrivat.ts')]);
    expect(await ogonblick()).toEqual(fore);
  });

  it('D4 bara ägaren, i en webbsession, från samma ursprung', async () => {
    const fore = await ogonblick();
    const medlem = await registerUser('sfar3-medlem');
    await withAdmin((admin) => admin.query(
      "INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'member')", [companyId, medlem.userId]));
    const mua = await inloggad(medlem);
    const sida = await mua.get(forslagVag());
    expect(sida.status).toBe(200);
    expect(sida.text).not.toContain('Flytta de valda till Privat');
    expect(sida.text).toContain('Bara bolagets ägare kan flytta poster till Privat.');
    const kropp = formular([['val', `organisation:${id.svealand}`]]);
    expect((await mua.post(flyttVag()).type('form').send(kropp)).status).toBe(403);
    expect((await ua.post(flyttVag()).set('Origin', 'https://angripare.example').type('form').send(kropp)).status).toBe(403);
    const utan = await supertest(app).post(flyttVag()).type('form').send(kropp);
    expect(utan.status).toBe(302);
    expect(String(utan.headers.location)).toMatch(/^\/app\/login/);
    const annat = await registerUser('sfar3-utomstaende');
    expect([403, 404]).toContain((await (await inloggad(annat)).post(flyttVag()).type('form').send(kropp)).status);
    expect(await ogonblick()).toEqual(fore);
  });

  it('D5 knappen: bara de kryssade raderna flyttas, i en transaktion med en auditrad per rad', async () => {
    foreFlytten = await raderna([id.svealand, id.avtal, id.elavtal, id.svealandKlart, id.tandlakare]);
    const ovriga = await raderna([id.elnat, id.natavtal, id.takpannor, id.isk, id.hamtaBarnen, id.offert, id.lakarKlart]);
    const res = await ua.post(flyttVag()).type('form')
      .send(formular([['val', `organisation:${id.svealand}`], ['val', `atagande:${id.tandlakare}`]]));
    expect(res.status).toBe(303);
    kvittoVag = String(res.headers.location);
    const m = /\/kvitto\/([0-9a-f-]{36})$/.exec(kvittoVag);
    expect(m, kvittoVag).not.toBeNull();
    flyttId = m![1]!;

    const efter = await raderna([id.svealand, id.avtal, id.elavtal, id.svealandKlart, id.tandlakare]);
    const privatIntern = (await withAdmin((admin) => admin.query(
      "SELECT id, name, roll FROM crm.organizations WHERE company_id = $1 AND sfar = 'privat' AND roll = 'intern'", [companyId]))).rows;
    expect(privatIntern).toEqual([{ id: privatIntern[0].id, name: 'Privat (David)', roll: 'intern' }]);
    id.privatIntern = privatIntern[0].id;
    expect(efter.organisationer).toEqual([{ ...foreFlytten.organisationer[0], sfar: 'privat', roll: 'leverantor' }]);
    const sfarEfter = Object.fromEntries(efter.ataganden.map((c) => [c.id, [c.sfar, c.organization_id]]));
    expect(sfarEfter).toEqual({
      [id.avtal]: ['privat', id.svealand], [id.elavtal]: ['privat', id.svealand],
      [id.svealandKlart]: ['foretag', id.svealand], // klart: rörs inte
      [id.tandlakare]: ['privat', id.privatIntern],
    });
    expect(await raderna([id.elnat, id.natavtal, id.takpannor, id.isk, id.hamtaBarnen, id.offert, id.lakarKlart]),
      'det som inte kryssades i är orört').toEqual(ovriga);

    const flytt = await crmLogg(companyId, 'crm.privat_flytt');
    expect(flytt.map((r) => r.entity_id).sort()).toEqual([id.svealand, id.tandlakare].sort());
    const sv = flytt.find((r) => r.entity_id === id.svealand)!.details;
    expect({ ...sv, foljde_med: [...sv.foljde_med].sort() }).toEqual({
      flytt_id: flyttId, slag: 'organisation', regel: 'svealand',
      fran: { sfar: 'foretag', roll: null }, till: { sfar: 'privat', roll: 'leverantor' },
      foljde_med: [id.avtal, id.elavtal].sort(), foljde_med_fran: 'foretag',
    });
    expect(flytt.find((r) => r.entity_id === id.tandlakare)!.details).toEqual({
      flytt_id: flyttId, slag: 'atagande', regel: 'intern_text',
      fran: { sfar: 'foretag', organization_id: id.intern }, till: { sfar: 'privat', organization_id: id.privatIntern },
    });
    expect((await crmLogg(companyId, 'crm.privat_flytt_klar')).map((r) => r.details))
      .toEqual([{ flytt_id: flyttId, organisationer: 1, ataganden: 1 }]);
    // Svealand bär nu ett människobeslut: en agent flyttar inte tillbaka den.
    const token = await agentToken(companyId);
    const agent = await api.post(`/api/companies/${companyId}/actions/upsert_crm_organization`)
      .set({ Authorization: `Bearer ${token}` }).send({ name: 'Svealands Elbolag AB', sfar: 'foretag' });
    expect(agent.body.result.sfar).toBe('privat');
  });

  it('D6 svepet från steg 1 är grönt EFTER flytten: inget privat id och inget privat namn i bokföringens tabeller', async () => {
    const utfall = await withAdmin(async (admin) => {
      const ids = (await privataId(admin)).map((p) => p.id);
      const traffar = await svepaBokforingen(admin, ids);
      const kon = await admin.query<{ action: string }>(
        'SELECT DISTINCT t.action FROM action_approvals t WHERE t::text LIKE ANY($1::text[]) ORDER BY t.action',
        [ids.map((x) => `%${x}%`)]);
      const namn = await svepaBokforingen(admin, ['Svealands Elbolag', 'Privat (David)', 'Boka tandläkare', 'Avtalskopior från Svealand']);
      return { ids, traffar, kon: kon.rows.map((r) => r.action), namn };
    });
    expect(utfall.ids).toEqual(expect.arrayContaining([id.svealand, id.avtal, id.elavtal, id.tandlakare, id.privatIntern]));
    expect(utfall.traffar.filter((t) => t !== 'action_approvals')).toEqual([]);
    // Rättningsvarv 3b: B5:s godkända sfärbyte ligger i kön med sina id:n (se S1).
    for (const a of utfall.kon) expect(['merge_crm_organizations', 'merge_crm_people', 'set_crm_sfar']).toContain(a);
    expect(utfall.namn).toEqual([]);
  });

  it('D7 förfalskat, med hinder eller tomt: ingenting flyttas, och sidan säger varför', async () => {
    const fore = await ogonblick();
    const fall: [[string, string][], string][] = [
      [[['val', `organisation:${id.nvr}`]], 'står inte längre bland förslagen'],
      [[['val', `atagande:${id.offert}`]], 'står inte längre bland förslagen'],
      [[['val', `organisation:${id.bilverkstad}`]], 'står inte längre bland förslagen'],
      [[['val', `atagande:${id.hamtaBarnen}`]], 'kan inte flyttas: personen på åtagandet hör till en kund'],
      // En giltig och en ogiltig: inte ens den giltiga flyttas.
      [[['val', `organisation:${id.elnat}`], ['val', `organisation:${id.nvr}`]], 'står inte längre bland förslagen'],
      [[['val', 'organisation:inte-ett-id']], 'står inte längre bland förslagen'],
      [[], 'Kryssa i minst en rad'],
    ];
    for (const [val, text] of fall) {
      const r = await ua.post(flyttVag()).type('form').send(formular(val));
      expect(r.status, JSON.stringify(val)).toBe(303);
      // Rättningsvarv 3b: adressen bär koden, sidan ritar texten.
      const adress = String(r.headers.location);
      expect(adress, JSON.stringify(val)).toMatch(feladress());
      expect((await ua.get(adress)).text, JSON.stringify(val)).toContain(text);
    }
    expect((await ua.get(`${forslagVag()}?fel=inget_valt`)).text)
      .toContain('<p class="notice">Kryssa i minst en rad att flytta.</p>');
    // Fritext i adressen ritas inte: sidan känner bara sina koder.
    const smuggel = await ua.get(`${forslagVag()}?fel=${encodeURIComponent('Boka tandläkare')}`);
    expect(smuggel.status).toBe(200);
    expect(smuggel.text).not.toContain('<p class="notice">');
    expect(await ogonblick()).toEqual(fore);
  });

  it('D8 kvittot visar vad som flyttades; ångra återställer exakt, en gång', async () => {
    const kvitto = await ua.get(kvittoVag);
    expect(kvitto.status).toBe(200);
    expect(kvitto.text).toContain('Svealands Elbolag AB: Företag → Privat, roll — → Leverantör · 2 öppna åtaganden följde med');
    expect(kvitto.text).toContain('Boka tandläkare: Locollabs AB (intern) → Privat (David), Företag → Privat');
    expect(kvitto.text.match(/<button class="btn btn--ghost btn--sm" type="submit">Ångra<\/button>/g)).toHaveLength(2);

    for (const nyckel of [`organisation:${id.svealand}`, `atagande:${id.tandlakare}`]) {
      const a = await ua.post(angraVag()).type('form').send({ flytt_id: flyttId, nyckel });
      expect(a.status, nyckel).toBe(303);
      expect(a.headers.location).toBe(`${kvittoVag}?angrad=1`);
    }
    expect(await raderna([id.svealand, id.avtal, id.elavtal, id.svealandKlart, id.tandlakare]), 'exakt som före flytten')
      .toEqual(foreFlytten);

    // En gång: andra försöket ändrar ingenting.
    const fore = await ogonblick();
    const igen = await ua.post(angraVag()).type('form').send({ flytt_id: flyttId, nyckel: `organisation:${id.svealand}` });
    expect(igen.headers.location).toBe(`${kvittoVag}?fel=redan_angrad&rad=organisation:${id.svealand}`);
    expect((await ua.get(String(igen.headers.location))).text).toContain('<p class="notice">Raden är redan ångrad.</p>');
    expect(await ogonblick()).toEqual(fore);
    const efter = await ua.get(kvittoVag);
    expect(efter.text.match(/<span class="chip chip--muted">Ångrad<\/span>/g)).toHaveLength(2);
    expect(efter.text).not.toContain('type="submit">Ångra</button>');
    expect((await crmLogg(companyId, 'crm.privat_flytt_angrad')).map((r) => r.entity_id).sort())
      .toEqual([id.svealand, id.tandlakare].sort());

    // Ett ogiltigt id är 404, och kvittot går inte att läsa eller ångra från ett annat bolag.
    expect((await ua.get(`${forslagVag()}/kvitto/inte-ett-id`)).status).toBe(404);
    expect((await ua.post(angraVag()).type('form').send({ flytt_id: 'inte-ett-id', nyckel: `organisation:${id.svealand}` })).status).toBe(404);
    const annat = await createCompany(user.token, 'Annat Bolag AB');
    expect((await ua.get(`/app/c/${annat}/relations/privata-forslag/kvitto/${flyttId}`)).status).toBe(404);
    expect((await ua.post(`/app/c/${annat}/relations/privata-forslag/angra`).type('form')
      .send({ flytt_id: flyttId, nyckel: `atagande:${id.tandlakare}` })).status).toBe(404);
  });

  it('D9 ångra vägrar när posten ändrats efter flytten, och bara ägaren kan ångra', async () => {
    const res = await ua.post(flyttVag()).type('form').send(formular([['val', `atagande:${id.takpannor}`]]));
    const flytt2 = /\/kvitto\/([0-9a-f-]{36})$/.exec(String(res.headers.location))![1]!;
    const medlem = await registerUser('sfar3-medlem2');
    await withAdmin((admin) => admin.query(
      "INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'member')", [companyId, medlem.userId]));
    expect((await (await inloggad(medlem)).post(angraVag()).type('form')
      .send({ flytt_id: flytt2, nyckel: `atagande:${id.takpannor}` })).status).toBe(403);

    ok(await act('set_crm_sfar', { commitment_id: id.takpannor, sfar: 'foretag' }));
    const fore = await ogonblick();
    const a = await ua.post(angraVag()).type('form').send({ flytt_id: flytt2, nyckel: `atagande:${id.takpannor}` });
    expect(String(a.headers.location)).toMatch(feladress());
    expect((await ua.get(String(a.headers.location))).text).toContain('Posten har ändrats efter flytten');
    expect(await ogonblick()).toEqual(fore);
    const rad = (await raderna([id.takpannor])).ataganden[0];
    expect([rad.organization_id, rad.sfar]).toEqual([id.privatIntern, 'foretag']);
  });

  it('D10 ingen omdirigering från förslagssidan bär fritext: bara en kod och en radnyckel, och texten ritas ur databasen', async () => {
    // Rättningsvarv 3b (crmsfar3_granskning1): felet för en rad med hinder citerade
    // åtagandets text i ?fel=, och en adress hamnar i åtkomstloggar och historik.
    const fritext = (await withAdmin((admin) => admin.query<{ t: string }>(
      `SELECT name AS t FROM crm.organizations WHERE company_id = $1
       UNION ALL SELECT body FROM crm.commitments WHERE company_id = $1
       UNION ALL SELECT name FROM crm.people WHERE company_id = $1`, [companyId]))).rows.map((r) => r.t);
    expect(fritext).toEqual(expect.arrayContaining(['Hämta barnen på förskolan', 'Svealands Elbolag AB', 'Privat (David)']));
    const flytt2 = (await crmLogg(companyId, 'crm.privat_flytt')).find((r) => r.entity_id === id.takpannor)!.details.flytt_id as string;
    const adresser: string[] = [];
    const posta = async (vag: string, kropp: string | Rad): Promise<string> => {
      const r = await ua.post(vag).type('form').send(kropp);
      expect(r.status, JSON.stringify(kropp)).toBe(303);
      adresser.push(String(r.headers.location));
      return String(r.headers.location);
    };
    // Flytten: hinder, utanför förslaget, tomt, och en som går igenom.
    const hinder = await posta(flyttVag(), formular([['val', `atagande:${id.hamtaBarnen}`]]));
    await posta(flyttVag(), formular([['val', `organisation:${id.nvr}`]]));
    await posta(flyttVag(), formular([]));
    const kvitto = await posta(flyttVag(), formular([['val', `organisation:${id.elnat}`]]));
    const nyFlytt = /\/kvitto\/([0-9a-f-]{36})$/.exec(kvitto)![1]!;
    // Ångra: en som går igenom, redan ångrad, ändrad efter flytten, okänd rad.
    await posta(angraVag(), { flytt_id: nyFlytt, nyckel: `organisation:${id.elnat}` });
    await posta(angraVag(), { flytt_id: flyttId, nyckel: `organisation:${id.svealand}` });
    await posta(angraVag(), { flytt_id: flytt2, nyckel: `atagande:${id.takpannor}` });
    await posta(angraVag(), { flytt_id: flyttId, nyckel: 'atagande:inte-en-rad' });

    expect(adresser).toHaveLength(8);
    for (const a of adresser) {
      expect(a).toMatch(feladress());
      for (const t of fritext) expect(decodeURIComponent(a), a).not.toContain(t);
    }
    expect(hinder).toBe(`${forslagVag()}?fel=forslaget_har_hinder&rad=atagande:${id.hamtaBarnen}`);
    expect((await ua.get(hinder)).text).toContain(
      '<p class="notice">«Hämta barnen på förskolan» kan inte flyttas: personen på åtagandet hör till en kund, och ett privat åtagande kan inte ligga där.</p>');
  });
});

// ---------------------------------------------------------------------------
// E: dagsytan
// ---------------------------------------------------------------------------

describe('E dagsytan: en privat relation får aldrig prospektskäl eller «ingen registrerad kontakt alls»', () => {
  let companyId: string;
  let act: ReturnType<typeof bolaget>;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Dagsytan Privat AB');
    act = bolaget(companyId);
    ok(await act('upsert_crm_organization', { name: 'Prospektet AB' }));
    ok(await act('upsert_crm_organization', { name: 'Grannen', sfar: 'privat' }));
    const elnat = ok(await act('upsert_crm_organization', { name: 'Elnätet Hemma', sfar: 'privat' })).id;
    ok(await act('record_crm_commitment', atagande({ organization_id: elnat, body: 'Byt elavtal', due_date: '2026-11-01' })));
  });

  it('E1 crm_today och crm_contact_suggestions: företagsprospektet har skälen, de privata inte', async () => {
    const skal = (rader: Rad[]) => Object.fromEntries(rader.map((r) => [r.organization, r.reasons]));
    const forvantat = {
      'Prospektet AB': ['ingen registrerad kontakt alls', 'prospekt — affären finns bara så länge dialogen finns'],
      // Den privata kommer med för sitt förfallna löfte, och bara för det.
      'Elnätet Hemma': ['vi lovade: Byt elavtal — förföll 2026-11-01'],
    };
    expect(skal(ok(await act('crm_today', { as_of: '2026-11-18' })).relations)).toEqual(forvantat);
    expect(skal(ok(await act('crm_contact_suggestions', { as_of: '2026-11-18' })).suggestions)).toEqual(forvantat);
    expect(skal(ok(await act('crm_today', { as_of: '2026-11-18', sfar: 'privat' })).relations))
      .toEqual({ 'Elnätet Hemma': forvantat['Elnätet Hemma'] });
  });

  it('E2 Idag: den privata relationens kort bär inget Prospekt-märke, företagsprospektets gör det', async () => {
    const ua = await inloggad(user);
    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.status).toBe(200);
    const kort = (namn: string) => res.text.split('<article class="today__card">').find((k) => k.includes(`>${namn}</a>`)) ?? '';
    expect(kort('Prospektet AB')).toContain('<span class="chip chip--info">Prospekt</span>');
    expect(kort('Elnätet Hemma')).toContain('vi lovade: Byt elavtal');
    expect(kort('Elnätet Hemma')).not.toContain('Prospekt');
    expect(res.text).not.toContain('>Grannen</a>');
  });
});

// ---------------------------------------------------------------------------
// F: krav 9, kopplingen till /privat
// ---------------------------------------------------------------------------

describe('F krav 9: ett privat ärende hos en leverantör länkar till hushållets budget, utan dubbelregistrering', () => {
  it('F1 Min sida: länken till /privat på det privata ärendet hos leverantören, inte på de andra', async () => {
    const companyId = await createCompany(user.token, 'Hushållslänken AB');
    const act = bolaget(companyId);
    const ua = await inloggad(user);
    const sv = ok(await act('upsert_crm_organization', { name: 'Svealands Elbolag AB', sfar: 'privat', roll: 'leverantor' })).id;
    const granne = ok(await act('upsert_crm_organization', { name: 'Grannföreningen', sfar: 'privat' })).id;
    const nvr = ok(await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB', roll: 'leverantor' })).id;
    const elavtal = ok(await act('record_crm_commitment', atagande({ organization_id: sv, body: 'Byte av elavtal', due_date: '2026-11-19' }))).id;
    const stamma = ok(await act('record_crm_commitment', atagande({ organization_id: granne, body: 'Föreningsstämman', due_date: '2026-11-20' }))).id;
    const offert = ok(await act('record_crm_commitment', atagande({ organization_id: nvr, body: 'Skicka offerten', due_date: '2026-11-21' }))).id;
    const res = await ua.get(`/app/c/${companyId}/min-sida`);
    const lank = '<a href="/privat" target="_blank" rel="noopener">Hushållets budget ↗</a>';
    expect(kortFor(res.text, elavtal)).toContain(lank);
    expect(kortFor(res.text, stamma)).not.toContain('href="/privat"');
    expect(kortFor(res.text, offert)).not.toContain('href="/privat"');
    // Ingen dubbelregistrering: åtagandet bär rollen ur organisationen, inga belopp eller budgetposter.
    const rad = ok(await act('list_crm_commitments', { sfar: 'privat' })).find((c: Rad) => c.id === elavtal);
    expect(rad.organization_roll).toBe('leverantor');
    expect(Object.keys(rad).filter((k) => /belopp|amount|ore|budget/i.test(k))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R: rättningsvarv 3b (leads beslut 18/11 efter crmsfar3_granskning1)
//
//   R1–R5 krav 8: en agent byter aldrig sfär (eller roll) på en befintlig post
//         utan Davids beslut. set_crm_sfar från en agent blir ett förslag i Att
//         göra; upsert och en omsänd händelse vägras med hänvisning dit. En
//         människa verkställer direkt, och ett godkänt förslag verkställs med
//         auditlogg.
//   R6–R8 kaskaden och ångra rör aldrig ett åtagande som inte är öppet, inte
//         heller när det stängs mellan urvalet och skrivningen.
//   Fritexten i adressen prövas i D7–D10.
// ---------------------------------------------------------------------------

/**
 * Kör fn i en tenanttransaktion som filens användare och lämnar anslutningens pid
 * innan fn börjar, så att provet kan vänta tills transaktionen står på ett radlås.
 */
function iTransaktion<T>(companyId: string, fn: (client: PoolClient) => Promise<T>): { pid: Promise<number>; utfall: Promise<T> } {
  let ge!: (pid: number) => void;
  const pidLofte = new Promise<number>((r) => { ge = r; });
  const utfall = withTenantTransaction(user.userId, companyId, async (client) => {
    ge((await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
    return fn(client);
  });
  // Fäller transaktionen innan fn börjar ska provet inte hänga på pid:en.
  return { pid: Promise.race([pidLofte, utfall.then(() => -1, () => -1)]), utfall };
}

describe('R krav 8: en agents sfärbyte på en befintlig post väntar på Davids beslut', () => {
  let companyId: string;
  let act: ReturnType<typeof bolaget>;
  let token: string;
  let agent: (name: string, body: Record<string, unknown>) => Promise<Svar>;
  let ua: ReturnType<typeof supertest.agent>;
  const id = {} as {
    org: string; oppet1: string; oppet2: string; klart: string; grannen: string; person: string; atagande: string;
    privatOrg: string; privatPerson: string; kundOrg: string;
  };

  /** Allt ett sfärbyte kan röra i bolaget, plus crm-loggens längd. */
  const ogonblick = () => withAdmin(async (admin) => ({
    organisationer: (await admin.query(
      'SELECT id, sfar, roll, status, notes FROM crm.organizations WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    personer: (await admin.query('SELECT id, sfar, organization_id FROM crm.people WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    ataganden: (await admin.query(
      'SELECT id, sfar, organization_id, status, body FROM crm.commitments WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    ursprung: (await admin.query(
      'SELECT organization_id, person_id, field, source FROM crm.field_provenance WHERE company_id = $1 ORDER BY 1, 2, 3', [companyId])).rows,
    crmLogg: (await admin.query('SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1', [companyId])).rows[0].n,
  }));
  const kon = async () => (await withAdmin((admin) => admin.query<{ id: string; action: string; status: string; input: Rad; requested_actor: string }>(
    'SELECT id, action, status, input, requested_actor FROM action_approvals WHERE company_id = $1 ORDER BY created_at, id', [companyId]))).rows;
  const logg = async (action: string) => (await withAdmin((admin) => admin.query<{ entity_id: string; details: Rad }>(
    'SELECT entity_id, details FROM audit_log WHERE company_id = $1 AND action = $2 ORDER BY id', [companyId, action]))).rows;
  const sfarPa = async (tabell: 'organizations' | 'people' | 'commitments', ids: string[]) => Object.fromEntries(
    (await withAdmin((admin) => admin.query<{ id: string; sfar: string }>(
      `SELECT id, sfar FROM crm.${tabell} WHERE id = ANY($1::uuid[])`, [ids]))).rows.map((r) => [r.id, r.sfar]));

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Agentkön AB');
    act = bolaget(companyId);
    token = await agentToken(companyId);
    agent = (name, body) => api.post(`/api/companies/${companyId}/actions/${name}`)
      .set({ Authorization: `Bearer ${token}` }).send(body) as unknown as Promise<Svar>;
    ua = await inloggad(user);
    // Skapade av en människa utan sfär: ingen människa har bestämt sfären, så
    // regeln «människan vinner» står inte i vägen för agenten. Det gör kön.
    id.org = ok(await act('upsert_crm_organization', { name: 'R Kö Elbolaget AB' })).id;
    id.oppet1 = ok(await act('record_crm_commitment', atagande({ organization_id: id.org, body: 'R Öppet ett' }))).id;
    id.oppet2 = ok(await act('record_crm_commitment', atagande({ organization_id: id.org, body: 'R Öppet två' }))).id;
    id.klart = ok(await act('record_crm_commitment', atagande({ organization_id: id.org, body: 'R Klart' }))).id;
    ok(await act('set_crm_commitment_status', { commitment_id: id.klart, status: 'done' }));
    id.grannen = ok(await act('upsert_crm_organization', { name: 'R Grannen AB' })).id;
    id.person = ok(await act('upsert_crm_person', { name: 'R Personen', organization_id: id.grannen })).id;
    id.atagande = ok(await act('record_crm_commitment', atagande({ organization_id: id.grannen, body: 'R Grannens löfte' }))).id;
    // Agenten får skapa en NY post som privat, som förut.
    const ny = ok(await agent('upsert_crm_organization', { name: 'R Agentens privata', sfar: 'privat' }));
    expect(ny).toMatchObject({ created: true, sfar: 'privat' });
    id.privatOrg = ny.id;
    id.privatPerson = ok(await agent('upsert_crm_person', { name: 'R Agentens privata person', sfar: 'privat' })).id;
    const kund = ok(await act('create_customer', { name: 'R Kunden AB' })).id;
    id.kundOrg = ok(await act('upsert_crm_organization', { name: 'R Kunden AB', customer_id: kund })).id;
  });

  it('R1 agenten: set_crm_sfar på en befintlig organisation, person eller ett åtagande blir ett väntande förslag, åt båda hållen, och posten är orörd', async () => {
    const fore = await ogonblick();
    const koFore = (await kon()).length;
    const anrop: Record<string, unknown>[] = [
      { organization_id: id.org, sfar: 'privat', roll: 'leverantor', cascade_open_commitments: true },
      { person_id: id.person, sfar: 'privat' },
      { commitment_id: id.atagande, sfar: 'privat' },
      { organization_id: id.privatOrg, sfar: 'foretag' },
      { person_id: id.privatPerson, sfar: 'foretag' },
    ];
    for (const body of anrop) {
      const r = await agent('set_crm_sfar', body);
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      expect(r.body).toMatchObject({ status: 'pending_approval', action: 'set_crm_sfar', approval: { action: 'set_crm_sfar', status: 'pending' } });
    }
    expect(await ogonblick(), 'ingen post ändrad, ingen rad i crm-loggen').toEqual(fore);
    const koade = (await kon()).slice(koFore);
    expect(koade.map((k) => k.input)).toEqual(anrop);
    for (const k of koade) {
      expect(k).toMatchObject({ action: 'set_crm_sfar', status: 'pending', requested_actor: 'agent' });
      // Kön bär id:n och låsta värden, aldrig namn eller text (svepet S1 räknar med det).
      expect(Object.keys(k.input).filter((f) => !['organization_id', 'person_id', 'commitment_id', 'sfar', 'roll', 'cascade_open_commitments'].includes(f)))
        .toEqual([]);
    }
    const begarda = (await logg('action.approval_requested')).filter((r) => koade.some((k) => k.id === r.entity_id));
    expect(begarda.map((r) => r.details)).toEqual(anrop.map(() => ({ action: 'set_crm_sfar', actor: 'agent' })));
  });

  it('R2 som förut: ett anrop som inte ändrar något körs direkt, en vägran är en vägran, och en människas beslut står — inget av det köas', async () => {
    const koFore = (await kon()).length;
    expect(ok(await agent('set_crm_sfar', { organization_id: id.org, sfar: 'foretag' }))).toMatchObject({ andrad: false, foljde_med: [] });
    grans(await agent('set_crm_sfar', { organization_id: id.kundOrg, sfar: 'privat' }), 'privat_organisation_kundkoppling');
    const bestamd = ok(await act('upsert_crm_organization', { name: 'R2 Bestämd', sfar: 'privat' })).id;
    const r = await agent('set_crm_sfar', { organization_id: bestamd, sfar: 'foretag' });
    expect([r.status, r.body.error]).toEqual([409, 'manniskans_beslut']);
    // Samma regel för rollen, som set_crm_sfar tar sedan 3b.
    const rollBestamd = ok(await act('upsert_crm_organization', { name: 'R2 Rollen bestämd', roll: 'partner' })).id;
    const rr = await agent('set_crm_sfar', { organization_id: rollBestamd, sfar: 'foretag', roll: 'leverantor' });
    expect([rr.status, rr.body.error]).toEqual([409, 'manniskans_beslut']);
    expect((await withAdmin((admin) => admin.query('SELECT roll FROM crm.organizations WHERE id = $1', [rollBestamd]))).rows[0].roll)
      .toBe('partner');
    // Rollen gäller bara en organisation.
    expect((await agent('set_crm_sfar', { person_id: id.person, sfar: 'foretag', roll: 'leverantor' })).status).toBe(400);
    expect((await kon()).length).toBe(koFore);
  });

  it('R3 en människa verkställer direkt: åtgärden och «Rätta uppgifter» i ytan, utan någon köpost', async () => {
    const koFore = (await kon()).length;
    const egen = ok(await act('upsert_crm_organization', { name: 'R3 Människans' })).id;
    expect(ok(await act('set_crm_sfar', { organization_id: egen, sfar: 'privat' }))).toMatchObject({ sfar: 'privat', andrad: true });
    const back = `/app/c/${companyId}/relations/${egen}`;
    const res = await ua.post(`${back}/sfar`).type('form').send({ back, mal: 'organisation', sfar: 'foretag' });
    expect([res.status, res.headers.location]).toEqual([302, back]);
    expect(await sfarPa('organizations', [egen])).toEqual({ [egen]: 'foretag' });
    expect((await crmLogg(companyId, 'crm.sfar_set')).filter((x) => x.entity_id === egen).map((x) => x.details.source))
      .toEqual(['human', 'human']);
    expect((await kon()).length).toBe(koFore);
  });

  it('R4 Att göra: kortet säger vad som ändras, godkänt verkställs med auditlogg, avvisat gör ingenting, och agenten godkänner aldrig', async () => {
    const vantar = (await kon()).filter((k) => k.status === 'pending' && k.action === 'set_crm_sfar');
    const forOrg = vantar.find((k) => k.input.organization_id === id.org)!;
    const forPerson = vantar.find((k) => k.input.person_id === id.person)!;
    const forAtagande = vantar.find((k) => k.input.commitment_id === id.atagande)!;
    const sjalv = await api.post(`/api/companies/${companyId}/approvals/${forOrg.id}/approve`)
      .set({ Authorization: `Bearer ${token}` }).send({});
    expect(sjalv.status).toBe(403);

    const sida = await ua.get(`/app/c/${companyId}/approvals`);
    expect(sida.status).toBe(200);
    const kort = sida.text.split('<article class="ai-card">').find((k) => k.includes(`/approvals/${forOrg.id}/approve`)) ?? '';
    expect(kort).toContain('Byt sfär (privat/företag)');
    expect(kort).toContain('<span class="andring__f">R Kö Elbolaget AB: Företag, roll —</span>');
    expect(kort).toContain('<span class="andring__t">R Kö Elbolaget AB: Privat, roll Leverantör</span>');
    expect(kort).toContain('De 2 öppna åtagandena följer med; klara och avskrivna rörs inte.');
    expect(kort).toContain(`href="/app/c/${companyId}/relations/${id.org}"`);

    // Godkänt i ytan: verkställt som en människas beslut, med auditrad i samma transaktion.
    const g = await ua.post(`/app/c/${companyId}/approvals/${forOrg.id}/approve`).type('form').send({});
    expect(g.status).toBe(302);
    expect(await sfarPa('organizations', [id.org])).toEqual({ [id.org]: 'privat' });
    expect(await sfarPa('commitments', [id.oppet1, id.oppet2, id.klart])).toEqual({
      [id.oppet1]: 'privat', [id.oppet2]: 'privat', [id.klart]: 'foretag',
    });
    const rad = (await withAdmin((admin) => admin.query('SELECT roll FROM crm.organizations WHERE id = $1', [id.org]))).rows[0];
    expect(rad.roll).toBe('leverantor');
    const sfarSet = (await crmLogg(companyId, 'crm.sfar_set')).filter((x) => x.entity_id === id.org).map((x) => x.details);
    expect(sfarSet.map((d) => ({ ...d, foljde_med: [...d.foljde_med].sort() }))).toEqual([{
      fran: 'foretag', till: 'privat', cascade: true, foljde_med: [id.oppet1, id.oppet2].sort(), source: 'human',
      roll: { fran: null, till: 'leverantor' },
    }]);
    const ursprung = (await withAdmin((admin) => admin.query(
      "SELECT field, source FROM crm.field_provenance WHERE organization_id = $1 AND field IN ('sfar', 'roll') ORDER BY field", [id.org]))).rows;
    expect(ursprung).toEqual([{ field: 'roll', source: 'human' }, { field: 'sfar', source: 'human' }]);
    expect((await logg('action.approved_executed')).filter((x) => x.entity_id === forOrg.id).map((x) => x.details.action))
      .toEqual(['set_crm_sfar']);
    expect((await kon()).find((k) => k.id === forOrg.id)?.status).toBe('executed');

    // Godkänt via API:t med en människas token: samma sak för personen.
    const viaApi = await api.post(`/api/companies/${companyId}/approvals/${forPerson.id}/approve`).set(auth()).send({});
    expect(viaApi.status, JSON.stringify(viaApi.body)).toBe(200);
    expect(await sfarPa('people', [id.person])).toEqual({ [id.person]: 'privat' });
    expect((await crmLogg(companyId, 'crm.sfar_set')).filter((x) => x.entity_id === id.person).map((x) => x.details))
      .toEqual([{ fran: 'foretag', till: 'privat', source: 'human' }]);

    // Avvisat: ingenting ändras.
    const fore = await ogonblick();
    const n = await ua.post(`/app/c/${companyId}/approvals/${forAtagande.id}/reject`).type('form').send({});
    expect(n.status).toBe(302);
    expect(await ogonblick()).toEqual(fore);
    expect((await kon()).find((k) => k.id === forAtagande.id)?.status).toBe('rejected');
    expect(await sfarPa('commitments', [id.atagande])).toEqual({ [id.atagande]: 'foretag' });
  });

  it('R5 omvägarna stängda: upsert och en omsänd händelse byter inte sfär eller roll på en befintlig post från en agent — vägran med hänvisning till set_crm_sfar', async () => {
    const kalla = atagande({ organization_id: id.grannen, body: 'R5 Från källan', source_system: 'gmail', source_ref: 'gmail:r5' });
    expect(ok(await agent('record_crm_commitment', kalla))).toMatchObject({ created: true, sfar: 'foretag' });
    // En person utan människobeslut om sfären (R Personen bär ett sedan R4).
    ok(await act('upsert_crm_person', { name: 'R5 Företagspersonen', organization_id: id.grannen }));
    const fore = await ogonblick();
    const koFore = (await kon()).length;
    const vagran = async (name: string, body: Rad) => {
      const r = await agent(name, body);
      expect(r.status, `${name} ${JSON.stringify(r.body)}`).toBe(409);
      expect(r.body).toMatchObject({ error: 'byt_med_set_crm_sfar', details: { atgard: 'set_crm_sfar' } });
    };
    await vagran('upsert_crm_organization', { name: 'R Grannen AB', sfar: 'privat' });
    await vagran('upsert_crm_organization', { organization_id: id.grannen, name: 'R Grannen AB', roll: 'leverantor' });
    await vagran('upsert_crm_organization', { name: 'R Agentens privata', sfar: 'foretag' });
    await vagran('upsert_crm_person', { name: 'R5 Företagspersonen', organization_id: id.grannen, sfar: 'privat' });
    await vagran('upsert_crm_person', { name: 'R Agentens privata person', sfar: 'foretag' });
    await vagran('record_crm_commitment', { ...kalla, sfar: 'privat' });
    expect(await ogonblick(), 'ingenting ändrat').toEqual(fore);
    expect((await kon()).length, 'en vägran köar ingenting').toBe(koFore);

    // Som förut: samma sfär med andra fält, nya poster som privata, och samma händelse igen utan sfär.
    expect(ok(await agent('upsert_crm_organization', { name: 'R Grannen AB', sfar: 'foretag', notes: 'Grannar' })))
      .toMatchObject({ created: false, sfar: 'foretag', notes: 'Grannar' });
    expect(ok(await agent('upsert_crm_organization', { name: 'R5 Ny privat', sfar: 'privat', roll: 'leverantor' })))
      .toMatchObject({ created: true, sfar: 'privat', roll: 'leverantor' });
    expect(ok(await agent('upsert_crm_person', { name: 'R5 Ny privat person', sfar: 'privat' }))).toMatchObject({ created: true, sfar: 'privat' });
    expect(ok(await agent('record_crm_commitment', { ...kalla, body: 'R5 Från källan, rättad' }))).toMatchObject({ created: false, sfar: 'foretag' });
    expect(ok(await agent('record_crm_commitment', atagande({ organization_id: id.privatOrg, body: 'R5 Nytt privat', sfar: 'privat' }))))
      .toMatchObject({ created: true, sfar: 'privat' });
    // En människa byter som förut, också med upsert.
    expect(ok(await act('upsert_crm_organization', { name: 'R5 Ny privat', roll: 'partner' }))).toMatchObject({ roll: 'partner' });
    expect(ok(await act('upsert_crm_person', { name: 'R5 Ny privat person', sfar: 'foretag' }))).toMatchObject({ sfar: 'foretag' });
  });
});

describe('R kaskaden och ångra rör aldrig ett åtagande som inte är öppet', () => {
  let companyId: string;
  let act: ReturnType<typeof bolaget>;
  let ua: ReturnType<typeof supertest.agent>;
  const raderna = async (ids: string[]) => Object.fromEntries((await withAdmin((admin) => admin.query<{ id: string; sfar: string; status: string }>(
    'SELECT id, sfar, status FROM crm.commitments WHERE id = ANY($1::uuid[])', [ids]))).rows.map((r) => [r.id, { sfar: r.sfar, status: r.status }]));
  /** Håller en stängning av åtagandet öppen i en egen anslutning tills provet committar den. */
  async function stangUnderTiden<T>(atagandeId: string, kor: () => { pid: Promise<number>; utfall: Promise<T> }) {
    const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await t1.connect();
    try {
      await t1.query('BEGIN');
      await t1.query("UPDATE crm.commitments SET status = 'done', completed_at = now() WHERE id = $1", [atagandeId]);
      const k = kor();
      const vantade = await vantarPaLas(await k.pid);
      await t1.query('COMMIT');
      return { vantade, svar: await k.utfall };
    } finally {
      await t1.end();
    }
  }

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Kapplöpningen AB');
    act = bolaget(companyId);
    ua = await inloggad(user);
  });

  it('R6 kaskaden: ett åtagande som stängs mellan urvalet och skrivningen behåller sin sfär', async () => {
    const org = ok(await act('upsert_crm_organization', { name: 'R6 Organisationen' })).id;
    const stangs = ok(await act('record_crm_commitment', atagande({ organization_id: org, body: 'R6 stängs under tiden' }))).id;
    const oppet = ok(await act('record_crm_commitment', atagande({ organization_id: org, body: 'R6 förblir öppet' }))).id;
    const { vantade, svar } = await stangUnderTiden(stangs, () => iTransaktion(companyId, (client) =>
      setCrmSfar(client, companyId, user.userId, 'human', { organization_id: org, sfar: 'privat', cascade_open_commitments: true })));
    expect({ vantade, foljde_med: svar.foljde_med }).toEqual({ vantade: true, foljde_med: [oppet] });
    expect(await raderna([stangs, oppet])).toEqual({
      [stangs]: { sfar: 'foretag', status: 'done' }, [oppet]: { sfar: 'privat', status: 'open' },
    });
    expect((await crmLogg(companyId, 'crm.sfar_set')).find((x) => x.entity_id === org)?.details.foljde_med).toEqual([oppet]);
  });

  it('R7 ångra: ett åtagande som följde med och stängs mellan urvalet och skrivningen behåller sin sfär', async () => {
    const stuga = ok(await act('upsert_crm_organization', { name: 'R7 Stugföreningen', notes: 'Privat förening för stugan.' })).id;
    const stangs = ok(await act('record_crm_commitment', atagande({ organization_id: stuga, body: 'R7 stängs under tiden' }))).id;
    const oppet = ok(await act('record_crm_commitment', atagande({ organization_id: stuga, body: 'R7 förblir öppet' }))).id;
    const flytt = await ua.post(`/app/c/${companyId}/relations/privata-forslag/flytta`).type('form')
      .send(formular([['val', `organisation:${stuga}`]]));
    expect(flytt.status).toBe(303);
    const flyttId = /\/kvitto\/([0-9a-f-]{36})$/.exec(String(flytt.headers.location))![1]!;
    expect(await raderna([stangs, oppet])).toEqual({ [stangs]: { sfar: 'privat', status: 'open' }, [oppet]: { sfar: 'privat', status: 'open' } });

    const { vantade } = await stangUnderTiden(stangs, () => iTransaktion(companyId, (client) =>
      angraPrivatFlytt(client, companyId, user.userId, flyttId, `organisation:${stuga}`)));
    expect(vantade).toBe(true);
    expect(await raderna([stangs, oppet])).toEqual({
      [stangs]: { sfar: 'privat', status: 'done' }, [oppet]: { sfar: 'foretag', status: 'open' },
    });
    const org = (await withAdmin((admin) => admin.query('SELECT sfar FROM crm.organizations WHERE id = $1', [stuga]))).rows[0];
    expect(org.sfar).toBe('foretag');
    expect((await crmLogg(companyId, 'crm.privat_flytt_angrad')).find((x) => x.entity_id === stuga)?.details.foljde_med).toEqual([oppet]);
  });

  it('R8 ångra vägrar för ett åtagande som stängts efter flytten — orört, och adressen bär bara koden', async () => {
    const intern = ok(await act('upsert_crm_organization', { name: 'Kapplöpningen AB (intern)' })).id;
    const tand = ok(await act('record_crm_commitment', atagande({ organization_id: intern, body: 'Boka tandläkare R8' }))).id;
    const flytt = await ua.post(`/app/c/${companyId}/relations/privata-forslag/flytta`).type('form')
      .send(formular([['val', `atagande:${tand}`]]));
    expect(flytt.status).toBe(303);
    const kvitto = String(flytt.headers.location);
    const flyttId = /\/kvitto\/([0-9a-f-]{36})$/.exec(kvitto)![1]!;
    ok(await act('set_crm_commitment_status', { commitment_id: tand, status: 'done' }));
    const fore = (await withAdmin((admin) => admin.query(
      'SELECT sfar, status, organization_id FROM crm.commitments WHERE id = $1', [tand]))).rows[0];
    expect([fore.sfar, fore.status]).toEqual(['privat', 'done']);

    const a = await ua.post(`/app/c/${companyId}/relations/privata-forslag/angra`).type('form')
      .send({ flytt_id: flyttId, nyckel: `atagande:${tand}` });
    expect(a.status).toBe(303);
    expect(a.headers.location).toBe(`${kvitto}?fel=atagandet_ar_stangt&rad=atagande:${tand}`);
    expect((await ua.get(String(a.headers.location))).text)
      .toContain('<p class="notice">Åtagandet har stängts efter flytten och ångras därför inte — klara och avskrivna åtaganden byter inte sfär.</p>');
    expect((await withAdmin((admin) => admin.query(
      'SELECT sfar, status, organization_id FROM crm.commitments WHERE id = $1', [tand]))).rows[0]).toEqual(fore);
    expect((await crmLogg(companyId, 'crm.privat_flytt_angrad')).filter((x) => x.entity_id === tand)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S: svepet, sist i filen: varje privat id som filen skapat, i varje tabell i public
// ---------------------------------------------------------------------------

describe('S svepet över varje tabell i public', () => {
  // Rättningsvarv 3b: en agents sfärbyte på en befintlig post väntar i kön (R1),
  // och förslaget bär bara id:n och låsta värden. Kön är därför tillåten för
  // set_crm_sfar också; ingen annan åtgärd, och ingen annan tabell.
  it('S1 ett privat id finns bara i godkännandekön, och där bara i en begärd CRM-sammanslagning eller ett begärt sfärbyte', async () => {
    const utfall = await withAdmin(async (admin) => {
      const privata = await privataId(admin);
      const ids = privata.map((p) => p.id);
      const traffar = await svepaBokforingen(admin, ids);
      const kon = await admin.query<{ action: string }>(
        'SELECT DISTINCT t.action FROM action_approvals t WHERE t::text LIKE ANY($1::text[]) ORDER BY t.action',
        [ids.map((x) => `%${x}%`)]);
      return { privata, traffar, kon: kon.rows.map((r) => r.action) };
    });
    expect([...new Set(utfall.privata.map((p) => p.slag))].sort()).toEqual(['atagande', 'organisation', 'person']);
    expect(utfall.traffar.filter((t) => t !== 'action_approvals')).toEqual([]);
    for (const a of utfall.kon) expect(['merge_crm_organizations', 'merge_crm_people', 'set_crm_sfar']).toContain(a);
    // Svepet ser kön: R1:s väntande förslag på den privata organisationen finns där.
    expect(utfall.kon).toContain('set_crm_sfar');
  });
});
