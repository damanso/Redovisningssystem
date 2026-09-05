// PRD_TIDSRAPPORTERING §4 F7, §7 acceptans 10 och §9.4 (story 4): rapporterna.
//
// Story 1–3 gjorde tiden mätbar, fakturan atomär och taket skrivbart. Kvar stod
// juli- och augustifelet i sin enklaste form: godkänd tid som aldrig
// fakturerades syntes ingenstans om ingen frågade. Proven nedan är det felet
// baklänges — rapporten ska stå på noll direkt efter en fakturering (acceptans
// 10), nedlagd tid ska synas utan att debiteras, ett AI-förslag ska räknas som
// ANTAL och aldrig som pengar, och styrytans gamla, avvikande formel ska vara
// borta: ett tal, tre ingångar.
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import { steeringOverview } from '../src/services/steering.js';
import type {
  ContractUsageRow, IdleProject, UnbilledCustomer, UnbilledTimeReport,
} from '../src/services/timeReports.js';

const PASSWORD = 'mycket-hemligt-losen-123';

// Datumen räknas ur dagens datum, inte ur fasta strängar: rapporternas
// skärdatum är "idag", och ett prov med inbrända datum hade slutat mäta det den
// dagen kalendern gick förbi dem.
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const IDAG = iso(new Date());
const dagarSedan = (n: number): string => iso(new Date(Date.parse(IDAG) - n * 86_400_000));
const AR = Number(IDAG.slice(0, 4));
const FORRA_MANADENS_SISTA = iso(new Date(Date.parse(`${IDAG.slice(0, 7)}-01`) - 86_400_000));

const TAXA_UPPDRAG = 100_000; // 1 000,00 kr/h

let user: TestUser;
let companyId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string; approval?: { id: string } } };

async function act(namn: string, kropp: Record<string, unknown> = {}, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

/** Känslig action: begär (202) och godkänn — samma väg som vyns knappar. */
async function godkann(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const begaran = await act(namn, kropp);
  expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
  const ok = await api.post(`${co()}/approvals/${begaran.body.approval!.id}/approve`).set(auth()).send({});
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return ok as unknown as Svar;
}

async function nyKund(namn: string): Promise<string> {
  const res = await api.post(`${co()}/customers`).set(auth()).send({ name: namn });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.customer.id as string;
}

async function nyttUppdrag(namn: string, customerId: string, taxa: number | null = TAXA_UPPDRAG): Promise<string> {
  const res = await act('create_project', {
    name: namn, customer_id: customerId, ...(taxa === null ? {} : { hourly_rate_ore: taxa }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function loggaTid(projectId: string, kropp: Record<string, unknown>, headers = auth()): Promise<string> {
  const res = await act('log_time', { project_id: projectId, description: 'Arbete', ...kropp }, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function rapport(filter: Record<string, unknown> = {}): Promise<UnbilledTimeReport> {
  const res = await act('unbilled_time_report', filter);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as unknown as UnbilledTimeReport;
}

/** Kundraden ur rapporten (misslyckas högt när kunden inte står där alls). */
async function kundrad(customerId: string): Promise<UnbilledCustomer> {
  const r = await rapport({ customer_id: customerId });
  const rad = r.customers.find((k) => k.customer_id === customerId);
  expect(rad, `kunden ${customerId} saknas i rapporten`).toBeTruthy();
  return rad!;
}

let agentToken: string;
const agent = () => ({ Authorization: `Bearer ${agentToken}` });

beforeAll(async () => {
  user = await registerUser('tidrapport');
  companyId = await createCompany(user.token, 'Locollabs AB');
  // Två räkenskapsår: betalningsprovet daterar en inbetalning i förra månaden,
  // och den kan ligga i föregående kalenderår när provet körs i januari.
  await createFiscalYear(companyId, auth(), {
    label: String(AR - 1), start_date: `${AR - 1}-01-01`, end_date: `${AR - 1}-12-31`,
  });
  await createFiscalYear(companyId, auth(), {
    label: String(AR), start_date: `${AR}-01-01`, end_date: `${AR}-12-31`,
  });
  const t = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  agentToken = t.body.token;
});

// ---------------------------------------------------------------------------

describe('unbilled_time_report: nedlagd tid syns, förslaget räknas, beloppet är godkänd tid', () => {
  let kund = '';
  let uppdrag = '';

  beforeAll(async () => {
    kund = await nyKund('ILT Education AB');
    uppdrag = await nyttUppdrag('Fas 2A — Commercial Cockpit', kund);
    // Godkänd tid: 120 + 60 min. Den äldsta är 40 dagar gammal.
    await loggaTid(uppdrag, { work_date: dagarSedan(40), minutes: 120, description: 'Modellstart' });
    await loggaTid(uppdrag, { work_date: dagarSedan(10), minutes: 60, description: 'Körplan' });
    // Nedlagd tid: registrerad, men aldrig debiterad.
    const nedlagd = await loggaTid(uppdrag, { work_date: dagarSedan(20), minutes: 90, description: 'Egen administration' });
    const om = await act('update_time_entry', {
      time_entry_id: nedlagd, status: 'ignorerad', adjustment_reason: 'egen administration, faktureras inte',
    });
    expect(om.status, JSON.stringify(om.body)).toBe(200);
    // AI:ts förslag: ett antal, aldrig pengar.
    await loggaTid(uppdrag, { work_date: dagarSedan(5), minutes: 45, description: 'Förslag ur kalendern' }, agent());
  });

  it('registrerade minuter rymmer den ignorerade tiden — beloppet gör det aldrig', async () => {
    const rad = await kundrad(kund);
    expect(rad.entries).toBe(3);            // 2 godkända + 1 ignorerad; förslaget räknas för sig
    expect(rad.minutes).toBe(120 + 60 + 90); // REGISTRERAD tid, inklusive den nedlagda
    expect(rad.billable_minutes).toBe(180);  // den ignorerade debiterar noll
    expect(rad.amount_ore).toBe(300_000);    // 3,0 h × 1 000 kr
    expect(rad.unbilled_ore).toBe(300_000);
  });

  it('förslaget är en räknare per uppdrag och ligger utanför beloppet', async () => {
    const rad = await kundrad(kund);
    expect(rad.proposal_entries).toBe(1);
    const projekt = rad.projects.find((p) => p.project_id === uppdrag)!;
    expect(projekt.proposal_entries).toBe(1);
    // Förslagets 45 minuter finns varken i registrerad tid eller i beloppet.
    expect(projekt.minutes).toBe(270);
    expect(projekt.amount_ore).toBe(300_000);
  });

  it('äldsta posten är den äldsta som bär belopp — det är den som väntat på en faktura', async () => {
    const rad = await kundrad(kund);
    expect(rad.oldest_work_date).toBe(dagarSedan(40));
  });

  it('svaret bär perioden och stillhetsdimensionen', async () => {
    const r = await rapport({ customer_id: kund });
    expect(r.to).toBe(IDAG);
    expect(r.period_from).toBe(`${IDAG.slice(0, 7)}-01`);
    expect(Array.isArray(r.idle)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('acceptans 10: rapporten står på noll direkt efter create_invoice_from_time', () => {
  it('perioden som just fakturerats syns inte längre som ofakturerad', async () => {
    const kund = await nyKund('Nordvik Analys AB');
    const uppdrag = await nyttUppdrag('Utredning hösten', kund);
    await loggaTid(uppdrag, { work_date: dagarSedan(30), minutes: 120, description: 'Utredning' });
    await loggaTid(uppdrag, { work_date: dagarSedan(25), minutes: 60, description: 'Avstämning' });

    const fore = await rapport({ project_id: uppdrag });
    expect(fore.totals.amount_ore).toBe(300_000);
    expect(fore.totals.entries).toBe(2);

    const faktura = await act('create_invoice_from_time', {
      customer_id: kund, project_id: uppdrag, from: dagarSedan(60), to: IDAG, invoice_date: IDAG,
    });
    expect(faktura.status, JSON.stringify(faktura.body)).toBe(200);
    expect(faktura.body.result.time_entries).toBe(2);

    const efter = await rapport({ project_id: uppdrag });
    expect(efter.customers).toEqual([]);
    expect(efter.totals.amount_ore).toBe(0);
    expect(efter.totals.entries).toBe(0);
    expect(efter.totals.oldest_work_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('taxaordningen i rapporten är fakturans: post → avtalsdel → avtal → uppdrag', () => {
  let kund = '';
  let uppdrag = '';
  let utanAvtal = '';
  let delMedTaxa = '';
  let delUtanTaxa = '';

  beforeAll(async () => {
    kund = await nyKund('Taxaordning AB');
    uppdrag = await nyttUppdrag('Avtalat uppdrag', kund, 100_000);
    const avtal = await act('create_contract', {
      project_id: uppdrag, name: 'Ramavtal 2026', signed_date: `${AR}-01-01`, hourly_rate_ore: 120_000,
    });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    const contractId = avtal.body.result.id as string;

    const a = await act('upsert_contract_part', {
      contract_id: contractId, code: '1', name: 'Fas 1', hourly_rate_ore: 140_000, valid_from: `${AR}-01-01`,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await act('upsert_contract_part', {
      contract_id: contractId, code: '2', name: 'Fas 2', valid_from: `${AR}-01-01`,
    });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const delar = b.body.result.parts as unknown as { code: string; part_id: string }[];
    delMedTaxa = delar.find((d) => d.code === '1')!.part_id;
    delUtanTaxa = delar.find((d) => d.code === '2')!.part_id;

    await loggaTid(uppdrag, { work_date: dagarSedan(9), minutes: 60, contract_part_id: delMedTaxa, description: 'Delens taxa' });
    await loggaTid(uppdrag, { work_date: dagarSedan(8), minutes: 60, contract_part_id: delUtanTaxa, description: 'Avtalets taxa' });
    await loggaTid(uppdrag, {
      work_date: dagarSedan(7), minutes: 60, contract_part_id: delMedTaxa,
      hourly_rate_ore: 160_000, description: 'Postens egen taxa',
    });

    // Uppdragets taxa är botten — den gäller för tid utan avtal.
    utanAvtal = await nyttUppdrag('Uppdrag utan avtal', kund, 100_000);
    await loggaTid(utanAvtal, { work_date: dagarSedan(6), minutes: 60, description: 'Uppdragets taxa' });
  });

  it('varje nivå i ordningen värderas för sig', async () => {
    const rad = await kundrad(kund);
    const avtalat = rad.projects.find((p) => p.project_id === uppdrag)!;
    const fritt = rad.projects.find((p) => p.project_id === utanAvtal)!;

    const del1 = avtalat.parts.find((d) => d.contract_part_id === delMedTaxa)!;
    const del2 = avtalat.parts.find((d) => d.contract_part_id === delUtanTaxa)!;
    expect(del1.amount_ore).toBe(140_000 + 160_000); // delens taxa + postens override
    expect(del2.amount_ore).toBe(120_000);           // avtalets taxa
    expect(fritt.parts[0]!.contract_part_id).toBeNull();
    expect(fritt.parts[0]!.amount_ore).toBe(100_000); // uppdragets taxa
    expect(rad.amount_ore).toBe(140_000 + 160_000 + 120_000 + 100_000);
  });

  it('rapportens belopp är samma tal som fakturan tar ut', async () => {
    const fore = await rapport({ project_id: uppdrag });
    const forvantat = fore.totals.amount_ore;
    const faktura = await act('create_invoice_from_time', {
      customer_id: kund, project_id: uppdrag, from: dagarSedan(60), to: IDAG, invoice_date: IDAG,
    });
    expect(faktura.status, JSON.stringify(faktura.body)).toBe(200);
    const skapad = faktura.body.result.invoice as Record<string, unknown>;
    expect(skapad.subtotal_ore).toBe(forvantat);
  });
});

// ---------------------------------------------------------------------------

describe('betalningsdimensionen: ofakturerat, fakturerat men obetalt, betalt i perioden', () => {
  let kund = '';

  beforeAll(async () => {
    kund = await nyKund('Betalkund AB');
    const uppdrag = await nyttUppdrag('Löpande drift', kund, 100_000);
    // Den fakturerade delen (120 min → 2 000 kr netto, 2 500 kr med moms).
    await loggaTid(uppdrag, { work_date: dagarSedan(50), minutes: 120, description: 'Drift maj' });
    // Den som ligger kvar ofakturerad.
    await loggaTid(uppdrag, { work_date: dagarSedan(3), minutes: 60, description: 'Drift denna vecka' });

    const faktura = await act('create_invoice_from_time', {
      customer_id: kund, project_id: uppdrag, from: dagarSedan(60), to: dagarSedan(40), invoice_date: IDAG,
    });
    expect(faktura.status, JSON.stringify(faktura.body)).toBe(200);
    const fakturaId = (faktura.body.result.invoice as Record<string, unknown>).id as string;

    await godkann('book_invoice', { invoice_id: fakturaId });
    // En betalning FÖRE periodens början och en inuti den. Bara den senare får
    // räknas — annars mäter kolumnen något annat än det den heter.
    await godkann('register_invoice_payment', {
      invoice_id: fakturaId, payment_date: FORRA_MANADENS_SISTA, amount_ore: 50_000,
    });
    await godkann('register_invoice_payment', {
      invoice_id: fakturaId, payment_date: IDAG, amount_ore: 30_000,
    });
  });

  it('de tre kolumnerna står bredvid varandra på kundraden', async () => {
    const rad = await kundrad(kund);
    expect(rad.unbilled_ore).toBe(100_000);                 // 1,0 h kvar att fakturera
    expect(rad.invoiced_unpaid_ore).toBe(250_000 - 80_000); // total − båda betalningarna
    expect(rad.paid_in_period_ore).toBe(30_000);            // bara betalningen i perioden
  });

  it('förfalloredovisningen kommer ur kundreskontran, inte ur en ny beräkning', async () => {
    const rad = await kundrad(kund);
    const aging = await act('accounts_receivable_aging', { as_of: IDAG });
    expect(aging.status, JSON.stringify(aging.body)).toBe(200);
    const kundens = (aging.body.result as unknown as { rows: { customer_id: string; total_ore: number }[] })
      .rows.find((r) => r.customer_id === kund)!;
    expect(rad.invoiced_unpaid_ore).toBe(kundens.total_ore);
  });
});

// ---------------------------------------------------------------------------

describe('idle_projects_report: ATT det ligger still, aldrig varför', () => {
  let stilla = '';
  let bemannat = '';
  let stangt = '';

  beforeAll(async () => {
    const kund = await nyKund('Stillhet AB');
    stilla = await nyttUppdrag('Ligger still', kund);
    await loggaTid(stilla, { work_date: dagarSedan(30), minutes: 60, description: 'Sista insatsen' });
    bemannat = await nyttUppdrag('Bemannat i veckan', kund);
    await loggaTid(bemannat, { work_date: IDAG, minutes: 60, description: 'Dagens arbete' });
    stangt = await nyttUppdrag('Avslutat uppdrag', kund);
    await loggaTid(stangt, { work_date: dagarSedan(40), minutes: 60, description: 'Slutleverans' });
    const status = await act('set_project_status', { project_id: stangt, status: 'closed' });
    expect(status.status, JSON.stringify(status.body)).toBe(200);
  });

  async function idle(kropp: Record<string, unknown> = {}): Promise<IdleProject[]> {
    const res = await act('idle_projects_report', kropp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as unknown as IdleProject[];
  }

  it('träffar det stilla aktiva uppdraget, men varken det nyligen bemannade eller det stängda', async () => {
    const lista = await idle();
    const ids = lista.map((p) => p.project_id);
    expect(ids).toContain(stilla);
    expect(ids).not.toContain(bemannat);
    expect(ids).not.toContain(stangt);
  });

  it('raden bär uppdrag, kund och senaste tidpost — och inget skäl', async () => {
    const rad = (await idle()).find((p) => p.project_id === stilla)!;
    expect(rad.project_name).toBe('Ligger still');
    expect(rad.customer_name).toBe('Stillhet AB');
    expect(rad.last_work_date).toBe(dagarSedan(30));
    // Databasens CURRENT_DATE och testets UTC-datum kan skilja ett dygn i en
    // annan tidszon; det som prövas är att åldern RÄKNAS, inte tidszonen.
    expect(rad.days_idle).toBeGreaterThanOrEqual(29);
    expect(rad.days_idle).toBeLessThanOrEqual(31);
    expect(Object.keys(rad)).not.toContain('reason');
  });

  it('fönstret är ställbart: med 60 dagar är uppdraget inte längre stilla', async () => {
    expect((await idle({ days: 60 })).map((p) => p.project_id)).not.toContain(stilla);
  });

  it('samma lista ligger i unbilled_time_report som idle[]', async () => {
    const r = await rapport();
    expect(r.idle.map((p) => p.project_id)).toContain(stilla);
  });
});

// ---------------------------------------------------------------------------

describe('contract_usage_report: fasförälderns andel är barnens summa', () => {
  let fas2 = '';
  let fas2a = '';

  beforeAll(async () => {
    const kund = await nyKund('Takkund AB');
    const uppdrag = await nyttUppdrag('Avtalat program', kund, 100_000);
    const avtal = await act('create_contract', {
      project_id: uppdrag, name: 'Programavtal', signed_date: `${AR}-01-01`,
    });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    const contractId = avtal.body.result.id as string;
    // 0068: ett bekräftat tak kräver ett fryst kontrakt. Avtalet är
    // undertecknat och fryses därför med samma sats som 0068:s backfill
    // använder — någon action för det finns först i S1.2.
    await withAdmin((c) => c.query(
      "UPDATE contracts SET kontrakt_tillstand = 'fryst' WHERE id = $1", [contractId],
    ));

    const foralder = await act('upsert_contract_part', {
      contract_id: contractId, code: '2', name: 'Fas 2', cap_hours: 10, cap_confirmed: true,
      valid_from: `${AR}-01-01`,
    });
    expect(foralder.status, JSON.stringify(foralder.body)).toBe(200);
    const foralderId = (foralder.body.result.parts as unknown as { code: string; part_id: string }[])
      .find((d) => d.code === '2')!.part_id;
    fas2 = foralderId;

    for (const kod of ['2A', '2B']) {
      const del = await act('upsert_contract_part', {
        contract_id: contractId, code: kod, name: `Fas ${kod}`, parent_part_id: foralderId,
        cap_hours: 6, cap_confirmed: true, valid_from: `${AR}-01-01`,
      });
      expect(del.status, JSON.stringify(del.body)).toBe(200);
    }
    const delar = (await act('get_contract_usage', { contract_id: contractId }))
      .body.result.parts as unknown as { code: string; part_id: string }[];
    fas2a = delar.find((d) => d.code === '2A')!.part_id;
    const fas2b = delar.find((d) => d.code === '2B')!.part_id;

    // 4 h på vardera barnet: barnen ligger under 80 % av sina 6 h, föräldern
    // står på 8 av 10 h. Utan upprullningen hade fasen sett tom ut.
    await loggaTid(uppdrag, { work_date: dagarSedan(12), minutes: 240, contract_part_id: fas2a, description: 'Fas 2A' });
    await loggaTid(uppdrag, { work_date: dagarSedan(11), minutes: 240, contract_part_id: fas2b, description: 'Fas 2B' });
  });

  async function rader(): Promise<ContractUsageRow[]> {
    const res = await act('contract_usage_report', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as unknown as ContractUsageRow[];
  }

  it('föräldern bär barnens tid, sitt eget tak och sin egen status', async () => {
    const alla = await rader();
    const foralder = alla.find((r) => r.part_id === fas2)!;
    expect(foralder.billable_minutes).toBe(480);
    expect(foralder.used_hours).toBe(8);
    expect(foralder.cap_hours).toBe(10);
    expect(foralder.share).toBe(0.8);
    expect(foralder.status).toBe('80–100 %');

    const barn = alla.find((r) => r.part_id === fas2a)!;
    expect(barn.parent_code).toBe('2');
    expect(barn.billable_minutes).toBe(240);
    expect(barn.status).toBe('under 80 %');
  });

  it('ofakturerat inom delen rullas upp i föräldern, precis som förbrukningen', async () => {
    const alla = await rader();
    const foralder = alla.find((r) => r.part_id === fas2)!;
    const barn = alla.find((r) => r.part_id === fas2a)!;
    expect(barn.unbilled_amount_ore).toBe(400_000);      // 4 h × 1 000 kr
    expect(foralder.unbilled_amount_ore).toBe(800_000);  // 2A + 2B
    expect(foralder.unbilled_billable_minutes).toBe(480);
  });

  it('ett obekräftat tak varnar aldrig — det redovisas som vet ej', async () => {
    const kund = await nyKund('Oläst tak AB');
    const uppdrag = await nyttUppdrag('Uppdrag med oläst tak', kund, 100_000);
    const avtal = await act('create_contract', { project_id: uppdrag, name: 'Oläst', signed_date: `${AR}-01-01` });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    const contractId = avtal.body.result.id as string;
    const del = await act('upsert_contract_part', {
      contract_id: contractId, code: 'X', name: 'Oläst fas', cap_hours: 1, valid_from: `${AR}-01-01`,
    });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const partId = (del.body.result.parts as unknown as { code: string; part_id: string }[])
      .find((d) => d.code === 'X')!.part_id;
    await loggaTid(uppdrag, { work_date: dagarSedan(4), minutes: 600, contract_part_id: partId, description: 'Långt över' });

    const rad = (await rader()).find((r) => r.part_id === partId)!;
    expect(rad.cap_status).toBe('vet_ej');
    expect(rad.share).toBeNull();
    expect(rad.status).toBe('vet ej');
  });
});

// ---------------------------------------------------------------------------

describe('styrytan läser samma definition — den äldre formeln är borta', () => {
  it('unbilled_time_ore är rapportens summa, och ett förslag räknas inte längre', async () => {
    // Eget bolag: styrytans tal är hela bolagets, och då måste bolaget vara känt.
    const egen = await registerUser('tidstyrning');
    const eget = await createCompany(egen.token, 'Styrbolaget AB');
    const egenAuth = { Authorization: `Bearer ${egen.token}` };
    await createFiscalYear(eget, egenAuth, { label: String(AR), start_date: `${AR}-01-01`, end_date: `${AR}-12-31` });
    const token = await api.post(`/api/companies/${eget}/agent-tokens`).set(egenAuth).send({ name: 'Cowork' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);

    const kundSvar = await api.post(`/api/companies/${eget}/customers`).set(egenAuth).send({ name: 'Enda kunden AB' });
    const projekt = await api.post(`/api/companies/${eget}/actions/create_project`).set(egenAuth)
      .send({ name: 'Uppdraget', customer_id: kundSvar.body.customer.id, hourly_rate_ore: 100_000 });
    const projectId = projekt.body.result.id as string;

    const logga = (headers: Record<string, string>, kropp: Record<string, unknown>) =>
      api.post(`/api/companies/${eget}/actions/log_time`).set(headers)
        .send({ project_id: projectId, description: 'Arbete', ...kropp });

    const godkand = await logga(egenAuth, { work_date: dagarSedan(5), minutes: 120 });
    expect(godkand.status, JSON.stringify(godkand.body)).toBe(200);
    // AI:ts förslag är `billable` i speglingen och räknades därför FÖRUT som
    // ofakturerad intäkt. Nu gör det inte det — det är hela skillnaden.
    const forslag = await logga({ Authorization: `Bearer ${token.body.token}` }, { work_date: dagarSedan(4), minutes: 600 });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
    expect(forslag.body.result.status).toBe('forslag');

    const svar = await api.post(`/api/companies/${eget}/actions/unbilled_time_report`).set(egenAuth).send({});
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    const summa = (svar.body.result as UnbilledTimeReport).totals.amount_ore;
    expect(summa).toBe(200_000); // 2,0 h × 1 000 kr — förslagets 10 h räknas inte

    const klient = await pool.connect();
    try {
      await klient.query('BEGIN');
      await setTenantContext(klient, egen.userId, eget);
      const styrning = await steeringOverview(klient, eget);
      expect(styrning.coverage.unbilled_time_ore).toBe(summa);
      await klient.query('ROLLBACK');
    } finally {
      klient.release();
    }
  });
});

// ---------------------------------------------------------------------------

describe('vysidan /tid', () => {
  it('svarar 200 med sina tre tabeller, menyposten och länken till uppdraget', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const sida = await ua.get(`/app/c/${companyId}/tid`);
    expect(sida.status).toBe(200);

    expect(sida.text).toContain('Ofakturerad tid per kund');
    expect(sida.text).toContain('Uppdrag som ligger still');
    expect(sida.text).toContain('Avtalsförbrukning mot tak');
    // Kolumnrubrikerna som bär betalningsdimensionen.
    expect(sida.text).toContain('Fakturerat, obetalt');
    expect(sida.text).toContain('Betalt i perioden');
    // Menyposten finns, och sidan är markerad som "du är här".
    expect(sida.text).toContain(`href="/app/c/${companyId}/tid"`);
    // Förslagsraden pekar på uppdraget (godkännandeytan kommer i story 8).
    expect(sida.text).toContain('förslag väntar');
    expect(sida.text).toMatch(/href="\/app\/c\/[^"]+\/projects\/[0-9a-f-]{36}"/);
    // Ingen JavaScript på sidan.
    expect(sida.text).not.toContain('<script');
  });
});
