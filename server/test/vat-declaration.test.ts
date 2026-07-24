// Fas C5: momsdeklaration (skattedeklaration för moms) — alla rutor 05–49 beräknade
// ur bokföringen. Utgående moms per sats (10–12), ingående moms (48), moms att betala
// (49), underlag (05) och undantagen försäljning (35/39/42). Beräknat underlag.
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
async function invoice(lines: Record<string, unknown>[]) {
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-02-10', due_date: '2025-03-10', lines,
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
}

beforeAll(async () => {
  user = await registerUser('vatdecl');
  companyId = await createCompany(user.token, 'Moms AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // 25 %-försäljning 100 000 → utgående moms 25 000 (ruta 10), underlag 100 000 (ruta 05).
  await invoice([{ description: 'Konsult', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }]);
  // 12 %-försäljning 50 000 → utgående moms 6 000 (ruta 11).
  await invoice([{ description: 'Mat', quantity: 1, unit_price_ore: 50000_00, vat_rate: 12 }]);
  // EU-tjänst (konto 3308, momsfri) 30 000 → ruta 39.
  await invoice([{ description: 'EU-tjänst', quantity: 1, unit_price_ore: 30000_00, vat_rate: 0, revenue_account: 3308 }]);
  // Momsfri försäljning (konto 3004) 10 000 → ruta 42.
  await invoice([{ description: 'Momsfritt', quantity: 1, unit_price_ore: 10000_00, vat_rate: 0, revenue_account: 3004 }]);
  // Kostnad 20 000 + 25 % → ingående moms 5 000 (ruta 48).
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-02-15', description: 'Inköp', net_ore: 20000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
});

async function decl() {
  const res = await api.post(`${co()}/actions/vat_declaration`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
const box = (boxes: { code: string; amount_ore: number }[], code: string) => boxes.find((b) => b.code === code)!.amount_ore;

describe('momsdeklaration rutor 05–49', () => {
  it('utgående moms per sats, underlag och undantagen försäljning', async () => {
    const d = await decl();
    // B. Utgående moms.
    expect(box(d.output_vat, '10')).toBe(25000_00); // 25 % av 100 000
    expect(box(d.output_vat, '11')).toBe(6000_00);  // 12 % av 50 000
    expect(box(d.output_vat, '12')).toBe(0);
    // A. Underlag ruta 05 = 100 000 + 50 000 (rekonstruerat ur momsen).
    expect(box(d.sales, '05')).toBe(150000_00);
    // E. Undantagen försäljning.
    expect(box(d.exempt_sales, '39')).toBe(30000_00); // EU-tjänst
    expect(box(d.exempt_sales, '42')).toBe(10000_00); // momsfri
  });

  it('ingående moms (48) och moms att betala (49)', async () => {
    const d = await decl();
    expect(d.input_vat.amount_ore).toBe(5000_00);      // ruta 48
    expect(d.warnings).toEqual([]);                    // ingående moms finns → ingen kompletthetsvarning
    // 49 = (25 000 + 6 000) − 5 000 = 26 000.
    expect(d.net.amount_ore).toBe(26000_00);
    expect(d.net_to_pay_ore).toBe(26000_00);
    expect(d.net.label).toBe('Moms att betala');
  });

  it('alla rutor 05–49 finns i uppställningen', async () => {
    const d = await decl();
    const codes = [
      ...d.sales, ...d.output_vat, ...d.reverse_purchases, ...d.reverse_output_vat,
      ...d.exempt_sales, d.input_vat, d.net,
    ].map((b: { code: string }) => b.code);
    for (const c of ['05', '06', '07', '08', '10', '11', '12', '20', '21', '22', '23', '24', '30', '31', '32', '35', '36', '37', '38', '39', '40', '41', '42', '48', '49']) {
      expect(codes, `ruta ${c} saknas`).toContain(c);
    }
  });
});

// Grindfynd C1–C6 (MEDIUM): omvänd skattskyldighet/förvärvsmoms på 12 %/6 % (konton
// 2624–2629 / 2634–2639) får INTE räknas som vanlig utgående moms (ruta 11/12) — de
// hör till ruta 31/32 med underlag i ruta 21, inte ruta 05.
describe('omvänd skattskyldighet 12 % hamnar i ruta 31 (grindfynd)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;

  beforeAll(async () => {
    u = await registerUser('vat-rev');
    cid = await createCompany(u.token, 'Omvänd AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fyId = fy.body.fiscal_year.id;
    // EU-tjänsteförvärv 12 %: beräknad utgående moms 2624 (kredit) mot beräknad ingående 2645 (debet).
    await api.post(`${c()}/accounting/accounts`).set(a()).send({ account_number: 2624, name: 'Utgående moms omvänd skattskyldighet, 12 %', account_type: 'liability' });
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send({
      fiscal_year_id: fyId, voucher_date: '2025-04-01', description: 'EU-tjänst omvänd 12%',
      lines: [{ account_number: 2645, debit_ore: 1200_00 }, { account_number: 2624, credit_ore: 1200_00 }],
    });
    await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
  });

  it('ruta 31 = utgående omvänd 12 %, ruta 21 = underlag, ruta 11 och 05 opåverkade', async () => {
    const res = await api.post(`${c()}/actions/vat_declaration`).set(a()).send({ from: '2025-01-01', to: '2025-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body.result;
    const b = (boxes: { code: string; amount_ore: number }[], code: string) => boxes.find((x) => x.code === code)!.amount_ore;
    expect(b(d.reverse_output_vat, '31')).toBe(1200_00);   // utgående omvänd 12 %
    expect(b(d.reverse_purchases, '21')).toBe(10000_00);   // underlag 1 200 / 0,12
    expect(b(d.output_vat, '11')).toBe(0);                 // INTE vanlig utgående 12 %
    expect(b(d.sales, '05')).toBe(0);                      // INTE momspliktig egen försäljning
    expect(d.input_vat.amount_ore).toBe(1200_00);          // ingående 2645
    expect(d.net_to_pay_ore).toBe(0);                      // 1 200 utgående − 1 200 ingående
  });
});

describe('momsdeklarationsvyn', () => {
  it('renderar rutor och förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/vat?from=2025-01-01&to=2025-12-31`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Momsdeklaration');
    expect(res.text).toContain('Utgående moms 25 %');
    expect(res.text).toContain('Moms att betala');
    expect(res.text).toContain('ingen digital inlämning');
  });
});


// Kompletthetsvakt (2026-07-24): ingående moms (ruta 48) får aldrig TYST bli 0 när
// perioden har momsbärande inköp. Reproducerar H1 2026-felet: utlägg importerade brutto
// (kostnad utan 2640-rad) gav en deklaration som såg komplett ut men underrapporterade
// ingående moms tills en manuell kvittogenomgång upptäckte det.
describe('kompletthetsvakt: ingående moms 0 trots inköp (regressionsskydd)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;
  const declFor = async () => {
    const res = await api.post(`${c()}/actions/vat_declaration`).set(a()).send({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  };
  const postAndApprove = async (body: Record<string, unknown>) => {
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send(body);
    expect(v.status, JSON.stringify(v.body)).toBe(202);
    await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
  };

  beforeAll(async () => {
    u = await registerUser('vat-guard');
    cid = await createCompany(u.token, 'Bruttoimport AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    fyId = fy.body.fiscal_year.id;
    // Kostnad bokförd BRUTTO utan ingående moms (5410 debet / 1930 kredit, ingen 2640-rad).
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-05-29', description: 'Utlägg bruttoimporterat (AR-glasögon)',
      lines: [{ account_number: 5410, debit_ore: 20990_00 }, { account_number: 1930, credit_ore: 20990_00 }],
    });
  });

  it('varnar (inte tyst) när ruta 48 = 0 men konton 5000–6999 har inköp', async () => {
    const d = await declFor();
    expect(d.input_vat.amount_ore).toBe(0);              // ruta 48 = 0 (bruttobokfört)
    expect(d.warnings.length).toBeGreaterThan(0);        // men flaggat
    expect(d.warnings.join(' ')).toContain('Ingående moms (ruta 48) är 0');
  });

  it('varningen försvinner när momsen lyfts till 2640 (momsomföring)', async () => {
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-06-30', description: 'Momsomföring: lyft ingående moms',
      lines: [{ account_number: 2640, debit_ore: 4198_00 }, { account_number: 5410, credit_ore: 4198_00 }],
    });
    const d = await declFor();
    expect(d.input_vat.amount_ore).toBe(4198_00);        // ruta 48 ifylld
    expect(d.warnings).toEqual([]);                      // ingen varning kvar
  });
});
