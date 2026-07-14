import type { PoolClient } from 'pg';
import { withTenantTransaction } from '../db/tx.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { assertSafeOre, roundOre, sumOre, type Ore } from '../domain/money.js';
import { isVatRate, vatFromNet, type VatRate } from '../domain/vat.js';
import { generateOcr } from '../domain/ocr.js';
import { assertAccountsExist } from './accounting/accounts.js';
import { postCustomerInvoice, postCustomerPayment } from './accounting/autopost.js';
import { writeAudit } from './auditService.js';
import { generateInvoicePdf } from './pdfService.js';
import { nextDocumentNumber } from './accounting/numbering.js';
import { removeStoredFile, validateUpload, writeStoredFile } from './fileStorage.js';

export interface InvoiceLineInput {
  article_id?: string;
  description?: string;
  quantity: number;
  unit?: string;
  unit_price_ore?: Ore;
  vat_rate?: VatRate;
  revenue_account?: number;
}

export interface CreateInvoiceInput {
  customer_id: string;
  invoice_date: string;
  due_date?: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  reverse_charge?: boolean;
  lines: InvoiceLineInput[];
}

// Konto för försäljning med omvänd skattskyldighet (byggsektorn), redovisas i
// momsdeklarationens ruta 41.
export const REVERSE_CHARGE_ACCOUNT = 3231;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function createInvoice(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: CreateInvoiceInput,
): Promise<Record<string, unknown>> {
  if (input.lines.length === 0) throw new BadRequestError('no_lines', 'fakturan saknar rader');

  const customer = await client.query<{ payment_terms: number | null; org_number: string | null; vat_number: string | null }>(
    'SELECT payment_terms, org_number, vat_number FROM customers WHERE id = $1 AND company_id = $2',
    [input.customer_id, companyId],
  );
  if (!customer.rows[0]) throw new NotFoundError('customer');

  // Omvänd skattskyldighet (byggmoms): fakturan ställs ut utan moms och köparen
  // redovisar den. Köparen måste kunna identifieras (org.nr eller vat-nr) eftersom
  // fakturan enligt lag ska ange att omvänd skattskyldighet gäller.
  const reverseCharge = input.reverse_charge === true;
  if (reverseCharge && !customer.rows[0].org_number && !customer.rows[0].vat_number) {
    throw new BadRequestError('reverse_charge_requires_buyer_id', 'omvänd skattskyldighet kräver att köparen har org.nr eller vat-nr');
  }

  // Radberäkning i ören. Artikel fyller i default pris/moms/konto/enhet.
  const resolved = [];
  for (const [i, line] of input.lines.entries()) {
    let unitPrice = line.unit_price_ore;
    let vatRate = line.vat_rate;
    let revenueAccount = line.revenue_account;
    let unit = line.unit;
    let description = line.description;
    if (line.article_id) {
      const art = await client.query<{
        name: string; unit: string; unit_price_ore: number; vat_rate: number; revenue_account: number;
      }>(
        'SELECT name, unit, unit_price_ore, vat_rate, revenue_account FROM articles WHERE id = $1 AND company_id = $2 AND is_active',
        [line.article_id, companyId],
      );
      if (!art.rows[0]) throw new BadRequestError('unknown_article', `rad ${i + 1}: okänd/inaktiv artikel`);
      unitPrice ??= art.rows[0].unit_price_ore;
      vatRate ??= art.rows[0].vat_rate as VatRate;
      revenueAccount ??= art.rows[0].revenue_account;
      unit ??= art.rows[0].unit;
      description ??= art.rows[0].name;
    }
    // Vid omvänd skattskyldighet debiteras ingen moms (köparen redovisar den) och
    // intäkten MÅSTE bokföras på ett konto i intervallet 3231–3239 (som momsdeklara-
    // tionens ruta 41 läser). Tvinga dit den även om en artikel eller indata angav ett
    // vanligt intäktskonto — annars skulle försäljningen försvinna ur momsdeklarationen.
    if (reverseCharge) {
      vatRate = 0;
      if (revenueAccount === undefined || revenueAccount < 3231 || revenueAccount > 3239) {
        revenueAccount = REVERSE_CHARGE_ACCOUNT;
      }
    }
    if (unitPrice === undefined || vatRate === undefined) {
      throw new BadRequestError('invalid_line', `rad ${i + 1}: pris och momssats krävs`);
    }
    if (!isVatRate(vatRate)) throw new BadRequestError('invalid_vat_rate', `rad ${i + 1}: otillåten momssats`);
    if (!description) throw new BadRequestError('invalid_line', `rad ${i + 1}: beskrivning krävs`);
    // Kvantitet lagras som numeric(14,3). Avrunda till 3 decimaler HÄR så att
    // lagrat antal, PDF och line_net är konsekventa, och så att t.ex. 0.0004
    // inte blir 0.000 i databasen (CHECK-brott → 500) utan avvisas rent.
    const quantity = Math.round(line.quantity * 1000) / 1000;
    if (!(quantity > 0)) throw new BadRequestError('invalid_line', `rad ${i + 1}: antal måste vara positivt`);
    assertSafeOre(unitPrice);
    const product = quantity * unitPrice;
    if (!Number.isSafeInteger(Math.round(product))) {
      throw new BadRequestError('invalid_line', `rad ${i + 1}: radbelopp utanför tillåtet intervall`);
    }
    resolved.push({
      article_id: line.article_id ?? null,
      description,
      quantity,
      unit: unit ?? 'st',
      unit_price_ore: unitPrice,
      vat_rate: vatRate,
      revenue_account: revenueAccount ?? 3001,
      line_net_ore: roundOre(product),
    });
  }

  // Validera intäktskonton tidigt (fail-fast) i stället för först vid bokföring.
  await assertAccountsExist(client, companyId, resolved.map((l) => l.revenue_account));

  const subtotal = sumOre(resolved.map((l) => l.line_net_ore));
  const vat = sumOre(resolved.map((l) => vatFromNet(l.line_net_ore, l.vat_rate)));
  const total = assertSafeOre(subtotal + vat);

  const number = await nextDocumentNumber(client, companyId, 'invoice');
  const ocr = generateOcr(String(number).padStart(6, '0'), { lengthControl: true });
  const paymentTerms = input.payment_terms ?? customer.rows[0].payment_terms ?? 30;
  const dueDate = input.due_date ?? addDays(input.invoice_date, paymentTerms);
  if (dueDate < input.invoice_date) {
    throw new BadRequestError('invalid_due_date', 'förfallodatum får inte vara före fakturadatum');
  }

  const inv = await client.query<{ id: string }>(
    `INSERT INTO invoices (company_id, customer_id, invoice_number, ocr, invoice_date, due_date,
        subtotal_ore, vat_ore, total_ore, reference, notes, reverse_charge, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [companyId, input.customer_id, number, ocr, input.invoice_date, dueDate,
      subtotal, vat, total, input.reference ?? null, input.notes ?? null, reverseCharge, userId],
  );
  const invoiceId = inv.rows[0]!.id;

  for (const [i, l] of resolved.entries()) {
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, company_id, line_no, article_id, description,
          quantity, unit, unit_price_ore, vat_rate, line_net_ore, revenue_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [invoiceId, companyId, i + 1, l.article_id, l.description, l.quantity, l.unit,
        l.unit_price_ore, l.vat_rate, l.line_net_ore, l.revenue_account],
    );
  }

  await writeAudit(client, {
    companyId, userId, action: 'invoice.created', entityType: 'invoice', entityId: invoiceId,
    details: { invoice_number: number, total_ore: total },
  });
  return getInvoice(client, companyId, invoiceId);
}

export async function getInvoice(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const head = await client.query(
    `SELECT i.id, i.invoice_number, i.ocr, i.invoice_date::text, i.due_date::text, i.status, i.currency,
            i.subtotal_ore, i.vat_ore, i.total_ore, i.paid_amount_ore, i.reference, i.notes,
            i.reverse_charge, i.pdf_file_id, i.voucher_id, i.customer_id, c.name AS customer_name
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.company_id = $2`,
    [id, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('invoice');
  const lines = await client.query(
    `SELECT line_no, article_id, description, quantity::text, unit, unit_price_ore,
            vat_rate, line_net_ore, revenue_account
     FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_no`,
    [id],
  );
  return { ...head.rows[0], lines: lines.rows };
}

export async function listInvoices(
  client: PoolClient, companyId: string, opts: { status?: string } = {},
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `SELECT i.id, i.invoice_number, i.invoice_date::text, i.due_date::text, i.status,
            i.total_ore, i.voucher_id, i.reverse_charge, c.name AS customer_name
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id = $1 AND ($2::text IS NULL OR i.status = $2)
     ORDER BY i.invoice_number DESC`,
    [companyId, opts.status ?? null],
  );
  return result.rows;
}

/** Bokför fakturan till huvudboken (automatkontering). Dubbelbokningsspärr via source. */
export async function bookInvoice(
  client: PoolClient, companyId: string, userId: string, id: string, fiscalYearId: string,
): Promise<Record<string, unknown>> {
  const invoice = await getInvoice(client, companyId, id);
  if (invoice.voucher_id) throw new ConflictError('already_booked', 'fakturan är redan bokförd');
  if (invoice.status === 'cancelled') throw new ConflictError('cancelled', 'en annullerad faktura kan inte bokföras');
  // Filtrera bort nollrader (t.ex. fri rad) — postCustomerInvoice kräver
  // positivt netto, annars kunde en enda 0-rad blockera hela bokföringen.
  const lines = (invoice.lines as { line_net_ore: number; vat_rate: number; revenue_account: number }[])
    .filter((l) => l.line_net_ore > 0);
  if (lines.length === 0) throw new BadRequestError('nothing_to_book', 'fakturan har inga bokningsbara rader');

  const voucher = await postCustomerInvoice(client, companyId, userId, {
    fiscalYearId,
    voucherDate: invoice.invoice_date as string,
    sourceId: id,
    description: `Kundfaktura ${invoice.invoice_number}`,
    lines: lines.map((l) => ({ netOre: l.line_net_ore, vatRate: l.vat_rate as VatRate, account: l.revenue_account })),
  });

  await client.query(
    "UPDATE invoices SET voucher_id = $1, status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END WHERE id = $2 AND company_id = $3",
    [voucher.id, id, companyId],
  );
  await writeAudit(client, {
    companyId, userId, action: 'invoice.booked', entityType: 'invoice', entityId: id,
    details: { voucher_id: voucher.id },
  });
  return getInvoice(client, companyId, id);
}

/**
 * Registrerar en (hel- eller del-) inbetalning på en bokförd kundfaktura:
 * automatkonterar betalningen (debet bank / kredit kundfordran) och räknar upp
 * fakturans paid_amount_ore. När hela beloppet kommit in sätts status 'paid'.
 * Default-belopp = återstående skuld. Flera betalningsverifikat per faktura
 * tillåts (source_type='payment' undantas dubbelbokningsspärren); överbetalning
 * spärras av att beloppet aldrig får överstiga återstoden. Automatkonteringen
 * för "betalning" som KICKOFF §4 Fas 1.4 kräver.
 */
export async function recordInvoicePayment(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: { invoiceId: string; fiscalYearId: string; paymentDate: string; amountOre?: Ore; bankAccount?: number },
): Promise<Record<string, unknown>> {
  // Lås fakturaraden FÖRST (FOR UPDATE) så samtidiga betalningar på samma faktura
  // serialiseras. Utan låset kunde två godkännanden båda läsa paid=0, båda passera
  // överbetalningskontrollen och båda kreditera 1510 → dubbelkreditering (0014 tog
  // bort den unika DB-spärren för betalningsverifikat, så app-låset är skyddet).
  const locked = await client.query<{ total_ore: string; paid_amount_ore: string; status: string; voucher_id: string | null; invoice_number: number }>(
    `SELECT total_ore, paid_amount_ore, status, voucher_id, invoice_number
     FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.invoiceId, companyId],
  );
  const row = locked.rows[0];
  if (!row) throw new NotFoundError('invoice');
  if (!row.voucher_id) throw new ConflictError('not_booked', 'fakturan måste vara bokförd innan en betalning kan registreras');
  if (row.status === 'paid') throw new ConflictError('already_paid', 'fakturan är redan fullt betald');
  if (row.status === 'cancelled') throw new ConflictError('cancelled', 'en annullerad faktura kan inte betalas');
  const total = Number(row.total_ore);
  const alreadyPaid = Number(row.paid_amount_ore);
  const outstanding = total - alreadyPaid;
  const amountOre = input.amountOre ?? outstanding;
  if (amountOre <= 0) throw new BadRequestError('invalid_amount', 'beloppet måste vara positivt');
  if (amountOre > outstanding) throw new BadRequestError('overpayment', `betalningen överstiger återstående skuld (${outstanding} ören)`);
  const voucher = await postCustomerPayment(client, companyId, userId, {
    fiscalYearId: input.fiscalYearId,
    voucherDate: input.paymentDate,
    sourceId: input.invoiceId,
    description: `Betalning faktura ${row.invoice_number}`,
    amountOre,
    bankAccount: input.bankAccount,
  });
  const newPaid = alreadyPaid + amountOre;
  const fullyPaid = newPaid >= total;
  await client.query(
    `UPDATE invoices SET paid_amount_ore = $1, status = CASE WHEN $2 THEN 'paid' ELSE status END
     WHERE id = $3 AND company_id = $4`,
    [newPaid, fullyPaid, input.invoiceId, companyId],
  );
  await writeAudit(client, {
    companyId, userId, action: 'invoice.payment_recorded', entityType: 'invoice', entityId: input.invoiceId,
    details: { voucher_id: voucher.id, amount_ore: amountOre, paid_amount_ore: newPaid, fully_paid: fullyPaid },
  });
  return getInvoice(client, companyId, input.invoiceId);
}

/**
 * Genererar faktura-PDF, lagrar i dokumentarkivet och kopplar den till fakturan.
 * Diskskrivningen sker UTANFÖR transaktionen (håller inte en poolklient under
 * disk-I/O) och den föräldralösa filen städas vid rollback — samma mönster som
 * fileStorage-uppladdningen i files.ts.
 */
export async function generateInvoicePdfFile(
  companyId: string, userId: string, id: string,
): Promise<{ fileId: string; buffer: Buffer }> {
  const buffer = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await client.query(
      `SELECT name, org_number, address, postal_code, city, email, phone, vat_number,
              bankgiro, plusgiro, bank_account, iban, approved_for_f_tax FROM companies WHERE id = $1`,
      [companyId],
    );
    const invoice = await getInvoice(client, companyId, id);
    const customer = await client.query(
      'SELECT name, address, postal_code, city, org_number, vat_number FROM customers WHERE id = $1 AND company_id = $2',
      [invoice.customer_id, companyId],
    );
    return generateInvoicePdf({
      company: company.rows[0] as never,
      customer: customer.rows[0] as never,
      invoice: {
        invoice_number: invoice.invoice_number as number,
        invoice_date: invoice.invoice_date as string,
        due_date: invoice.due_date as string,
        ocr: invoice.ocr as string | null,
        reference: invoice.reference as string | null,
        reverse_charge: invoice.reverse_charge as boolean,
      },
      lines: (invoice.lines as { description: string; quantity: string; unit: string; unit_price_ore: number; vat_rate: number; line_net_ore: number }[]).map((l) => ({
        description: l.description, quantity: l.quantity, unit: l.unit,
        unit_price_ore: l.unit_price_ore, vat_rate: l.vat_rate, line_net_ore: l.line_net_ore,
      })),
      totals: {
        subtotal_ore: invoice.subtotal_ore as number,
        vat_ore: invoice.vat_ore as number,
        total_ore: invoice.total_ore as number,
      },
    });
  });

  const validated = validateUpload(`faktura-${id}.pdf`, buffer);
  await writeStoredFile(companyId, validated.storedName, buffer);
  try {
    const fileId = await withTenantTransaction(userId, companyId, async (client) => {
      const file = await client.query<{ id: string }>(
        `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [companyId, 'faktura.pdf', validated.storedName, validated.mimeType, buffer.length, validated.sha256, userId],
      );
      const newFileId = file.rows[0]!.id;
      await client.query('UPDATE invoices SET pdf_file_id = $1 WHERE id = $2 AND company_id = $3', [newFileId, id, companyId]);
      await writeAudit(client, {
        companyId, userId, action: 'invoice.pdf_generated', entityType: 'invoice', entityId: id,
        details: { file_id: newFileId },
      });
      return newFileId;
    });
    return { fileId, buffer };
  } catch (err) {
    await removeStoredFile(companyId, validated.storedName);
    throw err;
  }
}
