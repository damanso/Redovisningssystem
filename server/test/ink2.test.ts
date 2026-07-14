// Fas C4: INK2 deklarationsunderlag. INK2R räkenskapsschema (balanserar) + INK2S
// skattemässiga justeringar (bokfört resultat → beskattningsbart, med återläggning av
// bokförd skatt, manuella justeringar och underskottsavdrag). Beräknat underlag.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}
async function ink2r() {
  const res = await api.post(`${co()}/actions/ink2r_schema`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
async function ink2s() {
  const res = await api.post(`${co()}/actions/ink2s_adjustments`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

beforeAll(async () => {
  user = await registerUser('ink2');
  companyId = await createCompany(user.token, 'Deklaration AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // Vinst före dispositioner 80 000: intäkt 100 000, kostnad 20 000.
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-03-10', description: 'Inköp', net_ore: 20000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
  // Bokslut: avsättning PF 20 000 → resultat före skatt 60 000; skatt 20,6 % = 12 360.
  await approveAction('book_periodiseringsfond', { fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 20000_00 });
  await approveAction('book_corporate_tax', { fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
});

describe('INK2R räkenskapsschema', () => {
  it('resultatfälten summerar till årets resultat och balansräkningen balanserar', async () => {
    const r = await ink2r();
    // Nettoomsättning 100 000 finns som fält 3.1.
    const net = r.income_statement.fields.find((f: { code: string }) => f.code === '3.1');
    expect(net.amount_ore).toBe(100000_00);
    // Årets resultat = 100 000 − 20 000 (kostnad) − 20 000 (PF) − 12 360 (skatt) = 47 640.
    expect(r.income_statement.arets_resultat_ore).toBe(47640_00);
    // Summan av de visade resultatfälten = årets resultat.
    const sum = r.income_statement.fields.reduce((s: number, f: { amount_ore: number }) => s + f.amount_ore, 0);
    expect(sum).toBe(47640_00);
    // Balansräkningen balanserar.
    expect(r.balance_sheet.difference_ore).toBe(0);
    expect(r.balance_sheet.total_assets_ore).toBe(r.balance_sheet.total_equity_liabilities_ore);
  });
});

describe('INK2S skattemässiga justeringar', () => {
  it('återlägger bokförd skatt och stämmer mot bokförd skatt', async () => {
    const s = await ink2s();
    expect(s.bokfort_resultat_ore).toBe(47640_00);   // efter skatt
    expect(s.tax_addback_ore).toBe(12360_00);         // återläggning
    expect(s.result_before_loss_ore).toBe(60000_00);  // skattemässigt resultat
    expect(s.taxable_result_ore).toBe(60000_00);      // inget underskott
    expect(s.computed_tax_ore).toBe(12360_00);        // 20,6 % av 60 000
    expect(s.tax_difference_ore).toBe(0);             // stämmer mot bokförd skatt
  });

  it('manuell ej avdragsgill kostnad höjer överskottet och ger differens mot bokförd skatt', async () => {
    const add = await api.post(`${co()}/actions/add_tax_adjustment`).set(auth()).send({
      fiscal_year_id: fiscalYearId, kind: 'non_deductible', label: 'Ej avdragsgill representation', amount_ore: 5000_00,
    });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    const s = await ink2s();
    expect(s.non_deductible_ore).toBe(5000_00);
    expect(s.result_before_loss_ore).toBe(65000_00);
    expect(s.taxable_result_ore).toBe(65000_00);
    expect(s.computed_tax_ore).toBe(13390_00);        // 20,6 % av 65 000
    expect(s.tax_difference_ore).toBe(1030_00);       // 13 390 − 12 360
    // Går att ta bort igen.
    const del = await api.post(`${co()}/actions/delete_tax_adjustment`).set(auth()).send({ id: add.body.result.id });
    expect(del.status).toBe(200);
    const after = await ink2s();
    expect(after.non_deductible_ore).toBe(0);
  });
});

// Grindfynd C1–C6 (HIGH): kontospannet 2450–2499 måste täckas i INK2R-balansräkningen,
// annars läcker ett skuldsaldo rakt in i difference_ore och balansräkningen balanserar inte.
describe('INK2R balanserar med skuld i 2450–2499 (grindfynd)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;

  beforeAll(async () => {
    u = await registerUser('ink2-gap');
    cid = await createCompany(u.token, 'Gap AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fyId = fy.body.fiscal_year.id;
    // Skapa ett konto i luckan (2490 Övriga kortfristiga skulder) och bokför en skuld mot bank.
    await api.post(`${c()}/accounting/accounts`).set(a()).send({ account_number: 2490, name: 'Övriga kortfristiga skulder', account_type: 'liability' });
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send({
      fiscal_year_id: fyId, voucher_date: '2025-06-01', description: 'Skuld i luckan',
      lines: [{ account_number: 1930, debit_ore: 10000_00 }, { account_number: 2490, credit_ore: 10000_00 }],
    });
    await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
  });

  it('difference_ore = 0 och skulden syns i eget kapital och skulder', async () => {
    const res = await api.post(`${c()}/actions/ink2r_schema`).set(a()).send({ fiscal_year_id: fyId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r.balance_sheet.difference_ore).toBe(0);
    const field = r.balance_sheet.equity_liabilities.find((f: { code: string }) => f.code === '2.46');
    expect(field.amount_ore).toBe(10000_00);
  });
});

describe('INK2-vyn', () => {
  it('renderar INK2R och INK2S med förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/ink2`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('INK2R');
    expect(res.text).toContain('INK2S');
    expect(res.text).toContain('Beräknat underlag');
    expect(res.text).toContain('ingen digital inlämning');
  });
});
