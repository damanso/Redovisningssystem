// PRD_TIDSRAPPORTERING §4 F4–F5, §7 acceptans 5–6 och 8 (story 7):
// batchintaget, förslagskön och batchgodkännandet.
//
// Story 1–5 gav tidposten en livscykel, fakturan atomicitet, avtalet ett tak,
// rapporterna en yta och vyn en skrivväg. Kvar stod mottagarsidan för det som
// kommer UTIFRÅN: kalendern och mailen. Två fel finns inbyggda i den formen och
// proven nedan är båda felen baklänges.
//
//   1. **Ett intag som körs om lägger en dubblett.** Kalendern läses varje
//      natt. En dubblerad kontaktpunkt är brus; en dubblerad tidpost är pengar
//      på nästa faktura. Provet är att samma batch två gånger ska ge idel
//      `duplicates` och noll nya rader.
//   2. **Ett intag som avvisar det det inte känner igen tappar arbete.** En
//      hint som inte träffar landar i `Osorterat` — och den posten kan inte bli
//      fakturerbar tid förrän en människa sagt vems arbetet var (409
//      `unsorted_project`). Posten finns, men den kan inte bli pengar.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import type { UnbilledTimeReport } from '../src/services/timeReports.js';

const PASSWORD = 'mycket-hemligt-losen-123';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const IDAG = iso(new Date());
const AR = Number(IDAG.slice(0, 4));
const dagarSedan = (n: number): string => iso(new Date(Date.parse(IDAG) - n * 86_400_000));

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let agentToken: string;

let nvrKund: string;
/** NVR har TVÅ aktiva uppdrag — en ledtråd på kundnamnet blir därför tvetydig. */
let nvrPilot: string;
let nvrFas2: string;
let nvrFas2Del: string;
/** ILT har exakt ETT aktivt uppdrag — ledtråden är entydig. */
let iltKund: string;
let iltProjekt: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string; approval?: { id: string } } };

async function act(namn: string, kropp: Record<string, unknown> = {}, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown> = {}, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

/** Känslig action: begär (202) och godkänn — samma väg som vyns knappar. */
async function godkannAction(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const begaran = await act(namn, kropp);
  expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
  const svar = await api.post(`${co()}/approvals/${begaran.body.approval!.id}/approve`).set(auth()).send({});
  expect(svar.status, JSON.stringify(svar.body)).toBe(200);
  return svar.body.result as Record<string, unknown>;
}

interface Tidrad extends Record<string, unknown> {
  id: string; project_id: string; project_name: string; work_date: string;
  minutes: number; billable_minutes: number; status: string;
  source: string | null; source_ref: string | null; reasoning: string | null;
  uncertainty: string | null; overlaps_manual: boolean; contract_part_id: string | null;
  adjustment_reason: string | null;
}

async function poster(filter: Record<string, unknown> = {}): Promise<Tidrad[]> {
  return (await ok('list_time_entries', filter)) as unknown as Tidrad[];
}

async function post(id: string): Promise<Tidrad> {
  const alla = await poster({});
  const rad = alla.find((r) => r.id === id);
  expect(rad, `tidposten ${id} hittades inte`).toBeDefined();
  return rad!;
}

/** Ett förslag, med rimliga standardvärden. */
function forslag(over: Record<string, unknown>): Record<string, unknown> {
  return {
    work_date: IDAG, minutes: 60, description: 'Arbete', source: 'kalender', ...over,
  };
}

async function foresla(events: Record<string, unknown>[], headers = auth()): Promise<Record<string, unknown>> {
  return ok('propose_time_entries', { events }, headers);
}

/** Skapar ETT förslag och ger tillbaka dess id. */
async function ettForslag(over: Record<string, unknown>): Promise<string> {
  const fore = (await poster({ status: 'forslag' })).map((r) => r.id);
  await foresla([forslag(over)]);
  const efter = await poster({ status: 'forslag' });
  const ny = efter.find((r) => !fore.includes(r.id));
  expect(ny, 'inget förslag skapades').toBeDefined();
  return ny!.id;
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

async function postaFormular(
  path: string, kropp: Record<string, string>,
): Promise<{ ok: string | null; fel: string | null; location: string }> {
  const res = await ua.post(path).type('form').send(kropp);
  expect([302, 303], `oväntad status ${res.status} för ${path}`).toContain(res.status);
  const location = res.headers.location as string;
  const q = new URL(location, 'http://localhost').searchParams;
  return { ok: q.get('ok'), fel: q.get('fel'), location };
}

beforeAll(async () => {
  user = await registerUser('tidsforslag');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), {
    label: String(AR), start_date: `${AR}-01-01`, end_date: `${AR}-12-31`,
  });

  const t = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Hermes' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  agentToken = t.body.token;

  const nvr = await api.post(`${co()}/customers`).set(auth())
    .send({ name: 'Nordic Vision Retail AB', email: 'eva@nvr.example' });
  expect(nvr.status, JSON.stringify(nvr.body)).toBe(201);
  nvrKund = nvr.body.customer.id;

  const ilt = await api.post(`${co()}/customers`).set(auth())
    .send({ name: 'Ilt AB', email: 'anna@ilt.example' });
  expect(ilt.status, JSON.stringify(ilt.body)).toBe(201);
  iltKund = ilt.body.customer.id;

  nvrPilot = (await ok('create_project', {
    name: 'NVR Pilot', customer_id: nvrKund, hourly_rate_ore: 110_000,
  })).id as string;
  nvrFas2 = (await ok('create_project', {
    name: 'NVR Fas 2', customer_id: nvrKund, hourly_rate_ore: 110_000,
  })).id as string;
  iltProjekt = (await ok('create_project', {
    name: 'ILT Löpande', customer_id: iltKund, hourly_rate_ore: 100_000,
  })).id as string;

  const avtal = await ok('create_contract', {
    project_id: nvrFas2, name: 'Plattformsavtal', signed_date: `${AR}-01-02`,
  });
  const del = await ok('upsert_contract_part', {
    contract_id: avtal.id, code: '2A', name: 'Fas 2A', valid_from: `${AR}-01-02`,
  });
  nvrFas2Del = (del as unknown as { parts: { part_id: string; code: string }[] })
    .parts.find((d) => d.code === '2A')!.part_id;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

// ---------------------------------------------------------------------------
// KRAV-2/3: intaget och idempotensen
// ---------------------------------------------------------------------------

describe('propose_time_entries — intaget', () => {
  it('skriver förslag som status forslag, aldrig som godkänd tid', async () => {
    const svar = await foresla([
      forslag({
        project_id: nvrPilot, source_ref: 'calendar:aa1', minutes: 90,
        description: 'Genomgång av testfall', uncertainty: 'lag',
        reasoning: 'Kalenderhändelse 90 min med kundens projektledare.',
      }),
    ], agent());
    expect(svar.created).toBe(1);
    expect(svar.duplicates).toBe(0);
    expect(svar.unresolved).toEqual([]);

    const rad = (await poster({ project_id: nvrPilot })).find((r) => r.source_ref === 'calendar:aa1')!;
    expect(rad.status).toBe('forslag');
    expect(rad.minutes).toBe(90);
    // Debiterbara minuter speglar de registrerade vid skapandet (KRAV-2).
    expect(rad.billable_minutes).toBe(90);
    expect(rad.source).toBe('kalender');
    expect(rad.uncertainty).toBe('lag');
    expect(rad.reasoning).toContain('Kalenderhändelse');

    // Varje skapad post har sin auditrad i samma transaktion (ACCEPTANS).
    const logg = await api.get(`${co()}/audit?limit=200`).set(auth());
    expect(logg.status).toBe(200);
    const rader = logg.body.entries as { action: string; entity_id: string }[];
    expect(rader.some((l) => l.action === 'time_entry.proposed' && l.entity_id === rad.id)).toBe(true);
  });

  it('samma batch två gånger ger idel duplicates och noll nya rader (ACCEPTANS)', async () => {
    const batch = [
      forslag({ project_id: nvrPilot, source_ref: 'calendar:bb1', description: 'Möte 1' }),
      forslag({ project_id: nvrPilot, source_ref: 'calendar:bb2', description: 'Möte 2' }),
    ];
    const forsta = await foresla(batch);
    expect(forsta.created).toBe(2);

    const foreAntal = (await poster({ project_id: nvrPilot })).length;
    const andra = await foresla(batch);
    expect(andra.created).toBe(0);
    expect(andra.duplicates).toBe(2);
    expect((await poster({ project_id: nvrPilot })).length).toBe(foreAntal);
  });

  it('samma source_ref TVÅ gånger i SAMMA batch blir en rad', async () => {
    const svar = await foresla([
      forslag({ project_id: nvrPilot, source_ref: 'calendar:cc1' }),
      forslag({ project_id: nvrPilot, source_ref: 'calendar:cc1', minutes: 30 }),
    ]);
    expect(svar.created).toBe(1);
    expect(svar.duplicates).toBe(1);
    const traffar = (await poster({ project_id: nvrPilot })).filter((r) => r.source_ref === 'calendar:cc1');
    expect(traffar).toHaveLength(1);
    // Aldrig en uppdatering: det första påståendet står kvar (KRAV-3).
    expect(traffar[0]!.minutes).toBe(60);
  });

  it('en trasig händelse stoppar inte batchen — den hamnar i skipped', async () => {
    const svar = await foresla([
      forslag({ project_id: '11111111-2222-3333-4444-555555555555', source_ref: 'calendar:dd0' }),
      forslag({ project_id: nvrPilot, source_ref: 'calendar:dd1', description: 'Räddad rad' }),
    ]);
    expect(svar.created).toBe(1);
    expect((svar.skipped as unknown[])).toHaveLength(1);
    expect((svar.skipped as { index: number }[])[0]!.index).toBe(0);
    expect((await poster({ project_id: nvrPilot })).some((r) => r.source_ref === 'calendar:dd1')).toBe(true);
  });

  it('en entydig ledtråd träffar rätt uppdrag — på kundnamn och på domän', async () => {
    const svar = await foresla([
      forslag({ project_hint: 'Ilt AB', source_ref: 'calendar:ee1' }),
      forslag({ project_hint: 'ilt.example', source_ref: 'calendar:ee2' }),
    ]);
    expect(svar.created).toBe(2);
    expect(svar.unresolved).toEqual([]);
    expect(svar.unsorted).toBe(0);
    const pa = await poster({ project_id: iltProjekt });
    expect(pa.map((r) => r.source_ref)).toEqual(expect.arrayContaining(['calendar:ee1', 'calendar:ee2']));
  });

  it('en TVETYDIG ledtråd gissar aldrig — den landar i Osorterat', async () => {
    // NVR har två aktiva uppdrag. En gissning hade lagt arbetet på fel
    // uppdrag och ingenting i svaret hade sagt det.
    const svar = await foresla([forslag({ project_hint: 'Nordic Vision Retail AB', source_ref: 'calendar:ff1' })]);
    expect(svar.unsorted).toBe(1);
    expect(svar.unresolved).toContain('kund: Nordic Vision Retail AB');
  });
});

// ---------------------------------------------------------------------------
// KRAV-4: Osorterat
// ---------------------------------------------------------------------------

describe('Osorterat', () => {
  it('en hint utan träff sparar posten ändå och redovisar hinten', async () => {
    const svar = await foresla([
      forslag({ project_hint: 'Okänt Bolag AB', source_ref: 'calendar:gg1', part_hint: 'Fas 9' }),
    ]);
    expect(svar.created).toBe(1);
    expect(svar.unsorted).toBe(1);
    expect(svar.unresolved).toContain('kund: Okänt Bolag AB');

    const rad = (await poster({})).find((r) => r.source_ref === 'calendar:gg1')!;
    expect(rad.project_name).toBe('Osorterat');
    expect(rad.contract_part_id).toBeNull();
  });

  it('Osorterat skapas EN gång per bolag, hur många batchar som än kommer', async () => {
    await foresla([forslag({ project_hint: 'Annat Okänt AB', source_ref: 'calendar:gg2' })]);
    await foresla([forslag({ project_hint: 'Tredje Okänt AB', source_ref: 'calendar:gg3' })]);
    const projekt = (await ok('list_projects')) as unknown as { name: string }[];
    expect(projekt.filter((p) => p.name === 'Osorterat')).toHaveLength(1);
  });

  it('ett förslag får sakna avtalsdel även när uppdraget HAR delar (KRAV-4)', async () => {
    const id = await ettForslag({ project_id: nvrFas2, source_ref: 'calendar:hh1' });
    const rad = await post(id);
    expect(rad.status).toBe('forslag');
    expect(rad.contract_part_id).toBeNull();
  });

  it('part_hint som träffar sätter avtalsdelen, part_hint utan träff redovisas', async () => {
    const traff = await foresla([
      forslag({ project_id: nvrFas2, part_hint: '2A', source_ref: 'calendar:hh2' }),
    ]);
    expect(traff.unresolved).toEqual([]);
    const rad = (await poster({ project_id: nvrFas2 })).find((r) => r.source_ref === 'calendar:hh2')!;
    expect(rad.contract_part_id).toBe(nvrFas2Del);

    const miss = await foresla([
      forslag({ project_id: nvrFas2, part_hint: 'Fas 9', source_ref: 'calendar:hh3' }),
    ]);
    expect(miss.unresolved).toContain('avtalsdel: Fas 9');
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: dubblettskyddet mot människans egen rad
// ---------------------------------------------------------------------------

describe('overlaps_manual', () => {
  it('ett förslag samma dag som en manuell post märks — men vägras aldrig', async () => {
    const dag = dagarSedan(3);
    await ok('log_time', {
      project_id: nvrPilot, work_date: dag, minutes: 60, description: 'Skrivet för hand',
    });
    const svar = await foresla([
      forslag({ project_id: nvrPilot, work_date: dag, source_ref: 'calendar:ii1' }),
    ]);
    expect(svar.created).toBe(1);
    expect(svar.overlaps_manual).toBe(1);
    const rad = (await poster({ project_id: nvrPilot })).find((r) => r.source_ref === 'calendar:ii1')!;
    expect(rad.overlaps_manual).toBe(true);
  });

  it('ett förslag en dag UTAN manuell post bär inte märket', async () => {
    const id = await ettForslag({ project_id: nvrPilot, work_date: dagarSedan(4), source_ref: 'calendar:ii2' });
    expect((await post(id)).overlaps_manual).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KRAV-6/7: godkännandet
// ---------------------------------------------------------------------------

describe('approve_time_entries', () => {
  it('godkänner en hel hög i ett anrop och justerar en av dem med orsak', async () => {
    const a = await ettForslag({ project_id: nvrPilot, source_ref: 'calendar:jj1', minutes: 120 });
    const b = await ettForslag({ project_id: nvrPilot, source_ref: 'calendar:jj2', minutes: 60 });

    const svar = await ok('approve_time_entries', {
      ids: [a, b],
      per_id: [{
        id: a, status: 'justerad', billable_minutes: 90,
        adjustment_reason: '30 min var intern administration',
      }],
    });
    expect(svar.processed).toBe(2);
    expect(svar.godkand).toBe(1);
    expect(svar.justerad).toBe(1);

    const radA = await post(a);
    expect(radA.status).toBe('justerad');
    expect(radA.minutes).toBe(120);
    expect(radA.billable_minutes).toBe(90);
    expect(radA.adjustment_reason).toContain('intern administration');
    expect((await post(b)).status).toBe('godkand');
  });

  it("'ignorerad' kräver orsak", async () => {
    const id = await ettForslag({ project_id: nvrPilot, source_ref: 'calendar:jj3' });
    const utan = await act('approve_time_entries', { ids: [id], status: 'ignorerad' });
    expect(utan.status, JSON.stringify(utan.body)).toBe(400);
    expect(utan.body.error).toBe('adjustment_reason_required');
    expect((await post(id)).status).toBe('forslag');

    await ok('approve_time_entries', {
      ids: [id], status: 'ignorerad', adjustment_reason: 'Eget arbete, inte kundens',
    });
    const rad = await post(id);
    expect(rad.status).toBe('ignorerad');
    expect(rad.billable_minutes).toBe(0);
  });

  it('avtalsdel krävs när uppdraget har aktiva delar', async () => {
    const id = await ettForslag({ project_id: nvrFas2, source_ref: 'calendar:jj4' });
    const utan = await act('approve_time_entries', { ids: [id] });
    expect(utan.status, JSON.stringify(utan.body)).toBe(400);
    expect(utan.body.error).toBe('contract_part_required');

    await ok('approve_time_entries', { ids: [id], per_id: [{ id, contract_part_id: nvrFas2Del }] });
    const rad = await post(id);
    expect(rad.status).toBe('godkand');
    expect(rad.contract_part_id).toBe(nvrFas2Del);
  });

  // Rättelse 7b (överlämning #99): kravet på avtalsdel prövas när tiden blir
  // DEBITERBAR, inte när posten rörs. Felet i drift var att kön låste sig på
  // det som aldrig ska bli pengar — ett skräpförslag gick varken att ignorera
  // eller texträtta utan att först klassas mot ett tak det inte förbrukar.
  it('ett förslag utan avtalsdel går ALLTID att ignorera — kön får aldrig låsa sig', async () => {
    const id = await ettForslag({ project_id: nvrFas2, source_ref: 'calendar:jj6', minutes: 0 });
    expect((await post(id)).contract_part_id).toBeNull();

    await ok('approve_time_entries', {
      ids: [id], status: 'ignorerad', adjustment_reason: 'Ren mailmarkering, ingen debiterbar tid',
    });
    const rad = await post(id);
    expect(rad.status).toBe('ignorerad');
    expect(rad.contract_part_id).toBeNull();
  });

  it('beskrivningen på ett oklassat förslag går att rätta utan att posten klassas', async () => {
    const id = await ettForslag({ project_id: nvrFas2, source_ref: 'calendar:jj7' });
    const rattad = await ok('update_time_entry', {
      time_entry_id: id, description: 'Avstämning inför Fas 2 — rättad text',
    });
    expect(rattad.status).toBe('forslag');
    expect(rattad.contract_part_id).toBeNull();
    expect((await post(id)).description).toContain('rättad text');
  });

  it("statusen 'fakturerad' kan aldrig sättas för hand — låset är faktureringens", async () => {
    const id = await ettForslag({ project_id: nvrPilot, source_ref: 'calendar:jj5' });
    const res = await act('approve_time_entries', { ids: [id], status: 'fakturerad' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await post(id)).status).toBe('forslag');
  });
});

describe('minutes 0 — mailmarkeringen', () => {
  it('tas emot av intaget men kan aldrig godkännas', async () => {
    const id = await ettForslag({
      project_id: nvrPilot, source_ref: 'gmail:kk1', minutes: 0, source: 'mail',
      description: 'Svar om leveransdatum', uncertainty: 'hog',
    });
    expect((await post(id)).minutes).toBe(0);

    const res = await act('approve_time_entries', { ids: [id] });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('minutes_required');
    expect((await post(id)).status).toBe('forslag');
  });

  it('men den GÅR att ignorera — annars vore vägen ut ur kön stängd', async () => {
    const id = await ettForslag({
      project_id: nvrPilot, source_ref: 'gmail:kk2', minutes: 0, source: 'mail', description: 'Kort svar',
    });
    await ok('approve_time_entries', {
      ids: [id], status: 'ignorerad', adjustment_reason: 'Ren korrespondens, ingen debiterbar tid',
    });
    expect((await post(id)).status).toBe('ignorerad');
  });

  it('och den går att rädda genom att tiden sätts på postens egen sida', async () => {
    const id = await ettForslag({
      project_id: nvrPilot, source_ref: 'gmail:kk3', minutes: 0, source: 'mail', description: 'Längre svar',
    });
    // Debiterbar tid följer ALDRIG med automatiskt när den registrerade ändras
    // (story 1:s regel) — så båda fälten sätts, precis som tidpostens formulär
    // gör. Utan det svarar tjänsten `adjustment_required`, och det är rätt av
    // den: vad som hände och vad kunden betalar är två olika tal.
    const halvvags = await act('update_time_entry', { time_entry_id: id, duration: '30m' });
    expect(halvvags.status, JSON.stringify(halvvags.body)).toBe(400);
    expect(halvvags.body.error).toBe('adjustment_required');

    await ok('update_time_entry', { time_entry_id: id, duration: '30m', billable_minutes: 30 });
    await ok('approve_time_entries', { ids: [id] });
    const rad = await post(id);
    expect(rad.status).toBe('godkand');
    expect(rad.minutes).toBe(30);
  });
});

describe('Osorterat-spärren (KRAV-7, Davids ja 1/9)', () => {
  it('409 unsorted_project — och flytten i SAMMA anrop godkänner posten', async () => {
    const id = await ettForslag({ project_hint: 'Fjärde Okänt AB', source_ref: 'calendar:ll1' });
    expect((await post(id)).project_name).toBe('Osorterat');

    const nej = await act('approve_time_entries', { ids: [id] });
    expect(nej.status, JSON.stringify(nej.body)).toBe(409);
    expect(nej.body.error).toBe('unsorted_project');
    expect((await post(id)).status).toBe('forslag');

    const svar = await ok('approve_time_entries', {
      ids: [id], per_id: [{ id, project_id: iltProjekt }],
    });
    expect(svar.moved).toBe(1);
    const rad = await post(id);
    expect(rad.status).toBe('godkand');
    expect(rad.project_id).toBe(iltProjekt);
  });

  it('en Osorterat-post går alltid att ignorera — det kräver ingen kund', async () => {
    const id = await ettForslag({ project_hint: 'Femte Okänt AB', source_ref: 'calendar:ll2' });
    await ok('approve_time_entries', {
      ids: [id], status: 'ignorerad', adjustment_reason: 'Gick inte att härleda till en kund',
    });
    expect((await post(id)).status).toBe('ignorerad');
  });

  it('en fallerande rad rullar tillbaka HELA batchen — ingen halv kö', async () => {
    const bra = await ettForslag({ project_id: nvrPilot, source_ref: 'calendar:ll3' });
    const osorterad = await ettForslag({ project_hint: 'Sjätte Okänt AB', source_ref: 'calendar:ll4' });
    const res = await act('approve_time_entries', { ids: [bra, osorterad] });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    // Den goda posten fick INTE godkännas i tysthet: en kö som ser tömd ut med
    // en post kvar är samma familj som julifelet.
    expect((await post(bra)).status).toBe('forslag');
  });
});

// ---------------------------------------------------------------------------
// KRAV-12: ignorerad tid i rapporten
// ---------------------------------------------------------------------------

describe('ignorerad tid', () => {
  it('räknas aldrig som pengar i unbilled-rapporten — men går att lista', async () => {
    const id = await ettForslag({
      project_id: iltProjekt, source_ref: 'calendar:mm1', minutes: 240, description: 'Nedlagt arbete',
    });
    const fore = (await ok('unbilled_time_report', { project_id: iltProjekt })) as unknown as UnbilledTimeReport;
    await ok('approve_time_entries', {
      ids: [id], status: 'ignorerad', adjustment_reason: 'Egen produktutveckling',
    });
    const efter = (await ok('unbilled_time_report', { project_id: iltProjekt })) as unknown as UnbilledTimeReport;

    expect(efter.totals.amount_ore).toBe(fore.totals.amount_ore);
    expect(efter.totals.billable_minutes).toBe(fore.totals.billable_minutes);

    // Men den finns kvar och går att läsa — den raderas aldrig (PRD F7).
    const ignorerade = await poster({ status: 'ignorerad' });
    expect(ignorerade.some((r) => r.id === id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KRAV-10: gallringen av resonemangen
// ---------------------------------------------------------------------------

describe('reasoning-gallring', () => {
  it('nollställs i samma transaktion som posten blir fakturerad', async () => {
    const dag = dagarSedan(20);
    const id = await ettForslag({
      project_id: iltProjekt, work_date: dag, source_ref: 'calendar:nn1', minutes: 120,
      description: 'Fakturerbart arbete', reasoning: 'Kalenderhändelse med kundens beställare.',
    });
    await ok('approve_time_entries', { ids: [id] });
    expect((await post(id)).reasoning).toContain('Kalenderhändelse');

    const faktura = await ok('create_invoice_from_time', {
      customer_id: iltKund, project_id: iltProjekt, from: dag, to: dag,
      invoice_date: IDAG,
    });
    expect(faktura.time_entries).toBe(1);

    const rad = await post(id);
    expect(rad.status).toBe('fakturerad');
    expect(rad.reasoning).toBeNull();
    // source_ref behålls som spår — det är pekaren till underlaget.
    expect(rad.source_ref).toBe('calendar:nn1');
  });

  it('nollställs för ignorerade poster äldre än 90 dagar — men inte för färska', async () => {
    const gammal = await ettForslag({
      project_id: nvrPilot, source_ref: 'calendar:nn2', reasoning: 'Gammal motivering.',
    });
    const farsk = await ettForslag({
      project_id: nvrPilot, source_ref: 'calendar:nn3', reasoning: 'Färsk motivering.',
    });
    await ok('approve_time_entries', {
      ids: [gammal, farsk], status: 'ignorerad', adjustment_reason: 'Ej kundarbete',
    });

    // updated_at sätts av en trigger vid varje UPDATE, så åldern går inte att
    // skriva genom systemet. Triggern stängs av ett ögonblick — provet gäller
    // gallringens VILLKOR, inte hur åldern uppstod.
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE time_entries DISABLE TRIGGER time_entries_set_updated_at');
      await c.query("UPDATE time_entries SET updated_at = now() - interval '100 days' WHERE id = $1", [gammal]);
      await c.query('ALTER TABLE time_entries ENABLE TRIGGER time_entries_set_updated_at');
    });

    await ok('set_crm_retention', { retention_months: 84 });
    const svar = await godkannAction('purge_crm_data', {});
    expect(svar.time_entry_reasoning_cleared).toBe(1);

    expect((await post(gammal)).reasoning).toBeNull();
    expect((await post(gammal)).source_ref).toBe('calendar:nn2');
    expect((await post(farsk)).reasoning).toContain('Färsk motivering');
  });
});

// ---------------------------------------------------------------------------
// KRAV-8/9: förslagskön i vyn
// ---------------------------------------------------------------------------

describe('/tid/forslag — kön', () => {
  const kon = () => `/app/c/${companyId}/tid/forslag`;

  it('grupperar per dag, nyaste överst, och räknar obehandlade DAGAR i rubriken', async () => {
    const dagA = dagarSedan(30);
    const dagB = dagarSedan(31);
    await foresla([
      forslag({ project_id: iltProjekt, work_date: dagA, source_ref: 'calendar:oo1', description: 'Dag A ett' }),
      forslag({ project_id: iltProjekt, work_date: dagB, source_ref: 'calendar:oo2', description: 'Dag B ett' }),
    ]);
    const html = await sida(kon());

    const dagar = (await poster({ status: 'forslag' }))
      .reduce((s: Set<string>, r) => s.add(r.work_date), new Set<string>()).size;
    expect(html).toContain(`${dagar} obehandlade dagar`);
    // Nyaste dagen överst: äldre dagar ligger kvar under, de förfaller aldrig.
    expect(html.indexOf(dagA)).toBeLessThan(html.indexOf(dagB));
    expect(html).toContain('Dag A ett');
  });

  it('bär AI-märkningen på varje förslag (AI-förordningen art. 50)', async () => {
    const html = await sida(kon());
    expect(html).toContain('AI-genererat förslag');
    expect(html).toContain('class="ai-card"');
    // JS-fri vy: kön får inte vara undantaget.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick=');
  });

  it('en dag med två förslag klaras med två klick — utan sidbyte däremellan', async () => {
    const dag = dagarSedan(40);
    await foresla([
      forslag({ project_id: iltProjekt, work_date: dag, source_ref: 'calendar:pp1', description: 'Först' }),
      forslag({ project_id: iltProjekt, work_date: dag, source_ref: 'calendar:pp2', description: 'Sedan' }),
    ]);
    const rader = (await poster({ status: 'forslag' })).filter((r) => r.work_date === dag);
    expect(rader).toHaveLength(2);

    for (const r of rader) {
      const svar = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
        id: r.id, atgard: 'godkann', project_id: r.project_id, back: kon(),
      });
      expect(svar.fel, `oväntat fel: ${svar.fel}`).toBeNull();
      expect(svar.ok).toContain('Godkänt');
      // Man landar på KÖN igen — inget sidbyte mitt i dagen.
      expect(svar.location.startsWith(kon())).toBe(true);
    }
    for (const r of rader) expect((await post(r.id)).status).toBe('godkand');
  });

  it('"Godkänn hela dagen" finns per dag, är aldrig förvald och tar ett eget klick', async () => {
    const dag = dagarSedan(50);
    await foresla([
      forslag({ project_id: iltProjekt, work_date: dag, source_ref: 'calendar:qq1', description: 'Hela dagen ett' }),
      forslag({ project_id: iltProjekt, work_date: dag, source_ref: 'calendar:qq2', description: 'Hela dagen två' }),
    ]);
    const html = await sida(kon());
    // Egen knapp bakom en egen upplysning — aldrig ett förvalt kryss.
    expect(html).toContain('Godkänn hela dagen');
    expect(html).not.toContain('type="checkbox" checked');
    expect(html).not.toContain('type="radio" checked');

    const rader = (await poster({ status: 'forslag' })).filter((r) => r.work_date === dag);
    const svar = await postaFormular(`/app/c/${companyId}/tid/forslag/dag`, {
      ids: rader.map((r) => r.id).join(','), back: kon(),
    });
    expect(svar.fel).toBeNull();
    expect(svar.ok).toContain('Godkände 2 poster');
    for (const r of rader) expect((await post(r.id)).status).toBe('godkand');
  });

  it('en Osorterat-rad säger villkoret FÖRE klicket och går att lösa i samma formulär', async () => {
    const id = await ettForslag({ project_hint: 'Sjunde Okänt AB', source_ref: 'calendar:rr1' });
    const html = await sida(kon());
    expect(html).toContain('Ligger i Osorterat');

    const svar = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'godkann', project_id: iltProjekt, back: kon(),
    });
    expect(svar.fel).toBeNull();
    const rad = await post(id);
    expect(rad.status).toBe('godkand');
    expect(rad.project_id).toBe(iltProjekt);
  });

  it('ignorera ur kön kräver orsak och säger det när den saknas', async () => {
    const id = await ettForslag({ project_id: iltProjekt, source_ref: 'calendar:rr2' });
    const utan = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'ignorera', project_id: iltProjekt, back: kon(),
    });
    expect(utan.fel).toContain('adjustment_reason');
    expect((await post(id)).status).toBe('forslag');

    const med = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'ignorera', project_id: iltProjekt, adjustment_reason: 'Eget arbete', back: kon(),
    });
    expect(med.fel).toBeNull();
    expect((await post(id)).status).toBe('ignorerad');
  });

  it('justera ur kön sätter debiterbar tid med husets tidsparser', async () => {
    const id = await ettForslag({ project_id: iltProjekt, source_ref: 'calendar:rr3', minutes: 120 });
    const svar = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'justera', project_id: iltProjekt, billable_duration: '1,5',
      adjustment_reason: '30 min var intern administration', back: kon(),
    });
    expect(svar.fel).toBeNull();
    const rad = await post(id);
    expect(rad.status).toBe('justerad');
    expect(rad.billable_minutes).toBe(90);
  });

  it('"Faktureras ej" går igenom utan vald avtalsdel — "Godkänn" gör det inte', async () => {
    const id = await ettForslag({ project_id: nvrFas2, source_ref: 'calendar:rr5' });
    // Godkännandet kräver klassificeringen, och säger det med tjänstens text.
    const godkann = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'godkann', project_id: nvrFas2, back: kon(),
    });
    expect(godkann.fel).toContain('uppdraget har avtalsdelar');
    expect((await post(id)).status).toBe('forslag');

    // Samma rad, samma tomma väljare: att säga "det här ska inte faktureras"
    // förbrukar inget tak och kräver därför ingen del.
    const ignorera = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'ignorera', project_id: nvrFas2, adjustment_reason: 'Feltolkad kalenderpost', back: kon(),
    });
    expect(ignorera.fel).toBeNull();
    expect((await post(id)).status).toBe('ignorerad');
  });

  it('"Byt avtalsdel" klassar posten utan att godkänna den', async () => {
    const id = await ettForslag({ project_id: nvrFas2, source_ref: 'calendar:rr4' });
    const svar = await postaFormular(`/app/c/${companyId}/tid/forslag/rad`, {
      id, atgard: 'del', contract_part_id: nvrFas2Del, back: kon(),
    });
    expect(svar.fel).toBeNull();
    const rad = await post(id);
    expect(rad.contract_part_id).toBe(nvrFas2Del);
    expect(rad.status).toBe('forslag');
  });

  it('kön grindar aldrig fakturan — obehandlade förslag hindrar ingen fakturering', async () => {
    const dag = dagarSedan(60);
    const godkand = await ettForslag({
      project_id: iltProjekt, work_date: dag, source_ref: 'calendar:ss1', minutes: 60,
    });
    await ok('approve_time_entries', { ids: [godkand] });
    // Ett obehandlat förslag i samma period ligger kvar och rör sig inte.
    const vantande = await ettForslag({
      project_id: iltProjekt, work_date: dag, source_ref: 'calendar:ss2', minutes: 30,
    });

    const faktura = await ok('create_invoice_from_time', {
      customer_id: iltKund, project_id: iltProjekt, from: dag, to: dag, invoice_date: IDAG,
    });
    // Bara den godkända posten kom med — förslaget hindrade ingenting och kom
    // inte heller med av misstag.
    expect(faktura.time_entries).toBe(1);
    expect((await post(godkand)).status).toBe('fakturerad');
    expect((await post(vantande)).status).toBe('forslag');
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANS: tenant-gränsen
// ---------------------------------------------------------------------------

describe('tenant-isolering', () => {
  it('bolag B varken ser eller godkänner bolag A:s förslag', async () => {
    const id = await ettForslag({ project_id: nvrPilot, source_ref: 'calendar:tt1' });

    const annan = await registerUser('tidsforslag-b');
    const bolagB = await createCompany(annan.token, 'Bolag B AB');
    const bAuth = { Authorization: `Bearer ${annan.token}` };

    const lista = await api.post(`/api/companies/${bolagB}/actions/list_time_entries`).set(bAuth).send({});
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    expect((lista.body.result as { id: string }[]).some((r) => r.id === id)).toBe(false);

    const godkann = await api.post(`/api/companies/${bolagB}/actions/approve_time_entries`)
      .set(bAuth).send({ ids: [id] });
    expect([403, 404]).toContain(godkann.status);
    expect((await post(id)).status).toBe('forslag');

    // Och bolag B kan inte skriva ett förslag på bolag A:s uppdrag.
    const skriv = await api.post(`/api/companies/${bolagB}/actions/propose_time_entries`)
      .set(bAuth).send({ events: [forslag({ project_id: nvrPilot, source_ref: 'calendar:tt2' })] });
    expect(skriv.status, JSON.stringify(skriv.body)).toBe(200);
    expect((skriv.body.result as { created: number; skipped: unknown[] }).created).toBe(0);
    expect((skriv.body.result as { skipped: unknown[] }).skipped).toHaveLength(1);
  });
});
