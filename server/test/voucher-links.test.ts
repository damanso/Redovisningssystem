// K6: reskontra-baklänkning + momsmetodvakt. link_voucher kopplar en
// registerpost till ett BEFINTLIGT verifikat utan att bokföra något nytt
// (importhistoriken blir läsbar i reskontran); suggest_voucher_links föreslår
// matchningar som människan bekräftar per rad. Momsmetoden är en bolags-
// inställning och verifikat som bryter mot den ger varning (notis + audit).
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approve(reqBody: { approval: { id: string } }) {
  return api.post(`${co()}/approvals/${reqBody.approval.id}/approve`).set(auth()).send({});
}

// Bokför ett fristående "importverifikat" (motsvarar SIE-seriens rader).
async function postManualVoucher(date: string, description: string, lines: unknown[]): Promise<string> {
  const req = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
    fiscal_year_id: fiscalYearId, voucher_date: date, description, lines,
  });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const ok = await approve(req.body);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return ok.body.result.id;
}

async function voucherCount(): Promise<number> {
  const r = await withAdmin(async (admin) => (await admin.query('SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [companyId])).rows[0]);
  return r.n;
}

beforeAll(async () => {
  user = await registerUser('links');
  companyId = await createCompany(user.token, 'Baklänk AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const cust = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'Ethos International' });
  customerId = cust.body.result.id;
});

describe('link_voucher — baklänkning utan ny bokföring', () => {
  let invoiceId: string;
  let importVoucherId: string;

  it('kopplar en importerad faktura till sitt befintliga verifikat; inget nytt verifikat skapas', async () => {
    // Registerpost (som en import skulle skapa den): utkast utan voucher_id.
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-04-01',
      lines: [{ description: 'Konsulttjänst', quantity: 1, unit_price_ore: 1_000_000, vat_rate: 25 }],
    });
    invoiceId = inv.body.result.id;
    const invoiceNumber = inv.body.result.invoice_number;

    // Importverifikatet ([SIE A123]-motsvarigheten) finns redan i huvudboken.
    importVoucherId = await postManualVoucher('2025-04-01', `[SIE A123] Kundfaktura ${invoiceNumber} Ethos`, [
      { account_number: 1510, debit_ore: 1_250_000 },
      { account_number: 3001, credit_ore: 1_000_000 },
      { account_number: 2611, credit_ore: 250_000 },
    ]);

    const before = await voucherCount();
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: invoiceId, voucher_id: importVoucherId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.linked).toBe(true);
    expect(await voucherCount()).toBe(before); // INGET nytt verifikat

    const got = await api.post(`${co()}/actions/get_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(got.body.result.voucher_id).toBe(importVoucherId);
    expect(got.body.result.status).toBe('sent'); // bokförd — inte längre "ogjord"
  });

  it('dubbelbokning spärrad efter länkning: book_invoice ger 409', async () => {
    const req = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(req.status).toBe(202);
    const res = await approve(req.body);
    expect(res.status).toBe(409);
  });

  it('mark_paid härleder betald-status utan betalningsverifikat', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-05-01',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 400_000, vat_rate: 25 }],
    });
    const voucherId = await postManualVoucher('2025-05-02', '[SIE A200] Betald kundfaktura', [
      { account_number: 1930, debit_ore: 500_000 },
      { account_number: 3001, credit_ore: 400_000 },
      { account_number: 2611, credit_ore: 100_000 },
    ]);
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: inv.body.result.id, voucher_id: voucherId, mark_paid: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.invoice.status).toBe('paid');
    expect(Number(res.body.result.invoice.paid_amount_ore)).toBe(500_000);
  });

  it('lönebesked kan baklänkas och får utbetalningsdatum från verifikatet', async () => {
    const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'David', monthly_salary_ore: 5_650_000, tax_rate: 23 });
    const slip = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: emp.body.result.id, period: '2025-06', payment_date: '2025-06-25' });
    const voucherId = await postManualVoucher('2025-06-25', '[SIE A300] Lön juni', [
      { account_number: 7010, debit_ore: Number(slip.body.result.net_ore) },
      { account_number: 1930, credit_ore: Number(slip.body.result.net_ore) },
    ]);
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({
      entity_type: 'payslip', entity_id: slip.body.result.id, voucher_id: voucherId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.payslip.status).toBe('booked');
  });

  it('redan kopplad post avvisas (409)', async () => {
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: invoiceId, voucher_id: importVoucherId,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_linked');
  });
});

describe('suggest_voucher_links — halvautomatisk matchning', () => {
  it('föreslår verifikat på belopp + datum + text; människan bekräftar via link_voucher', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-07-01',
      lines: [{ description: 'Julitjänst', quantity: 1, unit_price_ore: 720_000, vat_rate: 25 }],
    });
    const invoiceNumber = inv.body.result.invoice_number;
    const voucherId = await postManualVoucher('2025-07-03', `[SIE A400] Kundfaktura ${invoiceNumber} Ethos International`, [
      { account_number: 1510, debit_ore: 900_000 },
      { account_number: 3001, credit_ore: 720_000 },
      { account_number: 2611, credit_ore: 180_000 },
    ]);

    const res = await api.post(`${co()}/actions/suggest_voucher_links`).set(auth()).send({ entity_type: 'invoice' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const suggestion = res.body.result.find((s: { entity_id: string }) => s.entity_id === inv.body.result.id);
    expect(suggestion, JSON.stringify(res.body.result)).toBeTruthy();
    expect(suggestion.voucher_id).toBe(voucherId);
    expect(suggestion.reasons.join(' ')).toMatch(/belopp/);
    expect(suggestion.reasons.join(' ')).toMatch(new RegExp(String(invoiceNumber)));

    // Människan bekräftar raden.
    const link = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: suggestion.entity_id, voucher_id: suggestion.voucher_id,
    });
    expect(link.status).toBe(200);
  });
});

describe('momsmetodvakt', () => {
  it('fakturametoden: intäkt direkt mot bank utan kundfordran ger varningsnotis + audit', async () => {
    // Bolagets metod är fakturametoden (default). Kontantmetod-mönstret:
    await postManualVoucher('2025-08-01', 'Kundinbetalning direkt', [
      { account_number: 1930, debit_ore: 125_000 },
      { account_number: 3001, credit_ore: 100_000 },
      { account_number: 2611, credit_ore: 25_000 },
    ]);
    const notes = await api.post(`${co()}/actions/list_notifications`).set(auth()).send({});
    const warning = notes.body.result.find((n: { kind: string }) => n.kind === 'vat_method_warning');
    expect(warning, JSON.stringify(notes.body.result)).toBeTruthy();
    expect(warning.title).toMatch(/Momsmetodvarning/);

    const audit = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'voucher.vat_method_warning'",
      [companyId],
    )).rows[0]);
    expect(audit.n).toBeGreaterThan(0);
  });

  it('regelrätt fakturametod-verifikat ger ingen varning', async () => {
    const before = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'voucher.vat_method_warning'", [companyId],
    )).rows[0]);
    await postManualVoucher('2025-08-05', 'Kundfaktura enligt metod', [
      { account_number: 1510, debit_ore: 125_000 },
      { account_number: 3001, credit_ore: 100_000 },
      { account_number: 2611, credit_ore: 25_000 },
    ]);
    const after = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'voucher.vat_method_warning'", [companyId],
    )).rows[0]);
    expect(after.n).toBe(before.n);
  });

  it('kontantmetoden: kundfordran (15xx) ger varning', async () => {
    const set = await api.post(`${co()}/actions/set_vat_method`).set(auth()).send({ vat_method: 'cash' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const before = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'voucher.vat_method_warning'", [companyId],
    )).rows[0]);
    await postManualVoucher('2025-08-10', 'Fordran trots kontantmetod', [
      { account_number: 1510, debit_ore: 50_000 },
      { account_number: 3001, credit_ore: 40_000 },
      { account_number: 2611, credit_ore: 10_000 },
    ]);
    const after = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'voucher.vat_method_warning'", [companyId],
    )).rows[0]);
    expect(after.n).toBe(before.n + 1);
    // Återställ till fakturametoden (beslut 2026-07-21).
    await api.post(`${co()}/actions/set_vat_method`).set(auth()).send({ vat_method: 'invoice' });
  });
});
