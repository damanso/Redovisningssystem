// Fas A4: leverantörsfakturor (leverantörsreskontra) — skapa, bokför (→ 2440),
// betala (debet 2440) och åldersanalys (AP aging).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let supplierId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

// Känsliga actions → begär (202) + godkänn.
async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}
async function apTotal(): Promise<number> {
  const res = await api.post(`${co()}/actions/accounts_payable_aging`).set(auth()).send({ as_of: '2025-07-01' });
  return res.body.result.totals.total_ore;
}

beforeAll(async () => {
  user = await registerUser('apinv');
  companyId = await createCompany(user.token, 'Inköp AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  const s = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Leverantör X AB', bankgiro: '123-4567' });
  supplierId = s.body.supplier.id;
});

describe('leverantörsfakturor + AP-aging', () => {
  let siId: string;

  it('skapar, bokför (→ kredit 2440 / ingående moms) och åldersanalyserar', async () => {
    const create = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
      supplier_id: supplierId, supplier_ref: 'F-9001', invoice_date: '2025-05-01', due_date: '2025-05-31',
      net_ore: 100000, vat_rate: 25, expense_account: 6110,
    });
    expect(create.status, JSON.stringify(create.body)).toBe(200);
    siId = create.body.result.id;
    expect(create.body.result.total_ore).toBe(125000); // 1000 + 25% moms

    // Före bokföring finns inget i reskontran (voucher_id saknas).
    expect(await apTotal()).toBe(0);

    const momsBefore = await api.get(`${co()}/accounting/vat-report?from=2025-01-01&to=2025-12-31`).set(auth());
    const book = await approveAction('book_supplier_invoice', { supplier_invoice_id: siId, fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.result.status).toBe('booked');

    // Ingående moms ökade med 25 000 ören (2641) → bevisar konteringen.
    const momsAfter = await api.get(`${co()}/accounting/vat-report?from=2025-01-01&to=2025-12-31`).set(auth());
    expect(momsAfter.body.report.input_vat_ore - momsBefore.body.report.input_vat_ore).toBe(25000);

    // 2025-07-01 − 2025-05-31 = 31 dagar → 31–60-hinken, 125 000 utestående.
    const res = await api.post(`${co()}/actions/accounts_payable_aging`).set(auth()).send({ as_of: '2025-07-01' });
    expect(res.body.result.totals.total_ore).toBe(125000);
    expect(res.body.result.totals.d31_60_ore).toBe(125000);
  });

  it('delbetalning debet 2440 → aging räknar netto; full betalning → paid', async () => {
    const p1 = await approveAction('register_supplier_payment', { supplier_invoice_id: siId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-10', amount_ore: 50000 });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(await apTotal()).toBe(75000);

    const p2 = await approveAction('register_supplier_payment', { supplier_invoice_id: siId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-20' });
    expect(p2.status).toBe(200);
    expect(p2.body.result.status).toBe('paid');
    expect(await apTotal()).toBe(0);
  });

  it('leverantörsreskontra-vyn renderas', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/payables`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Leverantörsreskontra');
    expect(res.text).toContain('Leverantör X AB');
  });
});

// Story 4.7 (FR-29): reskontran per as_of. Förut styrde as_of bara åldern —
// en faktura bokförd efter datumet kom med, och en faktura betald efter datumet
// saknades eller stod med för lite. Reskontran för en äldre dag stämde alltså
// inte mot kontoutdraget eller 2440. Eget bolag: fallen ovan läser hela
// «Inköp AB» på 2025-07-01, och nya fakturor där skulle ändra deras tal.
describe('4.7 leverantörsreskontran per as_of', () => {
  type Faktura = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  const LEVERANTORER = ['Leverantör Historik AB', 'Senare AB', 'Baklänkad AB', 'Kopplad AB'] as const;
  type Leverantor = (typeof LEVERANTORER)[number];
  // Provdata ur berättelsen: belopp i öre, moms 25 %, kostnadskonto 6110.
  const FAKTUROR: ReadonlyArray<{ ref: Faktura; lev: Leverantor; invoice_date: string; due_date: string; net_ore: number }> = [
    { ref: 'A', lev: 'Leverantör Historik AB', invoice_date: '2025-05-10', due_date: '2025-06-09', net_ore: 40_000 },
    { ref: 'B', lev: 'Senare AB', invoice_date: '2025-07-05', due_date: '2025-08-04', net_ore: 80_000 },
    { ref: 'C', lev: 'Leverantör Historik AB', invoice_date: '2025-06-01', due_date: '2025-07-01', net_ore: 160_000 },
    { ref: 'D', lev: 'Leverantör Historik AB', invoice_date: '2025-04-01', due_date: '2025-05-01', net_ore: 24_000 },
    { ref: 'E', lev: 'Baklänkad AB', invoice_date: '2025-06-10', due_date: '2025-07-10', net_ore: 8_000 },
    { ref: 'F', lev: 'Kopplad AB', invoice_date: '2025-06-12', due_date: '2025-07-12', net_ore: 16_000 },
  ];
  interface Rad { supplier_name: string; not_due_ore: number; d1_30_ore: number; d31_60_ore: number; d61_90_ore: number; d90_plus_ore: number; total_ore: number }
  interface Reskontra { as_of: string; rows: Rad[]; totals: Omit<Rad, 'supplier_name'> }

  let hu: TestUser;
  let hcid: string;
  let hfy: string;
  const si = {} as Record<Faktura, string>;
  const ha = () => ({ Authorization: `Bearer ${hu.token}` });
  const hc = () => `/api/companies/${hcid}`;

  async function godkann(namn: string, kropp: Record<string, unknown>) {
    const req = await api.post(`${hc()}/actions/${namn}`).set(ha()).send(kropp);
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await api.post(`${hc()}/approvals/${req.body.approval.id}/approve`).set(ha()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res;
  }
  async function reskontra(asOf?: string): Promise<Reskontra> {
    const res = await api.post(`${hc()}/actions/accounts_payable_aging`).set(ha()).send(asOf ? { as_of: asOf } : {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  }
  const rad = (resultat: Reskontra, namn: string): Rad | undefined => resultat.rows.find((r) => r.supplier_name === namn);
  // Baklänkningen på ett ställe: Story 1.5 och 1.6 flyttar den till kön och
  // skriver om just den här hjälparen.
  async function koppla(fakturaId: string, verifikatId: string, betald: boolean) {
    const res = await api.post(`${hc()}/actions/link_voucher`).set(ha()).send({
      entity_type: 'supplier_invoice', entity_id: fakturaId, voucher_id: verifikatId, ...(betald ? { mark_paid: true } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res;
  }

  beforeAll(async () => {
    hu = await registerUser('ap-asof-47');
    hcid = await createCompany(hu.token, 'Reskontra per datum AB');
    hfy = (await createFiscalYear(hcid, ha(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' })).id;

    const lev = {} as Record<Leverantor, string>;
    for (const name of LEVERANTORER) {
      const res = await api.post(`${hc()}/actions/create_supplier`).set(ha()).send({ name });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      lev[name] = res.body.result.id;
    }
    for (const f of FAKTUROR) {
      const res = await api.post(`${hc()}/actions/create_supplier_invoice`).set(ha()).send({
        supplier_id: lev[f.lev], supplier_ref: `4.7-${f.ref}`, invoice_date: f.invoice_date, due_date: f.due_date,
        net_ore: f.net_ore, vat_rate: 25, expense_account: 6110,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      si[f.ref] = res.body.result.id;
    }
    // A–D bokförs på fakturadatumet (verifikatets datum = invoice_date).
    for (const ref of ['A', 'B', 'C', 'D'] as const) {
      await godkann('book_supplier_invoice', { supplier_invoice_id: si[ref], fiscal_year_id: hfy });
    }
    // C: delbetalning 2025-06-15, resten 2025-07-10. D: hela 2025-05-20.
    await godkann('register_supplier_payment', { supplier_invoice_id: si.C, fiscal_year_id: hfy, payment_date: '2025-06-15', amount_ore: 50_000 });
    await godkann('register_supplier_payment', { supplier_invoice_id: si.C, fiscal_year_id: hfy, payment_date: '2025-07-10' });
    await godkann('register_supplier_payment', { supplier_invoice_id: si.D, fiscal_year_id: hfy, payment_date: '2025-05-20' });

    // E: en redan betald faktura vars verifikat inte rör 2440 (som en import),
    // betalmarkerad genom baklänkningen. F: kopplad men obetald, på 2440.
    const verE = await godkann('post_voucher', {
      fiscal_year_id: hfy, voucher_date: '2025-06-20', description: '4.7 betald leverantörsfaktura E',
      lines: [{ account_number: 6110, debit_ore: 8_000 }, { account_number: 2641, debit_ore: 2_000 }, { account_number: 1930, credit_ore: 10_000 }],
    });
    const verF = await godkann('post_voucher', {
      fiscal_year_id: hfy, voucher_date: '2025-06-25', description: '4.7 leverantörsfaktura F',
      lines: [{ account_number: 6110, debit_ore: 16_000 }, { account_number: 2641, debit_ore: 4_000 }, { account_number: 2440, credit_ore: 20_000 }],
    });
    const kE = await koppla(si.E, verE.body.result.id, true);
    expect(kE.body.result.supplier_invoice.status).toBe('paid');
    const kF = await koppla(si.F, verF.body.result.id, false);
    expect(kF.body.result.supplier_invoice.status).toBe('booked');
  });

  it('H1 en faktura bokförd efter as_of ingår inte', async () => {
    expect(rad(await reskontra('2025-06-30'), 'Senare AB')).toBeUndefined();
  });

  it('H2 fakturan ingår på sin bokföringsdag (dagen inräknad)', async () => {
    const r = rad(await reskontra('2025-07-05'), 'Senare AB');
    expect(r).toBeDefined();
    expect(r!.total_ore).toBe(100_000);
    expect(r!.not_due_ore).toBe(100_000);
  });

  it('H3 en baklänkad faktura ingår från det kopplade verifikatets datum, inte fakturadatumet', async () => {
    expect(rad(await reskontra('2025-06-24'), 'Kopplad AB')).toBeUndefined();
    const r = rad(await reskontra('2025-06-25'), 'Kopplad AB');
    expect(r).toBeDefined();
    expect(r!.total_ore).toBe(20_000);
    expect(r!.not_due_ore).toBe(20_000);
  });

  it('H4 utan as_of: databasens dag, och urval och belopp som i dag', async () => {
    const dag = () => withAdmin(async (db) => (await db.query<{ d: string }>('SELECT CURRENT_DATE::text AS d')).rows[0]!.d);
    const fore = await dag();
    const svar = await reskontra();
    const efter = await dag();
    // Ett dygnsskifte mellan läsningarna får inte fälla fallet.
    expect([fore, efter]).toContain(svar.as_of);

    // Oraklet är dagens definition: bokförd, ej annullerad, total − betalt > 0.
    const orakel = await withAdmin(async (db) => (await db.query<{ namn: string; total: string }>(
      `SELECT s.name AS namn, sum(si.total_ore - si.paid_amount_ore) AS total
         FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
        WHERE si.company_id = $1 AND si.voucher_id IS NOT NULL
          AND si.status <> 'cancelled' AND si.total_ore > si.paid_amount_ore
        GROUP BY s.name`,
      [hcid],
    )).rows);
    expect(svar.rows.length).toBe(orakel.length);
    for (const o of orakel) {
      const r = rad(svar, o.namn);
      expect(r, o.namn).toBeDefined();
      expect(r!.total_ore, o.namn).toBe(Number(o.total));
    }
    expect(Object.fromEntries(svar.rows.map((r) => [r.supplier_name, r.total_ore]))).toEqual({
      'Leverantör Historik AB': 50_000, 'Senare AB': 100_000, 'Kopplad AB': 20_000,
    });
    expect(svar.totals.total_ore).toBe(170_000);
    expect(rad(svar, 'Baklänkad AB')).toBeUndefined();
  });

  it('P1 hela bilden på as_of: A hela beloppet, C det som återstod, D och E saknas', async () => {
    const svar = await reskontra('2025-06-30');
    expect(svar.as_of).toBe('2025-06-30');
    expect(svar.rows.length).toBe(2);
    const h = rad(svar, 'Leverantör Historik AB');
    expect(h).toBeDefined();
    expect(h!.total_ore).toBe(200_000);
    expect(h!.not_due_ore).toBe(150_000); // C, förfaller 2025-07-01
    expect(h!.d1_30_ore).toBe(50_000); // A, 21 dagar efter förfallodagen
    const k = rad(svar, 'Kopplad AB');
    expect(k).toBeDefined();
    expect(k!.total_ore).toBe(20_000);
    expect(k!.not_due_ore).toBe(20_000);
    expect(svar.totals).toEqual({
      not_due_ore: 170_000, d1_30_ore: 50_000, d31_60_ore: 0, d61_90_ore: 0, d90_plus_ore: 0, total_ore: 220_000,
    });
  });

  it('P2 en delbetalning räknas från sin betaldag (dagen före och på dagen)', async () => {
    const fore = rad(await reskontra('2025-06-14'), 'Leverantör Historik AB');
    expect(fore).toBeDefined();
    expect(fore!.total_ore).toBe(250_000);
    expect(fore!.d1_30_ore).toBe(50_000);
    expect(fore!.not_due_ore).toBe(200_000);
    const pa = rad(await reskontra('2025-06-15'), 'Leverantör Historik AB');
    expect(pa).toBeDefined();
    expect(pa!.total_ore).toBe(200_000);
    expect(pa!.not_due_ore).toBe(150_000);
  });

  it('P3 en full betalning räknas från sin betaldag (dagen före och på dagen)', async () => {
    const fore = await reskontra('2025-05-19');
    expect(fore.rows.length).toBe(1);
    const h = rad(fore, 'Leverantör Historik AB');
    expect(h).toBeDefined();
    expect(h!.total_ore).toBe(80_000);
    expect(h!.d1_30_ore).toBe(30_000); // D, 18 dagar efter förfallodagen
    expect(h!.not_due_ore).toBe(50_000); // A
    const pa = rad(await reskontra('2025-05-20'), 'Leverantör Historik AB');
    expect(pa).toBeDefined();
    expect(pa!.total_ore).toBe(50_000);
  });

  it('P4 en betalmarkering via baklänkning räknas från det kopplade verifikatets datum', async () => {
    for (const asOf of ['2025-06-19', '2025-06-20', '2025-06-30']) {
      expect(rad(await reskontra(asOf), 'Baklänkad AB'), asOf).toBeUndefined();
    }
  });

  it('P5 reskontrans summa är lika med saldot på 2440 till och med as_of', async () => {
    for (const [asOf, vantat] of [['2025-06-30', 220_000], ['2025-06-14', 250_000]] as const) {
      const saldo = await withAdmin(async (db) => Number((await db.query<{ saldo: string }>(
        `SELECT COALESCE(sum(vl.credit_ore - vl.debit_ore), 0) AS saldo
           FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id AND v.company_id = vl.company_id
          WHERE vl.company_id = $1 AND vl.account_number = 2440 AND v.voucher_date <= $2::date`,
        [hcid, asOf],
      )).rows[0]!.saldo));
      expect(saldo, asOf).toBe(vantat);
      expect((await reskontra(asOf)).totals.total_ore, asOf).toBe(saldo);
    }
  });
});
