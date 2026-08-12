// Tre förbättringar som flaggades under arbetet men bara låg som anteckningar:
//  F1  okänt konto ska FÖRESLÅ närmaste giltiga konto, inte bara avvisa
//  F2  "Att göra" ska visa VILKEN faktura/lön/verifikat förslaget gäller
//  F3  kontoplanen saknade 6992 (övriga externa kostnader, ej avdragsgilla)
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('usability');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  fiscalYearId = fy.id;
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Inläsningstjänst AB' });
  customerId = c.body.customer.id;
});

describe('F1: okänt konto föreslår närmaste giltiga', () => {
  it('tryckfel 6892 vid bokföring → svaret NAMNGER närmaste giltiga konton', async () => {
    // post_voucher är känslig: kontot valideras när åtgärden UTFÖRS (vid
    // godkännandet), så det är där förslaget måste dyka upp.
    const req = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
      fiscal_year_id: fiscalYearId, voucher_date: '2026-03-01', description: 'Tryckfel i konto',
      lines: [{ account_number: 6892, debit_ore: 10_000 }, { account_number: 1930, credit_ore: 10_000 }],
    });
    expect(req.status).toBe(202);
    const res = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_account');
    // Poängen med F1: förslaget måste nå ut i svaret, annars hjälper det ingen.
    expect(res.body.details, JSON.stringify(res.body)).toBeTruthy();
    expect(res.body.details.unknown_accounts).toEqual([6892]);
    const numbers = (res.body.details.suggestions as { account_number: number; name: string }[])
      .map((s) => s.account_number);
    expect(numbers.length).toBeGreaterThan(0);
    // Närmast 6892 bland 6xxx-kontona (6910 finns, 6992 nytt i denna leverans).
    expect(numbers).toContain(6910);
    for (const s of res.body.details.suggestions as { name: string }[]) {
      expect(typeof s.name).toBe('string');
    }
  });

  it('i webbvyn syns förslaget som notis när Godkänn inte kan utföras', async () => {
    const req = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
      fiscal_year_id: fiscalYearId, voucher_date: '2026-03-03', description: 'Tryckfel i vyn',
      lines: [{ account_number: 6892, debit_ore: 5_000 }, { account_number: 1930, credit_ore: 5_000 }],
    });
    expect(req.status).toBe(202);

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.post(`/app/c/${companyId}/approvals/${req.body.approval.id}/approve`).send({});
    expect([302, 303]).toContain(res.status);
    const page = await ua.get(res.headers.location!);
    expect(page.text).toContain('menade du');
    expect(page.text).toContain('6910');
  });

  it('förslaget håller sig inom samma kontoklass (kostnadskonto föreslås aldrig för en intäkt)', async () => {
    const res = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2026-03-01',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100_000, vat_rate: 25, revenue_account: 3999 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_account');
    const numbers = (res.body.details.suggestions as { account_number: number }[]).map((s) => s.account_number);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(n, `${n} är inte ett intäktskonto (3xxx)`).toBeGreaterThanOrEqual(3000);
      expect(n).toBeLessThanOrEqual(3999);
    }
  });
});

describe('F3: konto 6992 finns i kontoplanen', () => {
  it('6992 går att bokföra på och heter rätt', async () => {
    const accounts = await api.get(`${co()}/accounting/accounts`).set(auth());
    expect(accounts.status).toBe(200);
    const a6992 = (accounts.body.accounts as { account_number: number; name: string; account_type: string }[])
      .find((a) => a.account_number === 6992);
    expect(a6992, '6992 saknas i kontoplanen').toBeTruthy();
    expect(a6992!.name).toContain('ej avdragsgilla');
    expect(a6992!.account_type).toBe('expense');

    const req = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
      fiscal_year_id: fiscalYearId, voucher_date: '2026-03-02',
      description: 'Förseningsavgift Skatteverket (ej avdragsgill)',
      lines: [{ account_number: 6992, debit_ore: 62_500 }, { account_number: 1930, credit_ore: 62_500 }],
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('F2: Att göra visar vilken post förslaget gäller', () => {
  it('fakturabokning visar fakturanummer, kund och belopp — inte bara UUID', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2026-04-01',
      lines: [{ description: 'Konsulttid', quantity: 10, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
    });
    const invoiceId = inv.body.result.id;
    const invoiceNumber = inv.body.result.invoice_number;
    const req = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(req.status).toBe(202);

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const page = await ua.get(`/app/c/${companyId}/approvals`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`Faktura ${invoiceNumber}`);
    expect(page.text).toContain('ILT Inläsningstjänst AB');
    expect(page.text.replace(/[\s  ]/g, '')).toContain('13750,00'); // 11 000 + moms
  });

  it('lönebokning visar period, anställd och nettot', async () => {
    const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
      name: 'David Mancilla', monthly_salary_ore: 5_650_000, tax_rate: 23,
    });
    const slip = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({
      employee_id: emp.body.result.id, period: '2026-07',
    });
    const req = await api.post(`${co()}/actions/book_payslip`).set(auth()).send({
      payslip_id: slip.body.result.id, payment_date: '2026-07-24',
    });
    expect(req.status).toBe(202);

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const page = await ua.get(`/app/c/${companyId}/approvals`);
    expect(page.text).toContain('Lön 2026-07');
    expect(page.text).toContain('David Mancilla');
    expect(page.text).toContain('netto');
  });

  it('verifikatförslag utan post visar datum, text och belopp', async () => {
    const req = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
      fiscal_year_id: fiscalYearId, voucher_date: '2026-05-14', description: 'Manuell omföring maj',
      lines: [{ account_number: 6991, debit_ore: 25_000 }, { account_number: 1930, credit_ore: 25_000 }],
    });
    expect(req.status).toBe(202);

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const page = await ua.get(`/app/c/${companyId}/approvals`);
    expect(page.text).toContain('Manuell omföring maj');
    expect(page.text).toContain('2026-05-14');
    expect(page.text).toContain('Räkenskapsår 2026');
  });
});
