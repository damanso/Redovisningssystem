// K6: reskontra-baklänkning + momsmetodvakt. link_voucher kopplar en
// registerpost till ett BEFINTLIGT verifikat utan att bokföra något nytt
// (importhistoriken blir läsbar i reskontran); suggest_voucher_links föreslår
// matchningar som människan bekräftar per rad. Momsmetoden är en bolags-
// inställning och verifikat som bryter mot den ger varning (notis + audit).
// Betalfakta via baklänkning går bara genom kön (FR-35, FR-8, FR-29, AD-2).
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { rejectPaymentMark } from '../src/services/voucherLinks.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
let supplierId: string;
let agentToken: string;
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
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
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  const cust = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'Ethos International' });
  customerId = cust.body.result.id;
  const supplier = await api.post(`${co()}/actions/create_supplier`).set(auth()).send({ name: 'Baklänk Leverantör AB' });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(200);
  supplierId = supplier.body.result.id;
  const token = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Baklänk-AI' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token;
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
    const req = await api.post(`${co()}/actions/link_voucher_and_mark_paid`).set(auth()).send({
      entity_type: 'invoice', entity_id: inv.body.result.id, voucher_id: voucherId,
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await approve(req.body);
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

describe('unlink_voucher — ångra baklänkning (Ethos-rättelsen 13–18)', () => {
  let invoiceId: string;
  let voucherId: string;

  it('ångrar en baklänkning: posten återgår till utkast, verifikatet finns kvar orört', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-09-01',
      lines: [{ description: 'Septembertjänst', quantity: 1, unit_price_ore: 300_000, vat_rate: 25 }],
    });
    invoiceId = inv.body.result.id;
    voucherId = await postManualVoucher('2025-09-02', '[SIE A500] Betald kundfaktura Ethos', [
      { account_number: 1930, debit_ore: 375_000 },
      { account_number: 3001, credit_ore: 300_000 },
      { account_number: 2611, credit_ore: 75_000 },
    ]);
    const link = await api.post(`${co()}/actions/link_voucher_and_mark_paid`).set(auth()).send({
      entity_type: 'invoice', entity_id: invoiceId, voucher_id: voucherId,
    });
    expect(link.status, JSON.stringify(link.body)).toBe(202);
    const linked = await approve(link.body);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);

    const before = await voucherCount();
    const req = await api.post(`${co()}/actions/unlink_voucher_and_reset_payment`).set(auth()).send({
      entity_type: 'invoice', entity_id: invoiceId,
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await approve(req.body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.unlinked).toBe(true);
    expect(res.body.result.reverted_status).toBe('draft');
    expect(await voucherCount()).toBe(before); // verifikatet raderas ALDRIG

    const got = await api.post(`${co()}/actions/get_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(got.body.result.voucher_id).toBeNull();
    expect(got.body.result.status).toBe('draft');
    expect(Number(got.body.result.paid_amount_ore)).toBe(0);

    const audit = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'invoice.voucher_unlinked' AND entity_id = $2",
      [companyId, invoiceId],
    )).rows[0]);
    expect(audit.n).toBe(1);
  });

  it('posten kan baklänkas på nytt efter ångrandet (fel koppling → rätt koppling)', async () => {
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: invoiceId, voucher_id: voucherId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.invoice.status).toBe('sent');
  });

  it('verifikat skapade genom bokning kan inte unlinkas — rättelseverifikat gäller (409)', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-09-10',
      lines: [{ description: 'Bokad tjänst', quantity: 1, unit_price_ore: 200_000, vat_rate: 25 }],
    });
    const req = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: inv.body.result.id });
    expect(req.status).toBe(202);
    const ok = await approve(req.body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const res = await api.post(`${co()}/actions/unlink_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: inv.body.result.id,
    });
    expect(res.status).toBe(409);
    // API:t exponerar bara felkoden (aldrig interna meddelanden) — koden räcker.
    expect(res.body.error).toBe('not_unlinkable');
  });

  it('okopplad post avvisas (409 not_linked)', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-09-15',
      lines: [{ description: 'Okopplad', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    const res = await api.post(`${co()}/actions/unlink_voucher`).set(auth()).send({
      entity_type: 'invoice', entity_id: inv.body.result.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_linked');
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

// Fasta tabeller och parametriserade värden: provet tar inga SQL-namn ur indata.
async function createInvoice(date: string, priceOre: number) {
  const res = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: date,
    lines: [{ description: 'Baklänkning', quantity: 1, unit_price_ore: priceOre, vat_rate: 25 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
async function createSupplierInvoice(date: string) {
  const due = new Date(`${date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  const res = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
    supplier_id: supplierId, invoice_date: date, due_date: due.toISOString().slice(0, 10),
    net_ore: 80_000, vat_rate: 25, expense_account: 6110,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
async function postSupplierVoucher(date: string) {
  return postManualVoucher(date, 'Baklänk leverantör', [
    { account_number: 6110, debit_ore: 80_000 },
    { account_number: 2641, debit_ore: 20_000 },
    { account_number: 1930, credit_ore: 100_000 },
  ]);
}
async function entityState(table: 'invoices' | 'supplier_invoices', id: string) {
  return withAdmin(async (db) => {
    const r = await db.query<{ voucher_id: string | null; status: string; paid_amount_ore: string }>(
      `SELECT voucher_id, status, paid_amount_ore FROM ${table} WHERE company_id = $1 AND id = $2`, [companyId, id],
    );
    expect(r.rows).toHaveLength(1);
    return { ...r.rows[0]!, paid_amount_ore: Number(r.rows[0]!.paid_amount_ore) };
  });
}
async function eventCount(action: string, id: string) {
  return withAdmin(async (db) => Number((await db.query(
    'SELECT count(*) AS n FROM audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3',
    [companyId, action, id],
  )).rows[0].n));
}
async function registerSnapshot() {
  return withAdmin(async (db) => {
    const result: Record<string, string> = {};
    for (const table of ['invoices', 'supplier_invoices', 'receipts', 'payslips', 'vouchers', 'voucher_lines'] as const) {
      const r = await db.query(`SELECT md5(COALESCE(string_agg(t::text, '' ORDER BY id), '')) AS hash FROM ${table} t WHERE company_id = $1`, [companyId]);
      result[table] = r.rows[0].hash;
    }
    return result;
  });
}

describe('baklänkning utan betalfakta (regression)', () => {
  let supplierInvoiceId: string;
  it('R1 leverantörsfaktura blir booked utan betalmarkering', async () => {
    const inv = await createSupplierInvoice('2025-06-01');
    supplierInvoiceId = inv.id;
    const voucherId = await postSupplierVoucher('2025-06-01');
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({ entity_type: 'supplier_invoice', entity_id: inv.id, voucher_id: voucherId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.supplier_invoice.status).toBe('booked');
    expect(await entityState('supplier_invoices', inv.id)).toEqual({ voucher_id: voucherId, status: 'booked', paid_amount_ore: 0 });
  });
  it('R2 kvitto blir booked genom vanlig baklänkning', async () => {
    const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
      receipt_date: '2025-06-01', description: 'Baklänk kvitto', net_ore: 10_000, vat_rate: 25, expense_account: 5460, payment_account: 1930,
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    const voucherId = await postManualVoucher('2025-06-01', 'Baklänk kvitto', [
      { account_number: 5460, debit_ore: 10_000 }, { account_number: 2641, debit_ore: 2_500 }, { account_number: 1930, credit_ore: 12_500 },
    ]);
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({ entity_type: 'receipt', entity_id: receipt.body.result.id, voucher_id: voucherId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.receipt.status).toBe('booked');
  });
  it('R3 obetald leverantörsfaktura lossas direkt', async () => {
    const res = await api.post(`${co()}/actions/unlink_voucher`).set(auth()).send({ entity_type: 'supplier_invoice', entity_id: supplierInvoiceId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.reverted_status).toBe('draft');
    expect(await entityState('supplier_invoices', supplierInvoiceId)).toEqual({ voucher_id: null, status: 'draft', paid_amount_ore: 0 });
  });
  it('R4 dubbelkoppling av leverantörsfaktura avvisas', async () => {
    const inv = await createSupplierInvoice('2025-06-02');
    const first = await postSupplierVoucher('2025-06-02');
    const second = await postSupplierVoucher('2025-06-03');
    const link = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({ entity_type: 'supplier_invoice', entity_id: inv.id, voucher_id: first });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({ entity_type: 'supplier_invoice', entity_id: inv.id, voucher_id: second });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('already_linked');
  });
  it('R5 baklänkningen ändrar inga verifikat och förslagen skriver inga registerrader', async () => {
    const inv = await createInvoice('2025-06-04', 80_000);
    const voucherId = await postSupplierVoucher('2025-06-04');
    const count = await voucherCount();
    const link = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({ entity_type: 'invoice', entity_id: inv.id, voucher_id: voucherId });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect(await voucherCount()).toBe(count);
    const unlink = await api.post(`${co()}/actions/unlink_voucher`).set(auth()).send({ entity_type: 'invoice', entity_id: inv.id });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);
    expect(unlink.body.result.reverted_status).toBe('draft');
    expect(await voucherCount()).toBe(count);
    const snapshot = await registerSnapshot();
    const linked = await eventCount('invoice.voucher_linked', inv.id);
    const unlinked = await eventCount('invoice.voucher_unlinked', inv.id);
    const suggest = await api.post(`${co()}/actions/suggest_voucher_links`).set(auth()).send({ entity_type: 'invoice' });
    expect(suggest.status, JSON.stringify(suggest.body)).toBe(200);
    expect(await registerSnapshot()).toEqual(snapshot);
    expect(await eventCount('invoice.voucher_linked', inv.id)).toBe(linked);
    expect(await eventCount('invoice.voucher_unlinked', inv.id)).toBe(unlinked);
    expect(await voucherCount()).toBe(count);
  });
  it('R6 agentens fakturabetalningar köas utan ändring före godkännande', async () => {
    const inv = await createInvoice('2025-06-05', 80_000);
    const before = await entityState('invoices', inv.id);
    const count = await voucherCount();
    for (const action of ['register_invoice_payment', 'book_invoice_and_register_payment']) {
      const res = await api.post(`${co()}/actions/${action}`).set(agent()).send({ invoice_id: inv.id, payment_date: '2025-06-30' });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.body.status).toBe('pending_approval');
      expect(await entityState('invoices', inv.id)).toEqual(before);
      expect(await voucherCount()).toBe(count);
    }
  });
});


describe('känsliga baklänkningsåtgärder', () => {
  it('S1 känsligheten är fast och manifestet anger godkännande', async () => {
    const res = await api.get(`${co()}/actions`).set(auth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const [name, sensitivity] of [
      ['link_voucher_and_mark_paid', 'sensitive'], ['unlink_voucher_and_reset_payment', 'sensitive'],
      ['link_voucher', 'write'], ['unlink_voucher', 'write'],
    ]) {
      const action = ACTIONS.find((a) => a.name === name);
      expect(action, name).toBeDefined();
      expect(action!.sensitivity).toBe(sensitivity);
      expect(action!.koasForAgent).toBeUndefined();
      expect(action!.koasAvSvepet).toBeUndefined();
      expect(action!.kravManniska).toBeUndefined();
      expect(res.body.actions.find((a: { name: string }) => a.name === name).requires_approval).toBe(sensitivity === 'sensitive');
    }
  });
  it('S2 kundfaktura betalmarkeras först efter människans ja till agentförslaget', async () => {
    await verifyPaymentLink('invoice', agent());
  });
  it('S3 leverantörsfaktura betalmarkeras först efter människans ja', async () => {
    await verifyPaymentLink('supplier_invoice', auth());
  });
  it('S4 kundfakturans betalmarkering återställs först efter godkännande', async () => {
    await verifyReset('invoice');
  });
  it('S5 leverantörsfakturans betalmarkering återställs först efter godkännande', async () => {
    await verifyReset('supplier_invoice');
  });
  it('S6 bokad koppling avvisas vid godkännandet och förslaget står pending', async () => {
    const inv = await createInvoice('2025-06-12', 80_000);
    const book = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: inv.id });
    expect(book.status, JSON.stringify(book.body)).toBe(202);
    const booked = await approve(book.body);
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    const before = await entityState('invoices', inv.id);
    const count = await voucherCount();
    const req = await api.post(`${co()}/actions/unlink_voucher_and_reset_payment`).set(auth()).send({ entity_type: 'invoice', entity_id: inv.id });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await approve(req.body);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('not_unlinkable');
    expect(await entityState('invoices', inv.id)).toEqual(before);
    expect(await voucherCount()).toBe(count);
    const rows = await withAdmin(async (db) => (await db.query('SELECT status FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, req.body.approval.id])).rows);
    expect(rows).toEqual([{ status: 'pending' }]);
  });
});

type InvoiceKind = 'invoice' | 'supplier_invoice';
const invoiceTable = (kind: InvoiceKind) => kind === 'invoice' ? 'invoices' : 'supplier_invoices';
async function paymentPair(kind: InvoiceKind) {
  const inv = kind === 'invoice' ? await createInvoice('2025-06-10', 400_000) : await createSupplierInvoice('2025-06-10');
  const voucherId = kind === 'invoice' ? await postManualVoucher('2025-06-10', 'Betald kundfaktura', [
    { account_number: 1930, debit_ore: 500_000 }, { account_number: 3001, credit_ore: 400_000 }, { account_number: 2611, credit_ore: 100_000 },
  ]) : await postSupplierVoucher('2025-06-10');
  return { inv, voucherId };
}
async function verifyPaymentLink(kind: InvoiceKind, headers: Record<string, string>) {
  const { inv, voucherId } = await paymentPair(kind);
  const table = invoiceTable(kind);
  const before = await entityState(table, inv.id);
  const count = await voucherCount();
  const req = await api.post(`${co()}/actions/link_voucher_and_mark_paid`).set(headers).send({ entity_type: kind, entity_id: inv.id, voucher_id: voucherId });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  expect(req.body.status).toBe('pending_approval');
  expect(await entityState(table, inv.id)).toEqual(before);
  expect(await eventCount(`${kind}.voucher_linked`, inv.id)).toBe(0);
  expect(await voucherCount()).toBe(count);
  const res = await approve(req.body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(await entityState(table, inv.id)).toEqual({ voucher_id: voucherId, status: 'paid', paid_amount_ore: kind === 'invoice' ? 500_000 : 100_000 });
  const rows = await withAdmin(async (db) => (await db.query("SELECT details->>'mark_paid' AS mark_paid FROM audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3", [companyId, `${kind}.voucher_linked`, inv.id])).rows);
  expect(rows).toEqual([{ mark_paid: 'true' }]);
  expect(await voucherCount()).toBe(count);
  return { inv, voucherId };
}
async function verifyReset(kind: InvoiceKind) {
  const { inv } = await verifyPaymentLink(kind, auth());
  const table = invoiceTable(kind);
  const before = await entityState(table, inv.id);
  const count = await voucherCount();
  const req = await api.post(`${co()}/actions/unlink_voucher_and_reset_payment`).set(auth()).send({ entity_type: kind, entity_id: inv.id });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  expect(await entityState(table, inv.id)).toEqual(before);
  expect(await eventCount(`${kind}.voucher_unlinked`, inv.id)).toBe(0);
  expect(await voucherCount()).toBe(count);
  const res = await approve(req.body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(await entityState(table, inv.id)).toEqual({ voucher_id: null, status: 'draft', paid_amount_ore: 0 });
  expect(await eventCount(`${kind}.voucher_unlinked`, inv.id)).toBe(1);
  expect(await voucherCount()).toBe(count);
}


describe('betalfakta bara genom kön', () => {
  it('P1 människan kan inte betalmarkera kundfakturan med link_voucher', async () => {
    // Den rena regeln provas även utan transport eller databas (steg 6).
    expect(() => rejectPaymentMark(false)).not.toThrow();
    expect(() => rejectPaymentMark(undefined)).not.toThrow();
    let failure: unknown;
    try { rejectPaymentMark(true); } catch (err) { failure = err; }
    expect(failure).toMatchObject({ status: 400, code: 'payment_requires_approval', details: { use_action: 'link_voucher_and_mark_paid' } });
    await verifyRejectedMark('invoice', auth());
  });
  it('P2 agenten kan inte betalmarkera kundfakturan med link_voucher', async () => {
    await verifyRejectedMark('invoice', agent());
  });
  it('P3 människan kan inte betalmarkera leverantörsfakturan med link_voucher', async () => {
    await verifyRejectedMark('supplier_invoice', auth());
  });
  it('P4 uttryckligt mark_paid false kopplar direkt med sent-status', async () => {
    const { inv, voucherId } = await paymentPair('invoice');
    const res = await api.post(`${co()}/actions/link_voucher`).set(auth()).send({ entity_type: 'invoice', entity_id: inv.id, voucher_id: voucherId, mark_paid: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.invoice.status).toBe('sent');
  });
  it('P5 kundfakturans betalmarkering kan inte nollställas med unlink_voucher', async () => {
    await verifyRejectedReset('invoice');
  });
  it('P6 leverantörsfakturans betalmarkering kan inte nollställas med unlink_voucher', async () => {
    await verifyRejectedReset('supplier_invoice');
  });
});
async function verifyRejectedMark(kind: InvoiceKind, headers: Record<string, string>) {
  const { inv, voucherId } = await paymentPair(kind);
  const before = await entityState(invoiceTable(kind), inv.id);
  const count = await voucherCount();
  const res = await api.post(`${co()}/actions/link_voucher`).set(headers).send({ entity_type: kind, entity_id: inv.id, voucher_id: voucherId, mark_paid: true });
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body).toEqual({ error: 'payment_requires_approval', details: { use_action: 'link_voucher_and_mark_paid' } });
  expect(await entityState(invoiceTable(kind), inv.id)).toEqual(before);
  expect(await eventCount(`${kind}.voucher_linked`, inv.id)).toBe(0);
  expect(await voucherCount()).toBe(count);
}
async function verifyRejectedReset(kind: InvoiceKind) {
  const { inv } = await verifyPaymentLink(kind, auth());
  const before = await entityState(invoiceTable(kind), inv.id);
  const count = await voucherCount();
  const res = await api.post(`${co()}/actions/unlink_voucher`).set(auth()).send({ entity_type: kind, entity_id: inv.id });
  expect(res.status, JSON.stringify(res.body)).toBe(409);
  expect(res.body).toEqual({ error: 'payment_requires_approval', details: { use_action: 'unlink_voucher_and_reset_payment' } });
  expect(await entityState(invoiceTable(kind), inv.id)).toEqual(before);
  expect(await eventCount(`${kind}.voucher_unlinked`, inv.id)).toBe(0);
  expect(await voucherCount()).toBe(count);
}


function actionSection(markdown: string, name: string): string {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `#### ${name}`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('#'));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}
describe('baklänkningens dokumentation', () => {
  it('D1 de känsliga åtgärdernas avsnitt beskriver kön och hänvisningarna', async () => {
    const markdown = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const link = actionSection(markdown, 'link_voucher_and_mark_paid');
    expect(link).not.toBe('');
    for (const word of ['sensitive', 'payment_requires_approval', '`link_voucher`']) expect(link).toContain(word);
    const unlink = actionSection(markdown, 'unlink_voucher_and_reset_payment');
    expect(unlink).not.toBe('');
    for (const word of ['sensitive', 'payment_requires_approval', 'not_unlinkable', '`unlink_voucher`']) expect(unlink).toContain(word);
    expect(actionSection('### Annat\ntext\n', 'link_voucher_and_mark_paid')).toBe('');
  });
});
