// K7: radering av OBOKADE registerutkast. Oföränderligheten gäller bokförda
// verifikat — ett utkast (t.ex. faktura registrerad på fel kund) får raderas.
// Bokförda poster avvisas; varje radering auditloggas med snapshot; RLS-
// policyn i migration 0041 är den hårda garantin även mot direkta DELETE.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approve(reqBody: { approval: { id: string } }) {
  return api.post(`${co()}/approvals/${reqBody.approval.id}/approve`).set(auth()).send({});
}

async function createInvoiceDraft(): Promise<string> {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2025-03-01',
    lines: [{ description: 'Fel kund', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  return inv.body.result.id;
}

beforeAll(async () => {
  user = await registerUser('draftdel');
  companyId = await createCompany(user.token, 'Utkast AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  const cust = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'Fel Kund AB' });
  customerId = cust.body.result.id;
});

describe('delete_draft_invoice', () => {
  it('raderar ett obokat fakturautkast, auditloggat med snapshot', async () => {
    const invoiceId = await createInvoiceDraft();
    const res = await api.post(`${co()}/actions/delete_draft_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.deleted).toBe(true);

    const list = await api.post(`${co()}/actions/list_invoices`).set(auth()).send({});
    expect(list.body.result.some((i: { id: string }) => i.id === invoiceId)).toBe(false);

    // Auditloggen bär snapshotten — raderingen är spårbar när raden är borta.
    const audit = await withAdmin(async (admin) => (await admin.query(
      "SELECT details FROM audit_log WHERE company_id = $1 AND action = 'invoice.draft_deleted' AND entity_id = $2",
      [companyId, invoiceId],
    )).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0].details.snapshot.status).toBe('draft');
  });

  it('en BOKFÖRD faktura kan inte raderas (409) — rättelse via rättelseverifikat', async () => {
    const invoiceId = await createInvoiceDraft();
    const bookReq = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: invoiceId, fiscal_year_id: fiscalYearId });
    expect((await approve(bookReq.body)).status).toBe(200);

    const res = await api.post(`${co()}/actions/delete_draft_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_deletable');

    // RLS-policyn är hård garanti: även en rå DELETE som app-rollen (med giltig
    // medlemskontext) tar 0 rader på en bokförd post.
    const raw = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE app');
      await admin.query("SELECT set_config('app.user_id', $1, true)", [user.userId]);
      const r = await admin.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
      await admin.query('ROLLBACK');
      return r.rowCount;
    });
    expect(raw).toBe(0);
  });

  it('raderar kvitto-, leverantörsfaktura- och lönebeskedsutkast', async () => {
    const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
      receipt_date: '2025-04-01', description: 'Fel kvitto', net_ore: 10_000, vat_rate: 25, expense_account: 5460, payment_account: 1930,
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    const delReceipt = await api.post(`${co()}/actions/delete_draft_receipt`).set(auth()).send({ receipt_id: receipt.body.result.id });
    expect(delReceipt.status, JSON.stringify(delReceipt.body)).toBe(200);

    const supp = await api.post(`${co()}/actions/create_supplier`).set(auth()).send({ name: 'Lev AB' });
    const suppInv = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
      supplier_id: supp.body.result.id, invoice_date: '2025-04-01', due_date: '2025-04-30',
      net_ore: 50_000, vat_rate: 25, expense_account: 5460,
    });
    expect(suppInv.status, JSON.stringify(suppInv.body)).toBe(200);
    const delSupp = await api.post(`${co()}/actions/delete_draft_supplier_invoice`).set(auth()).send({ supplier_invoice_id: suppInv.body.result.id });
    expect(delSupp.status, JSON.stringify(delSupp.body)).toBe(200);

    const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'Anna', monthly_salary_ore: 3_000_000 });
    const slip = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: emp.body.result.id, period: '2025-05' });
    const delSlip = await api.post(`${co()}/actions/delete_draft_payslip`).set(auth()).send({ payslip_id: slip.body.result.id });
    expect(delSlip.status, JSON.stringify(delSlip.body)).toBe(200);
  });

  it('dokumentkopplingar städas men bilagda filer behålls i arkivet', async () => {
    const invoiceId = await createInvoiceDraft();
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
      'hex',
    );
    const att = await api.post(`${co()}/actions/attach_document`).set(auth()).send({
      entity_type: 'invoice', entity_id: invoiceId, filename: 'underlag.png', content_base64: png.toString('base64'),
    });
    expect(att.status).toBe(200);
    const fileId = att.body.result.file_id;

    const res = await api.post(`${co()}/actions/delete_draft_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.unlinked_documents).toBe(1);

    // Kopplingen är borta men filen finns kvar i dokumentarkivet.
    const links = await api.post(`${co()}/actions/list_documents`).set(auth()).send({ entity_id: invoiceId });
    expect(links.body.result).toHaveLength(0);
    const file = await api.get(`${co()}/files/${fileId}`).set(auth());
    expect(file.status).toBe(200);
  });

  it('tenant-gräns: annan användares utkast ger 404', async () => {
    const invoiceId = await createInvoiceDraft();
    const other = await registerUser('draftdel-other');
    const otherCompany = await createCompany(other.token, 'Utomstående AB');
    const res = await api.post(`/api/companies/${otherCompany}/actions/delete_draft_invoice`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ invoice_id: invoiceId });
    expect(res.status).toBe(404);
  });
});
