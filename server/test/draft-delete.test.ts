// K7: radering av OBOKADE registerutkast. Oföränderligheten gäller bokförda
// verifikat — ett utkast (t.ex. faktura registrerad på fel kund) får raderas.
// Bokförda poster avvisas; varje radering auditloggas med snapshot; RLS-
// policyn i migration 0041 är den hårda garantin även mot direkta DELETE.
// En post som någon gång kopplats via link_voucher raderas aldrig, inte heller
// efter unlink_voucher (FR-41, AD-12): händelsen i audit_log är spärren.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { linkAndUnlink, performAction, type LinkableKind } from './voucherLinkHelper.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
let supplierId: string;
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
  const supp = await api.post(`${co()}/actions/create_supplier`).set(auth()).send({ name: 'Utkastleverantör AB' });
  expect(supp.status, JSON.stringify(supp.body)).toBe(200);
  supplierId = supp.body.result.id;
});

// De fyra utkasttyperna. Tabellerna nyckas bara med typens fasta värden.
type Kind = LinkableKind;
const KIND_LIST: readonly Kind[] = ['invoice', 'receipt', 'supplier_invoice', 'payslip'];
const KIND_LABEL: Record<Kind, string> = {
  invoice: 'kundfaktura', receipt: 'kvitto', supplier_invoice: 'leverantörsfaktura', payslip: 'lönebesked',
};
const TABLE: Record<Kind, string> = {
  invoice: 'invoices', receipt: 'receipts', supplier_invoice: 'supplier_invoices', payslip: 'payslips',
};
const ID_FIELD: Record<Kind, string> = {
  invoice: 'invoice_id', receipt: 'receipt_id', supplier_invoice: 'supplier_invoice_id', payslip: 'payslip_id',
};
const DRAFT_STATUS: Record<Kind, string> = {
  invoice: 'draft', receipt: 'registered', supplier_invoice: 'draft', payslip: 'draft',
};
const BOOK_ACTION: Record<Kind, string> = {
  invoice: 'book_invoice', receipt: 'book_receipt', supplier_invoice: 'book_supplier_invoice', payslip: 'book_payslip',
};

async function createDraft(kind: Kind): Promise<string> {
  if (kind === 'invoice') return createInvoiceDraft();
  let res;
  if (kind === 'receipt') {
    res = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
      receipt_date: '2025-04-01', description: 'Fel kvitto', net_ore: 10_000, vat_rate: 25, expense_account: 5460, payment_account: 1930,
    });
  } else if (kind === 'supplier_invoice') {
    res = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
      supplier_id: supplierId, invoice_date: '2025-04-01', due_date: '2025-04-30',
      net_ore: 50_000, vat_rate: 25, expense_account: 5460,
    });
  } else {
    // En ny anställd per lönebesked: payslips_period_uk (0023) gäller per anställd och period.
    const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'Anna', monthly_salary_ore: 3_000_000 });
    expect(emp.status, JSON.stringify(emp.body)).toBe(200);
    res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: emp.body.result.id, period: '2025-05' });
  }
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id;
}

async function bookDraft(kind: Kind, id: string): Promise<void> {
  const res = await performAction(co(), auth(), BOOK_ACTION[kind], { [ID_FIELD[kind]]: id, fiscal_year_id: fiscalYearId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

function requestDelete(kind: Kind, id: string, base = co(), headers: Record<string, string> = auth()) {
  return api.post(`${base}/actions/delete_draft_${kind}`).set(headers).send({ [ID_FIELD[kind]]: id });
}

async function rowExists(kind: Kind, id: string): Promise<boolean> {
  return withAdmin(async (admin) =>
    ((await admin.query(`SELECT 1 FROM ${TABLE[kind]} WHERE id = $1 AND company_id = $2`, [id, companyId])).rowCount ?? 0) === 1);
}

async function draftDeletedRows(kind: Kind, id: string): Promise<{ details: { snapshot: { id: string; status: string } } }[]> {
  return withAdmin(async (admin) => (await admin.query(
    'SELECT details FROM audit_log WHERE company_id = $1 AND action = $2 AND entity_type = $3 AND entity_id = $4',
    [companyId, `${kind}.draft_deleted`, kind, id],
  )).rows);
}

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

describe('R: regressionsbaslinjen för de fyra utkastvägarna', () => {
  for (const kind of KIND_LIST) {
    it(`R1 ${KIND_LABEL[kind]}: ett utkast som aldrig nått huvudboken raderas med snapshot`, async () => {
      const id = await createDraft(kind);
      const res = await requestDelete(kind, id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.result.deleted).toBe(true);

      const audit = await draftDeletedRows(kind, id);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.details.snapshot.id).toBe(id);
      expect(audit[0]!.details.snapshot.status).toBe(DRAFT_STATUS[kind]);
      expect(await rowExists(kind, id)).toBe(false);
    });
  }

  for (const kind of KIND_LIST) {
    it(`R2 ${KIND_LABEL[kind]}: en bokförd post raderas aldrig (409)`, async () => {
      const id = await createDraft(kind);
      await bookDraft(kind, id);
      const res = await requestDelete(kind, id);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('not_deletable');
      expect(await rowExists(kind, id)).toBe(true);
      expect(await draftDeletedRows(kind, id)).toHaveLength(0);
    });
  }
});

describe('H: hänvisningen till rättelseverifikat syns i svaret', () => {
  for (const kind of KIND_LIST) {
    it(`H1 ${KIND_LABEL[kind]}: en bokförd post ger details med not_a_draft och reverse_voucher`, async () => {
      const id = await createDraft(kind);
      await bookDraft(kind, id);
      const res = await requestDelete(kind, id);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('not_deletable');
      expect(res.body.details).toEqual({ reason: 'not_a_draft', use_action: 'reverse_voucher' });
    });
  }
});

describe('B: en gång baklänkad post kan aldrig raderas', () => {
  const B_ID: Record<Kind, string> = { invoice: 'B1', supplier_invoice: 'B2', payslip: 'B3', receipt: 'B4' };

  for (const kind of KIND_LIST) {
    it(`${B_ID[kind]} ${KIND_LABEL[kind]}: kopplad och lossad ger 409 previously_linked och raden finns kvar`, async () => {
      const id = await createDraft(kind);
      await linkAndUnlink(co(), auth(), fiscalYearId, kind, id, '2025-04-01');

      // Lossad: raden ser ut som ett utkast som aldrig nått huvudboken.
      const state = await withAdmin(async (admin) => (await admin.query<{ voucher_id: string | null; status: string }>(
        `SELECT voucher_id, status FROM ${TABLE[kind]} WHERE id = $1 AND company_id = $2`, [id, companyId],
      )).rows);
      expect(state).toHaveLength(1);
      expect(state[0]!.voucher_id).toBeNull();
      expect(state[0]!.status).toBe(DRAFT_STATUS[kind]);

      const res = await requestDelete(kind, id);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('not_deletable');
      expect(res.body.details).toEqual({ reason: 'previously_linked', use_action: 'reverse_voucher' });
      expect(await rowExists(kind, id)).toBe(true);
      expect(await draftDeletedRows(kind, id)).toHaveLength(0);
    });
  }

  it('B5 kontrollen gäller posten: ett aldrig kopplat utkast raderas fast ett annat har kopplats och lossats', async () => {
    const linked = await createInvoiceDraft();
    const untouched = await createInvoiceDraft();
    await linkAndUnlink(co(), auth(), fiscalYearId, 'invoice', linked, '2025-04-01');

    const res = await requestDelete('invoice', untouched);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.deleted).toBe(true);
    expect(await rowExists('invoice', untouched)).toBe(false);
    expect(await rowExists('invoice', linked)).toBe(true);
  });

  it('B6 kopplad, lossad och kopplad igen ger 409 not_a_draft — dagens gren prövas först', async () => {
    const id = await createInvoiceDraft();
    const voucherId = await linkAndUnlink(co(), auth(), fiscalYearId, 'invoice', id, '2025-04-01');
    const relinked = await performAction(co(), auth(), 'link_voucher', { entity_type: 'invoice', entity_id: id, voucher_id: voucherId });
    expect(relinked.status, JSON.stringify(relinked.body)).toBe(200);

    const res = await requestDelete('invoice', id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('not_deletable');
    expect(res.body.details.reason).toBe('not_a_draft');
    expect(await rowExists('invoice', id)).toBe(true);
  });
});

/** Avsnittet från `### Städning (K7)` till nästa `### `-rubrik; tom text om rubriken saknas. */
function cleanupSection(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === '### Städning (K7)');
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('### '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

describe('D: dokumentationen för agenten', () => {
  it('D1 Städning (K7) i MCP_ACTIONS.md beskriver spärren och hänvisningen', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const section = cleanupSection(doc);
    expect(section).not.toBe('');
    for (const word of ['voucher_linked', 'previously_linked', 'not_a_draft', 'reverse_voucher', 'rättelseverifikat']) {
      expect(section, word).toContain(word);
    }
    // Negativ kontroll: en utplockning som lämnar hela texten fälls.
    expect(cleanupSection('### Annat\ntext\n')).toBe('');
  });
});

describe('R3: tenantgränsen för de fyra utkastvägarna', () => {
  let otherUser: TestUser;
  let otherCompany: string;

  beforeAll(async () => {
    otherUser = await registerUser('draftdel-r3');
    otherCompany = await createCompany(otherUser.token, 'Grannbolag AB');
  });

  for (const kind of KIND_LIST) {
    it(`R3 ${KIND_LABEL[kind]}: en medlem i ett annat bolag får 404 och raderar ingenting`, async () => {
      const id = await createDraft(kind);
      const res = await requestDelete(kind, id, `/api/companies/${otherCompany}`, { Authorization: `Bearer ${otherUser.token}` });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await rowExists(kind, id)).toBe(true);

      // RLS: en rå DELETE som app-rollen med B:s användare når inte A:s rad.
      const raw = await withAdmin(async (admin) => {
        await admin.query('BEGIN');
        await admin.query('SET LOCAL ROLE app');
        await admin.query("SELECT set_config('app.user_id', $1, true)", [otherUser.userId]);
        const r = await admin.query(`DELETE FROM ${TABLE[kind]} WHERE id = $1`, [id]);
        await admin.query('ROLLBACK');
        return r.rowCount;
      });
      expect(raw).toBe(0);
      expect(await rowExists(kind, id)).toBe(true);
    });
  }
});
