// Uppdragsytan S6.1, våg 4: `binda_kostnad` — kostnaden bunden till avtalsdelen
// (PRD FR-33).
//
// Åtgärden är `sensitive`, och den meningen är hela provets mitt: det som ska
// bevisas är negativt — att INGENTING står skrivet mellan begäran och
// godkännandet. Ett prov som bara godkänner och sedan tittar bevisar att
// skrivningen fungerar, inte att tiden dessförinnan var tom.
//
// Fem saker prövas här (svepets två grenar ligger i
// `uppdragsytan-svep-bindning.test.ts`):
//
//   (a) registret: `sensitive`, strikt schema, `contract_part_id` obligatoriskt
//       — ett kvitto har inget `project_id`, delen är enda bindningen;
//   (b) sensitive-flödet: köpost + audit, kvittot orört, och först godkännandet
//       sätter delen och skriver `receipt.contract_part_assigned`;
//   (c) flytten: en redan bunden kostnad går att flytta — det är just vad kön
//       är till för (en automatbunden ström → rätt leverabel);
//   (d) `oplanerad` rörs aldrig: märkningen säger att kostnaden inte fanns i
//       baselinen, och det blir inte osant för att någon flyttar den;
//   (e) okänt kvitto, okänd del och grannbolagets rader svarar "finns inte".
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const OKANT_ID = '00000000-0000-4000-8000-000000000000';

let user: TestUser;
let companyId = '';
let agentToken = '';
let granne: TestUser;
let grannbolag = '';

let delRot = '';
let delS2 = '';
let delL3 = '';
let kvitto = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Begär en känslig åtgärd — svaret är 202 och en köpost, aldrig en skrivning. */
async function begar(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<string> {
  const res = await act(namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  expect(res.body.status).toBe('pending_approval');
  return (res.body.approval as { id: string }).id;
}

async function godkann(id: string): Promise<Svar> {
  const res = await api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
  return res as unknown as Svar;
}

async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const svar = await godkann(await begar(namn, kropp));
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
  return svar.body.result as Record<string, unknown>;
}

interface Kopost { id: string; action: string; status: string; input: Record<string, unknown> }

async function kon(status?: string): Promise<Kopost[]> {
  const res = await api.get(`${co()}/approvals${status ? `?status=${status}` : ''}`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approvals as Kopost[];
}

interface Kvittorad { contract_part_id: string | null; oplanerad: boolean }

async function kvittoraden(id = kvitto): Promise<Kvittorad> {
  return withAdmin(async (c) => (await c.query<Kvittorad>(
    'SELECT contract_part_id, oplanerad FROM receipts WHERE id = $1', [id],
  )).rows[0]!);
}

interface Auditrad { entity_id: string | null; details: Record<string, unknown> }

/** Bindningens auditrader, direkt ur loggen — `details` bär från/till. */
async function bindningsaudit(id = kvitto): Promise<Auditrad[]> {
  return withAdmin(async (c) => (await c.query<Auditrad>(
    `SELECT entity_id, details FROM audit_log
      WHERE company_id = $1 AND action = 'receipt.contract_part_assigned' AND entity_id = $2
      ORDER BY occurred_at, id`,
    [companyId, id],
  )).rows);
}

async function nyttKvitto(datum: string, text: string): Promise<string> {
  const rad = await ok('create_receipt', {
    receipt_date: datum, description: text, net_ore: 400000, vat_rate: 25, expense_account: 5460,
  });
  await okKoad('book_receipt', { receipt_id: rad.id as string });
  return rad.id as string;
}

beforeAll(async () => {
  user = await registerUser('bindning');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Hermes' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  const projekt = (await ok('create_project', { name: 'NVR-001' })).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: 'Leveranskontrakt NVR-001', signed_date: '2026-09-03',
  })).contract_id as string;
  await ok('importera_leveranskontrakt', { contract_id: avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  const avtalet = await ok('get_contract_usage', { contract_id: avtal });
  const delar = avtalet.parts as unknown as Array<{ part_id: string; code: string }>;
  const del = (code: string): string => {
    const rad = delar.find((d) => d.code === code);
    expect(rad, `avtalsdelen ${code} saknas`).toBeDefined();
    return rad!.part_id;
  };
  delRot = del('UPPDRAG');
  delS2 = del('S2');
  delL3 = del('L3');

  kvitto = await nyttKvitto('2026-11-20', 'Integrationshårdvara');

  granne = await registerUser('bindning-granne');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// (a) Registret
// ---------------------------------------------------------------------------

describe('registret: binda_kostnad är känslig och kräver sin avtalsdel', () => {
  it('åtgärden är `sensitive` — inget skrivs utan att en människa godkänt', () => {
    const def = ACTIONS.find((a) => a.name === 'binda_kostnad');
    expect(def, 'åtgärden saknas i registret').toBeDefined();
    expect(def!.sensitivity).toBe('sensitive');
    // Ingen `kravManniska`: svepet (en agentväg) SKA få köa bindningen — kön är
    // spärren, precis som för `andra_baseline`.
    expect(def!.kravManniska).toBeUndefined();
  });

  it('`contract_part_id` är obligatoriskt: en kostnad binds aldrig "till uppdraget"', async () => {
    const res = await act('binda_kostnad', { receipt_id: kvitto });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    // Och ingen köpost föddes av det avvisade anropet.
    expect(await kon('pending')).toHaveLength(0);
  });

  it('schemat är strikt: ett okänt fält ger 400', async () => {
    const res = await act('binda_kostnad', {
      receipt_id: kvitto, contract_part_id: delS2, oplanerad: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

// ---------------------------------------------------------------------------
// (b) Sensitive-flödet: mellan begäran och godkännandet står ingenting skrivet
// ---------------------------------------------------------------------------

describe('sensitive-flödet: köposten skriver inte, godkännandet gör det', () => {
  let koId = '';

  it('begäran ger 202, en köpost — och kvittot står orört', async () => {
    koId = await begar('binda_kostnad', { receipt_id: kvitto, contract_part_id: delS2 });

    const pending = await kon('pending');
    expect(pending.map((p) => p.action)).toEqual(['binda_kostnad']);
    expect(pending[0]!.input).toEqual({ receipt_id: kvitto, contract_part_id: delS2 });

    // Det negativa: ingen bindning, ingen auditrad om en bindning.
    expect(await kvittoraden()).toEqual({ contract_part_id: null, oplanerad: false });
    expect(await bindningsaudit()).toEqual([]);
  });

  it('godkännandet sätter delen och auditloggar från → till i samma transaktion', async () => {
    const svar = await godkann(koId);
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    expect(svar.body.result).toMatchObject({
      id: kvitto, contract_part_id: delS2, contract_part_code: 'S2', status: 'booked',
    });

    expect(await kvittoraden()).toEqual({ contract_part_id: delS2, oplanerad: false });
    const audit = await bindningsaudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({
      fran_contract_part_id: null, till_contract_part_id: delS2, code: 'S2', status: 'booked',
    });
    // Godkännandets rad bär ingen `bindning: automatisk` — den märkningen är
    // svepets, och skillnaden ska gå att läsa i loggen.
    expect(audit[0]!.details.bindning).toBeUndefined();
  });

  it('agenten får köa men aldrig godkänna sin egen bindning', async () => {
    const id = await begar('binda_kostnad', { receipt_id: kvitto, contract_part_id: delRot }, agent());
    const somAgent = await api.post(`${co()}/approvals/${id}/approve`)
      .set(agent()).send({});
    expect(somAgent.status, JSON.stringify(somAgent.body)).toBe(403);
    // Kvittot står kvar där det stod: agentens begäran skrev ingenting.
    expect((await kvittoraden()).contract_part_id).toBe(delS2);

    const avvisad = await api.post(`${co()}/approvals/${id}/reject`).set(auth()).send({});
    expect(avvisad.status, JSON.stringify(avvisad.body)).toBe(200);
    expect((await kvittoraden()).contract_part_id).toBe(delS2);
  });
});

// ---------------------------------------------------------------------------
// (c) + (d) Flytten, och det märkningen betyder
// ---------------------------------------------------------------------------

describe('flytten: kön är vägen från ström till leverabel', () => {
  it('en bunden kostnad flyttas till lövet — från/till står i auditraden', async () => {
    const svar = await okKoad('binda_kostnad', { receipt_id: kvitto, contract_part_id: delL3 });
    expect(svar).toMatchObject({ contract_part_id: delL3, contract_part_code: 'L3' });

    const audit = await bindningsaudit();
    expect(audit).toHaveLength(2);
    expect(audit[1]!.details).toMatchObject({
      fran_contract_part_id: delS2, till_contract_part_id: delL3, code: 'L3',
    });
  });

  it('`oplanerad` rörs aldrig av en bindning — den säger något om baselinen', async () => {
    // Märkningen sätts av svepets automatbindning (S6.1 gren 2) och beskriver
    // att kostnaden inte fanns i det avtalade. En människas flytt gör inte det
    // påståendet osant, och åtgärden har därför inget fält för den.
    await withAdmin((c) => c.query('UPDATE receipts SET oplanerad = true WHERE id = $1', [kvitto]));
    await okKoad('binda_kostnad', { receipt_id: kvitto, contract_part_id: delRot });
    expect(await kvittoraden()).toEqual({ contract_part_id: delRot, oplanerad: true });
  });
});

// ---------------------------------------------------------------------------
// (e) Det som inte finns svarar "finns inte"
// ---------------------------------------------------------------------------

describe('okända rader och grannbolaget', () => {
  it('okänt kvitto fälls vid godkännandet — och köposten står kvar obesvarad', async () => {
    const id = await begar('binda_kostnad', { receipt_id: OKANT_ID, contract_part_id: delS2 });
    const svar = await godkann(id);
    expect(svar.status, JSON.stringify(svar.body)).toBe(404);
    expect(svar.body.error).toBe('not_found');
    // Allt-eller-inget: godkännandet rullades tillbaka och posten är omkörbar.
    expect((await kon('pending')).map((p) => p.id)).toContain(id);
    await api.post(`${co()}/approvals/${id}/reject`).set(auth()).send({});
  });

  it('okänd avtalsdel fälls likaså — och kvittot står orört', async () => {
    const fore = await kvittoraden();
    const id = await begar('binda_kostnad', { receipt_id: kvitto, contract_part_id: OKANT_ID });
    const svar = await godkann(id);
    expect(svar.status, JSON.stringify(svar.body)).toBe(404);
    expect(await kvittoraden()).toEqual(fore);
    await api.post(`${co()}/approvals/${id}/reject`).set(auth()).send({});
  });

  it('grannbolagets avtalsdel finns inte för oss — och tvärtom', async () => {
    const grannauth = { Authorization: `Bearer ${granne.token}` };
    const res = await api.post(`${co(grannbolag)}/actions/binda_kostnad`)
      .set(grannauth).send({ receipt_id: kvitto, contract_part_id: delRot });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const id = (res.body.approval as { id: string }).id;
    const svar = await api.post(`${co(grannbolag)}/approvals/${id}/approve`).set(grannauth).send({});
    expect(svar.status, JSON.stringify(svar.body)).toBe(404);
    // Vårt kvitto ligger kvar på sin del: RLS döljer det, och uppslaget svarar
    // "finns inte" i stället för att låta främmande nyckel avgöra saken.
    expect((await kvittoraden()).contract_part_id).toBe(delRot);
  });
});
