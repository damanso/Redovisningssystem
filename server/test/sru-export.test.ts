// Fas C6: SRU-filgenerering för INK2. Två filer (info.sru + blanketter.sru) med
// INK2R räkenskapsschema och INK2S skattemässiga justeringar, fältkoder enligt
// Skatteverkets SKV 269. Beräknat underlag; ingen digital inlämning.
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

beforeAll(async () => {
  user = await registerUser('sru');
  companyId = await createCompany(user.token, 'SRU AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // Vinst före dispositioner 80 000; PF-avsättning 20 000; skatt 12 360 → resultat 47 640.
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
  await approveAction('book_periodiseringsfond', { fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 20000_00 });
  await approveAction('book_corporate_tax', { fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
});

async function sru() {
  const res = await api.post(`${co()}/actions/generate_ink2_sru`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

describe('SRU-filformat', () => {
  it('INFO.SRU har databeskrivning och medielev-sektion', async () => {
    const out = await sru();
    const info = out.info_sru as string;
    expect(info).toContain('#DATABESKRIVNING_START');
    expect(info).toContain('#PRODUKT SRU');
    expect(info).toContain('#FILNAMN blanketter.sru');
    expect(info).toContain('#MEDIELEV_START');
    expect(info).toContain('#ORGNR ');
    expect(info).toContain('#MEDIELEV_SLUT');
    // CRLF-radslut.
    expect(info).toContain('\r\n');
  });

  it('BLANKETTER.SRU har INK2R- och INK2S-blanketter med rätt struktur', async () => {
    const out = await sru();
    const b = out.blanketter_sru as string;
    expect(b).toContain('#BLANKETT INK2R-2025P4');
    expect(b).toContain('#BLANKETT INK2S-2025P4');
    expect(b).toContain('#IDENTITET ');
    expect(b).toContain('#BLANKETTSLUT');
    expect(b.trimEnd().endsWith('#FIL_SLUT')).toBe(true);
    expect(out.income_year).toBe(2025);
    expect(out.blankett_ids).toContain('INK2R-2025P4');
  });
});

describe('INK2R-fältkoder', () => {
  it('bär rätt belopp i hela kronor', async () => {
    const b = (await sru()).blanketter_sru as string;
    expect(b).toContain('#UPPGIFT 7410 100000'); // Nettoomsättning
    expect(b).toContain('#UPPGIFT 7513 20000');  // Övriga externa kostnader
    expect(b).toContain('#UPPGIFT 7525 20000');  // Avsättning till periodiseringsfond
    expect(b).toContain('#UPPGIFT 7528 12360');  // Skatt på årets resultat
    expect(b).toContain('#UPPGIFT 7450 47640');  // Årets resultat, vinst
  });
});

describe('INK2S-fältkoder', () => {
  it('bär skattemässiga justeringar', async () => {
    const b = (await sru()).blanketter_sru as string;
    expect(b).toContain('#UPPGIFT 7650 47640'); // 4.1 Årets resultat vinst
    expect(b).toContain('#UPPGIFT 7651 12360'); // 4.3a Skatt (återläggs)
    expect(b).toContain('#UPPGIFT 7670 60000'); // 4.15 Överskott
  });
});

// Grindfynd C1–C6 (MEDIUM): ett teckenväxlande finansiellt resultatfält (3.13 andelar,
// konto 8000–8199) som blir NEGATIVT ska emitteras till sin motsatta SRU-kod (7518),
// inte tappas — annars stämmer inte INK2R-raderna mot årets resultat.
describe('negativt resultat från andelar emitteras till 7518 (grindfynd)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;

  beforeAll(async () => {
    u = await registerUser('sru-neg');
    cid = await createCompany(u.token, 'Nedskrivning AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fyId = fy.body.fiscal_year.id;
    // Nedskrivning av andelar i koncernföretag: konto 8070 (inom 8000–8199) debet mot bank.
    await api.post(`${c()}/accounting/accounts`).set(a()).send({ account_number: 8070, name: 'Nedskrivningar av andelar i koncernföretag', account_type: 'expense' });
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send({
      fiscal_year_id: fyId, voucher_date: '2025-05-01', description: 'Nedskrivning andelar',
      lines: [{ account_number: 8070, debit_ore: 500000_00 }, { account_number: 1930, credit_ore: 500000_00 }],
    });
    await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
  });

  it('BLANKETTER.SRU bär 7518 med förlustbeloppet', async () => {
    const res = await api.post(`${c()}/actions/generate_ink2_sru`).set(a()).send({ fiscal_year_id: fyId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = res.body.result.blanketter_sru as string;
    expect(b).toContain('#UPPGIFT 7518 500000'); // negativt andelsresultat → kostnadskod
    expect(b).not.toContain('#UPPGIFT 7414');     // ska inte emitteras som positiv intäkt
    expect(b).toContain('#UPPGIFT 7550 500000');  // årets resultat, förlust
  });
});

describe('SRU-nedladdning', () => {
  it('vyn erbjuder filnedladdning med rätt content-disposition', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const view = await ua.get(`/app/c/${companyId}/ink2?fy=${fiscalYearId}`);
    expect(view.text).toContain('SRU-filer');
    const file = await ua.get(`/app/c/${companyId}/ink2/blanketter.sru?fy=${fiscalYearId}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('blanketter.sru');
    expect(file.text).toContain('#BLANKETT INK2R-2025P4');
  });
});
