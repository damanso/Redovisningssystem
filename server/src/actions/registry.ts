import type { PoolClient } from 'pg';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AccountNumberSchema, IsoDateSchema, OreSchema, safeText, UuidSchema, VatRateSchema } from '../lib/validation.js';
import { createCustomer, createSupplier, listCustomers, listSuppliers } from '../services/parties.js';
import { createInvoice, bookInvoice, getInvoice, listInvoices } from '../services/invoices.js';
import { bookReceipt, createReceipt, listReceipts } from '../services/receipts.js';
import { postVoucher, reverseVoucher } from '../services/accounting/vouchers.js';
import { setFiscalYearLock } from '../services/accounting/fiscalYears.js';
import { vatReport } from '../services/accounting/vatReport.js';

export interface ActionContext {
  client: PoolClient;
  companyId: string;
  // userId = den som faktiskt AUKTORISERAR körningen (begäraren för icke-känsliga,
  // godkännaren för känsliga). Auditloggen kopplas till denna.
  userId: string;
}

// read      = ingen mutation. write = skapar utkast/register (ej pengaflyttande).
// sensitive = pengaflyttande (bokför) eller periodlåsande → kräver mänskligt
//             godkännande innan körning.
export type Sensitivity = 'read' | 'write' | 'sensitive';

export interface ActionDef<I = unknown> {
  name: string;
  title: string;
  sensitivity: Sensitivity;
  inputSchema: z.ZodType<I>;
  handler: (ctx: ActionContext, input: I) => Promise<unknown>;
}

function def<I>(d: ActionDef<I>): ActionDef<I> {
  return d;
}

const VAT = VatRateSchema;
const ORE = OreSchema;
const ACCOUNT = AccountNumberSchema;

const InvoiceLine = z
  .object({
    article_id: UuidSchema.optional(),
    description: safeText(300).optional(),
    quantity: z.number().positive().max(1_000_000),
    unit: safeText(20).optional(),
    unit_price_ore: ORE.optional(),
    vat_rate: VAT.optional(),
    revenue_account: ACCOUNT.optional(),
  })
  .strict();

const VoucherLine = z
  .object({
    account_number: ACCOUNT,
    debit_ore: ORE.optional(),
    credit_ore: ORE.optional(),
    description: safeText(200).optional(),
  })
  .strict();

// Registret. Varje action är en väldefinierad, schemavaliderad ingång mot
// KÄRNANS tjänster — samma serverpåtvingade regler (RLS, tenant, oföränderlighet)
// som via HTTP-API:t. En AI-agent kan bara det som står här.
export const ACTIONS: readonly ActionDef<never>[] = [
  def({
    name: 'list_customers',
    title: 'Lista kunder',
    sensitivity: 'read',
    inputSchema: z.object({ include_inactive: z.boolean().optional() }).strict(),
    handler: (ctx, i: { include_inactive?: boolean }) =>
      listCustomers(ctx.client, ctx.companyId, { includeInactive: i.include_inactive }),
  }),
  def({
    name: 'list_suppliers',
    title: 'Lista leverantörer',
    sensitivity: 'read',
    inputSchema: z.object({ include_inactive: z.boolean().optional() }).strict(),
    handler: (ctx, i: { include_inactive?: boolean }) =>
      listSuppliers(ctx.client, ctx.companyId, { includeInactive: i.include_inactive }),
  }),
  def({
    name: 'list_invoices',
    title: 'Lista fakturor',
    sensitivity: 'read',
    inputSchema: z.object({ status: safeText(20).optional() }).strict(),
    handler: (ctx, i: { status?: string }) => listInvoices(ctx.client, ctx.companyId, { status: i.status }),
  }),
  def({
    name: 'list_receipts',
    title: 'Lista kvitton',
    sensitivity: 'read',
    inputSchema: z.object({ status: safeText(20).optional() }).strict(),
    handler: (ctx, i: { status?: string }) => listReceipts(ctx.client, ctx.companyId, { status: i.status }),
  }),
  def({
    name: 'get_invoice',
    title: 'Hämta faktura',
    sensitivity: 'read',
    inputSchema: z.object({ invoice_id: UuidSchema }).strict(),
    handler: (ctx, i: { invoice_id: string }) => getInvoice(ctx.client, ctx.companyId, i.invoice_id),
  }),
  def({
    name: 'vat_report',
    title: 'Momsrapport',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict(),
    handler: (ctx, i: { from: string; to: string }) => vatReport(ctx.client, ctx.companyId, i.from, i.to),
  }),

  def({
    name: 'create_customer',
    title: 'Skapa kund',
    sensitivity: 'write',
    inputSchema: z
      .object({
        name: safeText(200),
        org_number: safeText(20).optional(),
        email: safeText(254).optional(),
        phone: safeText(50).optional(),
        payment_terms: z.number().int().min(0).max(365).optional(),
      })
      .strict(),
    handler: (ctx, i) => createCustomer(ctx.client, ctx.companyId, ctx.userId, i as Record<string, unknown>),
  }),
  def({
    name: 'create_supplier',
    title: 'Skapa leverantör',
    sensitivity: 'write',
    inputSchema: z
      .object({
        name: safeText(200),
        org_number: safeText(20).optional(),
        bankgiro: safeText(20).optional(),
      })
      .strict(),
    handler: (ctx, i) => createSupplier(ctx.client, ctx.companyId, ctx.userId, i as Record<string, unknown>),
  }),
  def({
    name: 'create_invoice',
    title: 'Skapa fakturautkast',
    sensitivity: 'write',
    inputSchema: z
      .object({
        customer_id: UuidSchema,
        invoice_date: IsoDateSchema,
        due_date: IsoDateSchema.optional(),
        reference: safeText(200).optional(),
        lines: z.array(InvoiceLine).min(1),
      })
      .strict(),
    handler: (ctx, i) => createInvoice(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'create_receipt',
    title: 'Skapa kvittoutkast',
    sensitivity: 'write',
    inputSchema: z
      .object({
        supplier_id: UuidSchema.optional(),
        receipt_date: IsoDateSchema,
        description: safeText(300),
        net_ore: z.number().int().positive().safe(),
        vat_rate: VAT,
        expense_account: ACCOUNT,
        payment_account: ACCOUNT.optional(),
      })
      .strict(),
    handler: (ctx, i) => createReceipt(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),

  def({
    name: 'book_invoice',
    title: 'Bokför faktura',
    sensitivity: 'sensitive',
    inputSchema: z.object({ invoice_id: UuidSchema, fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { invoice_id: string; fiscal_year_id: string }) =>
      bookInvoice(ctx.client, ctx.companyId, ctx.userId, i.invoice_id, i.fiscal_year_id),
  }),
  def({
    name: 'book_receipt',
    title: 'Bokför kvitto',
    sensitivity: 'sensitive',
    inputSchema: z.object({ receipt_id: UuidSchema, fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { receipt_id: string; fiscal_year_id: string }) =>
      bookReceipt(ctx.client, ctx.companyId, ctx.userId, i.receipt_id, i.fiscal_year_id),
  }),
  def({
    name: 'post_voucher',
    title: 'Bokför verifikat',
    sensitivity: 'sensitive',
    inputSchema: z
      .object({
        fiscal_year_id: UuidSchema,
        voucher_date: IsoDateSchema,
        description: safeText(200),
        lines: z.array(VoucherLine).min(2),
      })
      .strict(),
    handler: (ctx, i: { fiscal_year_id: string; voucher_date: string; description: string; lines: unknown[] }) =>
      postVoucher(ctx.client, ctx.companyId, ctx.userId, {
        fiscalYearId: i.fiscal_year_id,
        voucherDate: i.voucher_date,
        description: i.description,
        lines: i.lines as never,
      }),
  }),
  def({
    name: 'reverse_voucher',
    title: 'Rätta verifikat',
    sensitivity: 'sensitive',
    inputSchema: z.object({ voucher_id: UuidSchema }).strict(),
    handler: (ctx, i: { voucher_id: string }) =>
      reverseVoucher(ctx.client, ctx.companyId, ctx.userId, i.voucher_id),
  }),
  def({
    name: 'lock_period',
    title: 'Lås/lås upp räkenskapsår',
    sensitivity: 'sensitive',
    inputSchema: z.object({ fiscal_year_id: UuidSchema, locked: z.boolean() }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; locked: boolean }) =>
      setFiscalYearLock(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id, i.locked),
  }),
] as unknown as readonly ActionDef<never>[];

const BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));

export function getAction(name: string): ActionDef<never> | undefined {
  return BY_NAME.get(name);
}

export interface ActionManifestEntry {
  name: string;
  title: string;
  sensitivity: Sensitivity;
  requires_approval: boolean;
  input_schema: Record<string, unknown>;
}

/**
 * Manifest (MCP tools/list): namn, titel, känslighet och ett JSON-schema för
 * indata. JSON-schemat gör att en MCP-server kan exponera varje action som ett
 * native, typat verktyg mot Cowork/claude.ai utan att känna till zod.
 */
export function actionManifest(): ActionManifestEntry[] {
  return ACTIONS.map((a) => ({
    name: a.name,
    title: a.title,
    sensitivity: a.sensitivity,
    requires_approval: a.sensitivity === 'sensitive',
    input_schema: zodToJsonSchema(a.inputSchema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>,
  }));
}
