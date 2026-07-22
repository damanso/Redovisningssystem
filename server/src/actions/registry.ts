import type { PoolClient } from 'pg';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AccountNumberSchema, EmailSchema, IsoDateSchema, OreSchema, safeText, UuidSchema, VatRateSchema } from '../lib/validation.js';
import { addContact, addNote, setTags } from '../services/crm.js';
const PartyTypeSchema = z.enum(['customer', 'supplier']);
import { createCustomer, createSupplier, listCustomers, listSuppliers } from '../services/parties.js';
import { createInvoice, bookInvoice, getInvoice, listInvoices, recordInvoicePayment } from '../services/invoices.js';
import { bookReceipt, createReceipt, listReceipts } from '../services/receipts.js';
import { getVoucher, listVouchers, postVoucher, reverseVoucher } from '../services/accounting/vouchers.js';
import { listFiscalYears, setFiscalYearLock } from '../services/accounting/fiscalYears.js';
import { vatReport } from '../services/accounting/vatReport.js';
import { accountsPayableAging, accountsReceivableAging, cashFlow, liquidityForecast, monthlyRevenue } from '../services/reports.js';
import { bookSupplierInvoice, createSupplierInvoice, listSupplierInvoices, recordSupplierPayment } from '../services/supplierInvoices.js';
import { createRecurringInvoice, listRecurringInvoices, runDueRecurringInvoices, setRecurringActive } from '../services/recurringInvoices.js';
import { createProject, createTimeEntry, getProject, listProjects, setProjectStatus } from '../services/projects.js';
import { expenseBreakdown, keyRatios, topCustomers } from '../services/analytics.js';
import { listMembers } from '../services/team.js';
import { listNotifications } from '../services/notifications.js';
import { importSie, parseSie } from '../services/sieImport.js';
import { importBankCsv, listBankTransactions, setBankTransactionReconciled } from '../services/bankImport.js';
import { bookPayrollTax, bookPayslip, createEmployee, createPayslip, listEmployees, listPayslips, payrollYearSummary, recalculateDraftPayslips, setEmployeeActive } from '../services/payroll.js';
import { k2AnnualReport, k2ManagementReport } from '../services/k2.js';
import { runTaxReminders, setOpeningTaxLoss, setVatPeriod, taxOverview } from '../services/taxes.js';
import { taxPlanning } from '../services/taxPlanning.js';
import { bookDepreciation, createFixedAsset, getFixedAsset, listFixedAssets } from '../services/fixedAssets.js';
import { bookCorporateTax, bookPeriodiseringsfond, bookYearResult } from '../services/bokslut.js';
import { addTaxAdjustment, deleteTaxAdjustment, ink2rReport, ink2sReport, listTaxAdjustments } from '../services/ink2.js';
import { vatDeclaration } from '../services/vatDeclaration.js';
import { generateInk2Sru } from '../services/sruExport.js';
import { generateK2Ixbrl } from '../services/ixbrlExport.js';
import { agiDeclaration, generateAgiXml } from '../services/agi.js';
import { k10Computation, generateK10Sru } from '../services/k10.js';
import { k10Prefill, listK10Computations, saveK10Computation, setK10OpeningAllowance } from '../services/k10Store.js';
import { ecSalesList, generateEcSalesFile } from '../services/ecSalesList.js';
import { ku10Report, generateKu10Xml } from '../services/ku10.js';
import { anonymizeParty } from '../services/gdpr.js';
import { attachDocument, getDocument, listDocuments, type DocumentEntityType } from '../services/documents.js';
import { setCompanyLogo, updateCompanySettings } from '../services/companyLogo.js';
import { generateAndAttachPayslipPdf } from '../services/payslipPdf.js';
import { deleteDraftInvoice, deleteDraftPayslip, deleteDraftReceipt, deleteDraftSupplierInvoice } from '../services/draftDelete.js';
import { linkVoucher, unlinkVoucher, suggestVoucherLinks, type LinkableEntityType } from '../services/voucherLinks.js';
import { writeAudit } from '../services/auditService.js';

const LinkableEntityTypeSchema = z.enum(['invoice', 'receipt', 'supplier_invoice', 'payslip']);

const DocumentEntityTypeSchema = z.enum(['payslip', 'invoice', 'receipt', 'supplier_invoice', 'voucher']);

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
    name: 'list_fiscal_years',
    title: 'Lista räkenskapsår',
    sensitivity: 'read',
    inputSchema: z.object({}).strict(),
    handler: (ctx) => listFiscalYears(ctx.client, ctx.companyId),
  }),
  def({
    name: 'list_vouchers',
    title: 'Lista verifikat',
    sensitivity: 'read',
    inputSchema: z.object({
      fiscal_year_id: UuidSchema.optional(), from: IsoDateSchema.optional(), to: IsoDateSchema.optional(),
      source_type: safeText(40).optional(), limit: z.number().int().min(1).max(1000).optional(),
    }).strict(),
    handler: (ctx, i: { fiscal_year_id?: string; from?: string; to?: string; source_type?: string; limit?: number }) =>
      listVouchers(ctx.client, ctx.companyId, { fiscalYearId: i.fiscal_year_id, from: i.from, to: i.to, sourceType: i.source_type, limit: i.limit }),
  }),
  def({
    name: 'link_voucher',
    title: 'Koppla registerpost till befintligt verifikat (baklänkning)',
    sensitivity: 'write',
    // K6: bokför INGENTING nytt — kopplar en importerad/okopplad post till sitt
    // redan bokförda verifikat så reskontran visar rätt bokförd/betald-status.
    inputSchema: z.object({
      entity_type: LinkableEntityTypeSchema,
      entity_id: UuidSchema,
      voucher_id: UuidSchema,
      mark_paid: z.boolean().optional(),
    }).strict(),
    handler: (ctx, i: { entity_type: LinkableEntityType; entity_id: string; voucher_id: string; mark_paid?: boolean }) =>
      linkVoucher(ctx.client, ctx.companyId, ctx.userId, { entityType: i.entity_type, entityId: i.entity_id, voucherId: i.voucher_id, markPaid: i.mark_paid }),
  }),
  def({
    name: 'unlink_voucher',
    title: 'Ta bort baklänkning (motsatsen till link_voucher)',
    sensitivity: 'write',
    // K6: ångrar ENBART kopplingar gjorda via link_voucher (verifieras mot
    // auditloggen). Bokför/raderar inget — posten återgår till utkastläge.
    inputSchema: z.object({
      entity_type: LinkableEntityTypeSchema,
      entity_id: UuidSchema,
    }).strict(),
    handler: (ctx, i: { entity_type: LinkableEntityType; entity_id: string }) =>
      unlinkVoucher(ctx.client, ctx.companyId, ctx.userId, { entityType: i.entity_type, entityId: i.entity_id }),
  }),
  def({
    name: 'suggest_voucher_links',
    title: 'Föreslå verifikatkopplingar för okopplade registerposter',
    sensitivity: 'read',
    inputSchema: z.object({
      entity_type: LinkableEntityTypeSchema.optional(),
      from: IsoDateSchema.optional(),
      to: IsoDateSchema.optional(),
    }).strict(),
    handler: (ctx, i: { entity_type?: LinkableEntityType; from?: string; to?: string }) =>
      suggestVoucherLinks(ctx.client, ctx.companyId, { entityType: i.entity_type, from: i.from, to: i.to }),
  }),
  def({
    name: 'set_vat_method',
    title: 'Ställ in momsmetod (faktura-/kontantmetod)',
    sensitivity: 'write',
    inputSchema: z.object({ vat_method: z.enum(['invoice', 'cash']) }).strict(),
    handler: async (ctx, i: { vat_method: 'invoice' | 'cash' }) => {
      await ctx.client.query('UPDATE companies SET vat_method = $2 WHERE id = $1', [ctx.companyId, i.vat_method]);
      await writeAudit(ctx.client, { companyId: ctx.companyId, userId: ctx.userId, action: 'tax.vat_method_set', entityType: 'company', entityId: ctx.companyId, details: { vat_method: i.vat_method } });
      return { vat_method: i.vat_method };
    },
  }),
  def({
    name: 'delete_draft_invoice',
    title: 'Radera fakturautkast (obokat)',
    sensitivity: 'write',
    // K7: oföränderligheten gäller BOKFÖRDA verifikat — ett utkast som aldrig
    // nått huvudboken får raderas (t.ex. registrerat på fel kund). Bokförda
    // poster avvisas (409) och rättas via rättelseverifikat. Auditloggas med
    // snapshot av raden.
    inputSchema: z.object({ invoice_id: UuidSchema }).strict(),
    handler: (ctx, i: { invoice_id: string }) => deleteDraftInvoice(ctx.client, ctx.companyId, ctx.userId, i.invoice_id),
  }),
  def({
    name: 'delete_draft_receipt',
    title: 'Radera kvittoutkast (obokat)',
    sensitivity: 'write',
    inputSchema: z.object({ receipt_id: UuidSchema }).strict(),
    handler: (ctx, i: { receipt_id: string }) => deleteDraftReceipt(ctx.client, ctx.companyId, ctx.userId, i.receipt_id),
  }),
  def({
    name: 'delete_draft_supplier_invoice',
    title: 'Radera leverantörsfakturautkast (obokat)',
    sensitivity: 'write',
    inputSchema: z.object({ supplier_invoice_id: UuidSchema }).strict(),
    handler: (ctx, i: { supplier_invoice_id: string }) => deleteDraftSupplierInvoice(ctx.client, ctx.companyId, ctx.userId, i.supplier_invoice_id),
  }),
  def({
    name: 'delete_draft_payslip',
    title: 'Radera lönebeskedsutkast (obokat)',
    sensitivity: 'write',
    inputSchema: z.object({ payslip_id: UuidSchema }).strict(),
    handler: (ctx, i: { payslip_id: string }) => deleteDraftPayslip(ctx.client, ctx.companyId, ctx.userId, i.payslip_id),
  }),
  def({
    name: 'update_company_settings',
    title: 'Uppdatera bolagsuppgifter (adress, kontakt, betalinfo)',
    sensitivity: 'write',
    // Fälten som faktura-PDF:en använder. Kolumnnamn via allowlist i
    // services/companyLogo.ts — aldrig från indata. Namn/org.nr ingår inte.
    inputSchema: z.object({
      address: safeText(200).optional(), postal_code: safeText(20).optional(), city: safeText(100).optional(),
      email: safeText(200).optional(), phone: safeText(50).optional(), vat_number: safeText(30).optional(),
      bankgiro: safeText(20).optional(), plusgiro: safeText(20).optional(), bank_account: safeText(50).optional(),
      iban: safeText(50).optional(), bic: safeText(20).optional(), website: safeText(200).optional(),
    }).strict(),
    handler: (ctx, i) => updateCompanySettings(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'set_company_logo',
    title: 'Sätt bolagets logotyp (visas på faktura-PDF:en)',
    sensitivity: 'write',
    // Bild (png/jpg) som base64 — samma validering som all uppladdning.
    // Komposit-FK:n i 0045 garanterar att logotypen alltid är bolagets egen fil.
    inputSchema: z.object({
      filename: safeText(200),
      content_base64: z.string().min(1).max(15_000_000),
    }).strict(),
    handler: (ctx, i: { filename: string; content_base64: string }) =>
      setCompanyLogo(ctx.client, ctx.companyId, ctx.userId, { filename: i.filename, contentBase64: i.content_base64 }),
  }),
  def({
    name: 'attach_document',
    title: 'Bilägg dokument till en registerpost',
    sensitivity: 'write',
    // Filinnehåll som base64 (pdf/png/jpg, max 10 MB) — valideras mot ändelse
    // OCH magic bytes, lagras med UUID-namn utanför webroten (fileStorage).
    inputSchema: z.object({
      entity_type: DocumentEntityTypeSchema,
      entity_id: UuidSchema,
      filename: safeText(200),
      content_base64: z.string().min(1).max(15_000_000),
      title: safeText(200).optional(),
    }).strict(),
    handler: (ctx, i: { entity_type: DocumentEntityType; entity_id: string; filename: string; content_base64: string; title?: string }) =>
      attachDocument(ctx.client, ctx.companyId, ctx.userId, {
        entityType: i.entity_type, entityId: i.entity_id, filename: i.filename,
        contentBase64: i.content_base64, title: i.title,
      }),
  }),
  def({
    name: 'list_documents',
    title: 'Lista bilagda dokument',
    sensitivity: 'read',
    inputSchema: z.object({ entity_type: DocumentEntityTypeSchema.optional(), entity_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { entity_type?: DocumentEntityType; entity_id?: string }) =>
      listDocuments(ctx.client, ctx.companyId, { entityType: i.entity_type, entityId: i.entity_id }),
  }),
  def({
    name: 'get_document',
    title: 'Hämta bilagt dokument (metadata + ev. innehåll)',
    sensitivity: 'read',
    inputSchema: z.object({ document_id: UuidSchema, include_content: z.boolean().optional() }).strict(),
    handler: (ctx, i: { document_id: string; include_content?: boolean }) =>
      getDocument(ctx.client, ctx.companyId, i.document_id, { includeContent: i.include_content }),
  }),
  def({
    name: 'generate_payslip_pdf',
    title: 'Generera lönespecifikation (PDF) och bilägg på lönebeskedet',
    sensitivity: 'write',
    inputSchema: z.object({ payslip_id: UuidSchema }).strict(),
    handler: (ctx, i: { payslip_id: string }) =>
      generateAndAttachPayslipPdf(ctx.client, ctx.companyId, ctx.userId, i.payslip_id, new Date().toISOString().slice(0, 10)),
  }),
  def({
    name: 'get_voucher',
    title: 'Hämta verifikat med rader',
    sensitivity: 'read',
    inputSchema: z.object({ voucher_id: UuidSchema }).strict(),
    handler: (ctx, i: { voucher_id: string }) => getVoucher(ctx.client, ctx.companyId, i.voucher_id),
  }),
  def({
    name: 'vat_report',
    title: 'Momsrapport',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict(),
    handler: (ctx, i: { from: string; to: string }) => vatReport(ctx.client, ctx.companyId, i.from, i.to),
  }),
  def({
    name: 'accounts_receivable_aging',
    title: 'Kundreskontra (åldersanalys)',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => accountsReceivableAging(ctx.client, ctx.companyId, i.as_of),
  }),
  def({
    name: 'monthly_revenue',
    title: 'Intäkter och kostnader per månad (12 mån)',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => monthlyRevenue(ctx.client, ctx.companyId, i.as_of),
  }),
  def({
    name: 'list_notifications',
    title: 'Lista dina notiser',
    sensitivity: 'read',
    inputSchema: z.object({ unread_only: z.boolean().optional() }).strict(),
    handler: (ctx, i: { unread_only?: boolean }) => listNotifications(ctx.client, ctx.userId, { unreadOnly: i.unread_only }),
  }),
  def({
    name: 'list_team_members',
    title: 'Lista teammedlemmar och roller',
    sensitivity: 'read',
    inputSchema: z.object({}).strict(),
    handler: (ctx) => listMembers(ctx.client, ctx.companyId, ctx.userId),
  }),
  def({
    name: 'list_fixed_assets',
    title: 'Lista anläggningstillgångar',
    sensitivity: 'read',
    inputSchema: z.object({ status: z.enum(['active', 'disposed']).optional() }).strict(),
    handler: (ctx, i: { status?: 'active' | 'disposed' }) => listFixedAssets(ctx.client, ctx.companyId, { status: i.status }),
  }),
  def({
    name: 'get_fixed_asset',
    title: 'Hämta anläggningstillgång',
    sensitivity: 'read',
    inputSchema: z.object({ fixed_asset_id: UuidSchema }).strict(),
    handler: (ctx, i: { fixed_asset_id: string }) => getFixedAsset(ctx.client, ctx.companyId, i.fixed_asset_id),
  }),
  def({
    name: 'create_fixed_asset',
    title: 'Lägg till anläggningstillgång',
    sensitivity: 'write',
    inputSchema: z.object({
      name: safeText(200), acquisition_date: IsoDateSchema, acquisition_cost_ore: OreSchema,
      useful_life_months: z.number().int().min(1).max(1200), residual_value_ore: OreSchema.optional(),
      asset_account: AccountNumberSchema.optional(), accumulated_depr_account: AccountNumberSchema.optional(),
      depreciation_expense_account: AccountNumberSchema.optional(), notes: safeText(500).optional(),
    }).strict(),
    handler: (ctx, i) => createFixedAsset(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'book_depreciation',
    title: 'Bokför planenlig avskrivning',
    sensitivity: 'sensitive',
    inputSchema: z.object({ fixed_asset_id: UuidSchema, through_date: IsoDateSchema, fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fixed_asset_id: string; through_date: string; fiscal_year_id: string }) =>
      bookDepreciation(ctx.client, ctx.companyId, ctx.userId, i.fixed_asset_id, i.through_date, i.fiscal_year_id),
  }),
  def({
    name: 'book_periodiseringsfond',
    title: 'Bokför avsättning/återföring av periodiseringsfond',
    sensitivity: 'sensitive',
    inputSchema: z.object({ fiscal_year_id: UuidSchema, type: z.enum(['avsattning', 'aterforing']), amount_ore: OreSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; type: 'avsattning' | 'aterforing'; amount_ore: number }) =>
      bookPeriodiseringsfond(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id, i.type, i.amount_ore),
  }),
  def({
    name: 'book_corporate_tax',
    title: 'Bokför årets skatt',
    sensitivity: 'sensitive',
    inputSchema: z.object({ fiscal_year_id: UuidSchema, amount_ore: OreSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; amount_ore: number }) =>
      bookCorporateTax(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id, i.amount_ore),
  }),
  def({
    name: 'book_year_result',
    title: 'Överför årets resultat till eget kapital',
    sensitivity: 'sensitive',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => bookYearResult(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id),
  }),
  def({
    name: 'tax_overview',
    title: 'Skatteöversikt (skuld + vägledande deadlines)',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => taxOverview(ctx.client, ctx.companyId, i.as_of),
  }),
  def({
    name: 'tax_planning',
    title: 'Skattestöd (underskott, periodiseringsfond, optimerad skatt)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => taxPlanning(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'set_opening_tax_loss',
    title: 'Ange ingående skattemässigt underskott',
    sensitivity: 'write',
    inputSchema: z.object({ opening_tax_loss_ore: OreSchema }).strict(),
    handler: async (ctx, i: { opening_tax_loss_ore: number }) => {
      await setOpeningTaxLoss(ctx.client, ctx.companyId, ctx.userId, i.opening_tax_loss_ore);
      return { opening_tax_loss_ore: i.opening_tax_loss_ore };
    },
  }),
  def({
    name: 'run_tax_reminders',
    title: 'Skapa skattepåminnelser för kommande deadlines',
    sensitivity: 'write',
    inputSchema: z.object({ as_of: IsoDateSchema.optional(), lead_days: z.number().int().min(1).max(90).optional() }).strict(),
    handler: (ctx, i: { as_of?: string; lead_days?: number }) =>
      runTaxReminders(ctx.client, ctx.companyId, ctx.userId, { asOf: i.as_of, leadDays: i.lead_days }),
  }),
  def({
    name: 'set_vat_period',
    title: 'Ställ in momsredovisningsperiod',
    sensitivity: 'write',
    inputSchema: z.object({ vat_period: z.enum(['monthly', 'quarterly', 'yearly']) }).strict(),
    handler: async (ctx, i: { vat_period: 'monthly' | 'quarterly' | 'yearly' }) => {
      await setVatPeriod(ctx.client, ctx.companyId, ctx.userId, i.vat_period);
      return { vat_period: i.vat_period };
    },
  }),
  def({
    name: 'k2_annual_report',
    title: 'K2-årsredovisning (resultat + balans + noter)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => k2AnnualReport(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'k2_management_report',
    title: 'Förvaltningsberättelse (flerårsöversikt, EK, resultatdisposition)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => k2ManagementReport(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'vat_declaration',
    title: 'Momsdeklaration (alla rutor 05–49)',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict(),
    handler: (ctx, i: { from: string; to: string }) => vatDeclaration(ctx.client, ctx.companyId, i.from, i.to),
  }),
  def({
    name: 'ink2r_schema',
    title: 'INK2R räkenskapsschema (resultat + balans i deklarationsfält)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => ink2rReport(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'agi_declaration',
    title: 'Arbetsgivardeklaration på individnivå (AGI) för en period',
    sensitivity: 'read',
    inputSchema: z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period anges som 'YYYY-MM'") }).strict(),
    handler: (ctx, i: { period: string }) => agiDeclaration(ctx.client, ctx.companyId, i.period),
  }),
  def({
    name: 'anonymize_party',
    title: 'GDPR: anonymisera personuppgifter på en part (kund/leverantör)',
    sensitivity: 'sensitive',
    inputSchema: z.object({ party_type: PartyTypeSchema, party_id: UuidSchema }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string }) =>
      anonymizeParty(ctx.client, ctx.companyId, ctx.userId, i.party_type, i.party_id),
  }),
  def({
    name: 'ku10_report',
    title: 'KU10 kontrolluppgifter (tjänsteinkomst per anställd, inkomstår)',
    sensitivity: 'read',
    inputSchema: z.object({ income_year: z.number().int().min(2000).max(2100) }).strict(),
    handler: (ctx, i: { income_year: number }) => ku10Report(ctx.client, ctx.companyId, i.income_year),
  }),
  def({
    name: 'generate_ku10_file',
    title: 'Generera KU10-fil (XML) för Skatteverket',
    sensitivity: 'read',
    inputSchema: z.object({ income_year: z.number().int().min(2000).max(2100), social_avgiftsavtal: z.boolean().optional() }).strict(),
    handler: (ctx, i: { income_year: number; social_avgiftsavtal?: boolean }) => {
      const now = new Date();
      return generateKu10Xml(ctx.client, ctx.companyId, i.income_year, { createdIso: now.toISOString().slice(0, 19), socialAvgiftsavtal: i.social_avgiftsavtal });
    },
  }),
  def({
    name: 'ec_sales_list',
    title: 'Periodisk sammanställning (EU-försäljning per köpare)',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict(),
    handler: (ctx, i: { from: string; to: string }) => ecSalesList(ctx.client, ctx.companyId, i.from, i.to),
  }),
  def({
    name: 'generate_ec_sales_file',
    title: 'Generera periodisk sammanställning som fil (SKV574008)',
    sensitivity: 'read',
    inputSchema: z.object({
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/, "period 'YYYY-MM' eller 'YYYY-Qn'"),
      contact_name: safeText(35),
      contact_phone: safeText(17),
      contact_email: safeText(254).optional(),
    }).strict(),
    handler: (ctx, i: { period: string; contact_name: string; contact_phone: string; contact_email?: string }) =>
      generateEcSalesFile(ctx.client, ctx.companyId, i.period, { name: i.contact_name, phone: i.contact_phone, email: i.contact_email }),
  }),
  def({
    name: 'k10_computation',
    title: 'K10 — gränsbelopp (3:12) för delägare i fåmansföretag',
    sensitivity: 'read',
    // Tillägg 2: rule krävs för inkomstår ≤ 2025; för 2026+ gäller nya
    // grundbeloppsmodellen (rule ignoreras). spouse_salary_ore = makes/makas
    // kontanta lön (ingår i 50×-taket, makar beräknar gemensamt).
    inputSchema: z.object({
      fiscal_year_id: UuidSchema,
      ownership_permille: z.number().int().min(1).max(1000),
      omkostnadsbelopp_ore: OreSchema,
      saved_allowance_ore: OreSchema,
      owner_salary_ore: OreSchema,
      dividend_ore: OreSchema,
      rule: z.enum(['forenkling', 'huvudregel']).optional(),
      spouse_salary_ore: OreSchema.optional(),
    }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; ownership_permille: number; omkostnadsbelopp_ore: number; saved_allowance_ore: number; owner_salary_ore: number; dividend_ore: number; rule?: 'forenkling' | 'huvudregel'; spouse_salary_ore?: number }) =>
      k10Computation(ctx.client, ctx.companyId, i.fiscal_year_id, i),
  }),
  def({
    name: 'save_k10_computation',
    title: 'Spara K10-beräkning för inkomståret (autofyller nästa års sparade utrymme)',
    sensitivity: 'write',
    inputSchema: z.object({
      fiscal_year_id: UuidSchema,
      ownership_permille: z.number().int().min(1).max(1000),
      omkostnadsbelopp_ore: OreSchema,
      saved_allowance_ore: OreSchema,
      owner_salary_ore: OreSchema,
      dividend_ore: OreSchema,
      rule: z.enum(['forenkling', 'huvudregel']).optional(),
      spouse_salary_ore: OreSchema.optional(),
    }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; ownership_permille: number; omkostnadsbelopp_ore: number; saved_allowance_ore: number; owner_salary_ore: number; dividend_ore: number; rule?: 'forenkling' | 'huvudregel'; spouse_salary_ore?: number }) =>
      saveK10Computation(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id, i),
  }),
  def({
    name: 'set_k10_opening_allowance',
    title: 'Mata in historiskt sparat utdelningsutrymme (engångsmigrering, per 2025-12-31)',
    sensitivity: 'write',
    inputSchema: z.object({
      income_year: z.number().int().min(2000).max(2100).optional(),
      saved_to_next_year_ore: OreSchema,
    }).strict(),
    handler: (ctx, i: { income_year?: number; saved_to_next_year_ore: number }) =>
      setK10OpeningAllowance(ctx.client, ctx.companyId, ctx.userId, i),
  }),
  def({
    name: 'list_k10_computations',
    title: 'Lista sparade K10-beräkningar',
    sensitivity: 'read',
    inputSchema: z.object({}).strict(),
    handler: (ctx) => listK10Computations(ctx.client, ctx.companyId),
  }),
  def({
    name: 'k10_prefill',
    title: 'Autofyll K10-fälten ur systemdata (redigerbara förslag med källa)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => k10Prefill(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'generate_k10_sru',
    title: 'Generera K10 SRU-blankett (förenklingsregeln)',
    sensitivity: 'read',
    inputSchema: z.object({
      fiscal_year_id: UuidSchema,
      ownership_permille: z.number().int().min(1).max(1000),
      omkostnadsbelopp_ore: OreSchema,
      saved_allowance_ore: OreSchema,
      owner_salary_ore: OreSchema,
      dividend_ore: OreSchema,
      rule: z.enum(['forenkling', 'huvudregel']),
      owner_name: safeText(100),
      owner_personnummer: z.string().regex(/^\d{6,8}-?\d{4}$/, 'personnummer NNNNNN-NNNN eller NNNNNNNN-NNNN'),
    }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; ownership_permille: number; omkostnadsbelopp_ore: number; saved_allowance_ore: number; owner_salary_ore: number; dividend_ore: number; rule: 'forenkling' | 'huvudregel'; owner_name: string; owner_personnummer: string }) => {
      const now = new Date();
      return generateK10Sru(ctx.client, ctx.companyId, i.fiscal_year_id, i, now.toISOString().slice(0, 10), now.toISOString().slice(11, 19));
    },
  }),
  def({
    name: 'generate_agi_file',
    title: 'Generera AGI-fil (XML) för Skatteverket',
    sensitivity: 'read',
    inputSchema: z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period anges som 'YYYY-MM'") }).strict(),
    handler: (ctx, i: { period: string }) => {
      const now = new Date();
      return generateAgiXml(ctx.client, ctx.companyId, i.period, { createdIso: now.toISOString().slice(0, 19) });
    },
  }),
  def({
    name: 'generate_k2_ixbrl',
    title: 'Generera iXBRL-årsredovisning (K2) för Bolagsverket',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => generateK2Ixbrl(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'generate_ink2_sru',
    title: 'Generera SRU-filer för INK2 (INFO.SRU + BLANKETTER.SRU)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => {
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toISOString().slice(11, 19);
      return generateInk2Sru(ctx.client, ctx.companyId, i.fiscal_year_id, date, time);
    },
  }),
  def({
    name: 'ink2s_adjustments',
    title: 'INK2S skattemässiga justeringar (bokfört → beskattningsbart)',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => ink2sReport(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'list_tax_adjustments',
    title: 'Lista manuella skattemässiga justeringar',
    sensitivity: 'read',
    inputSchema: z.object({ fiscal_year_id: UuidSchema }).strict(),
    handler: (ctx, i: { fiscal_year_id: string }) => listTaxAdjustments(ctx.client, ctx.companyId, i.fiscal_year_id),
  }),
  def({
    name: 'add_tax_adjustment',
    title: 'Lägg till skattemässig justering (ej avdragsgill/ej skattepliktig)',
    sensitivity: 'write',
    inputSchema: z.object({
      fiscal_year_id: UuidSchema,
      kind: z.enum(['non_deductible', 'non_taxable']),
      label: safeText(200),
      amount_ore: OreSchema,
    }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; kind: 'non_deductible' | 'non_taxable'; label: string; amount_ore: number }) =>
      addTaxAdjustment(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id, i.kind, i.label, i.amount_ore),
  }),
  def({
    name: 'delete_tax_adjustment',
    title: 'Ta bort skattemässig justering',
    sensitivity: 'write',
    inputSchema: z.object({ id: UuidSchema }).strict(),
    handler: (ctx, i: { id: string }) => deleteTaxAdjustment(ctx.client, ctx.companyId, ctx.userId, i.id),
  }),
  def({
    name: 'set_business_description',
    title: 'Sätt verksamhetsbeskrivning (förvaltningsberättelse)',
    sensitivity: 'write',
    inputSchema: z.object({ business_description: safeText(4000) }).strict(),
    handler: async (ctx, i: { business_description: string }) => {
      await ctx.client.query('UPDATE companies SET business_description = $2 WHERE id = $1', [ctx.companyId, i.business_description]);
      return { business_description: i.business_description };
    },
  }),
  def({
    name: 'key_ratios',
    title: 'Nyckeltal (marginal, soliditet, likviditet)',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict(),
    handler: (ctx, i: { from: string; to: string }) => keyRatios(ctx.client, ctx.companyId, i.from, i.to),
  }),
  def({
    name: 'top_customers',
    title: 'Toppkunder efter omsättning',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema, limit: z.number().int().min(1).max(100).optional() }).strict(),
    handler: (ctx, i: { from: string; to: string; limit?: number }) => topCustomers(ctx.client, ctx.companyId, i.from, i.to, i.limit),
  }),
  def({
    name: 'expense_breakdown',
    title: 'Kostnadsfördelning per konto',
    sensitivity: 'read',
    inputSchema: z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict(),
    handler: (ctx, i: { from: string; to: string }) => expenseBreakdown(ctx.client, ctx.companyId, i.from, i.to),
  }),
  def({
    name: 'cash_flow',
    title: 'Kassaflöde per månad (12 mån)',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => cashFlow(ctx.client, ctx.companyId, i.as_of),
  }),
  def({
    name: 'liquidity_forecast',
    title: 'Likviditetsprognos',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => liquidityForecast(ctx.client, ctx.companyId, i.as_of),
  }),
  def({
    name: 'accounts_payable_aging',
    title: 'Leverantörsreskontra (åldersanalys)',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => accountsPayableAging(ctx.client, ctx.companyId, i.as_of),
  }),
  def({
    name: 'list_supplier_invoices',
    title: 'Lista leverantörsfakturor',
    sensitivity: 'read',
    inputSchema: z.object({ status: z.enum(['draft', 'booked', 'paid', 'cancelled']).optional() }).strict(),
    handler: (ctx, i: { status?: string }) => listSupplierInvoices(ctx.client, ctx.companyId, { status: i.status }),
  }),
  def({
    name: 'create_supplier_invoice',
    title: 'Skapa leverantörsfaktura',
    sensitivity: 'write',
    inputSchema: z.object({
      supplier_id: UuidSchema, supplier_ref: safeText(60).optional(),
      invoice_date: IsoDateSchema, due_date: IsoDateSchema,
      net_ore: OreSchema, vat_rate: VatRateSchema, expense_account: AccountNumberSchema, notes: safeText(300).optional(),
    }).strict(),
    handler: (ctx, i: { supplier_id: string; supplier_ref?: string; invoice_date: string; due_date: string; net_ore: number; vat_rate: 0 | 6 | 12 | 25; expense_account: number; notes?: string }) =>
      createSupplierInvoice(ctx.client, ctx.companyId, ctx.userId, i),
  }),
  def({
    name: 'book_supplier_invoice',
    title: 'Bokför leverantörsfaktura',
    sensitivity: 'sensitive',
    inputSchema: z.object({ supplier_invoice_id: UuidSchema, fiscal_year_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { supplier_invoice_id: string; fiscal_year_id?: string }) =>
      bookSupplierInvoice(ctx.client, ctx.companyId, ctx.userId, i.supplier_invoice_id, i.fiscal_year_id),
  }),
  def({
    name: 'register_supplier_payment',
    title: 'Registrera betalning på leverantörsfaktura',
    sensitivity: 'sensitive',
    // fiscal_year_id kan utelämnas — härleds ur payment_date (olåst år krävs).
    inputSchema: z.object({
      supplier_invoice_id: UuidSchema, fiscal_year_id: UuidSchema.optional(), payment_date: IsoDateSchema,
      amount_ore: OreSchema.optional(), bank_account: AccountNumberSchema.optional(),
    }).strict(),
    handler: (ctx, i: { supplier_invoice_id: string; fiscal_year_id?: string; payment_date: string; amount_ore?: number; bank_account?: number }) =>
      recordSupplierPayment(ctx.client, ctx.companyId, ctx.userId, { supplierInvoiceId: i.supplier_invoice_id, fiscalYearId: i.fiscal_year_id, paymentDate: i.payment_date, amountOre: i.amount_ore, bankAccount: i.bank_account }),
  }),

  def({
    name: 'create_customer',
    title: 'Skapa kund',
    sensitivity: 'write',
    inputSchema: z
      .object({
        name: safeText(200),
        org_number: safeText(20).optional(),
        vat_number: safeText(20).optional(),
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
        // Mallens "Vår referens" resp. "Leveranstidpunkt" (reference är "Er referens").
        our_reference: safeText(200).optional(),
        delivery_period: safeText(100).optional(),
        reverse_charge: z.boolean().optional(),
        housework_type: z.enum(['rot', 'rut']).optional(),
        labor_cost_ore: z.number().int().nonnegative().safe().optional(),
        buyer_personnummer: safeText(13).optional(),
        property_designation: safeText(100).optional(),
        lines: z.array(InvoiceLine).min(1),
      })
      .strict(),
    handler: (ctx, i) => createInvoice(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'list_recurring_invoices',
    title: 'Lista återkommande fakturor',
    sensitivity: 'read',
    inputSchema: z.object({}).strict(),
    handler: (ctx) => listRecurringInvoices(ctx.client, ctx.companyId),
  }),
  def({
    name: 'create_recurring_invoice',
    title: 'Skapa mall för återkommande faktura',
    sensitivity: 'write',
    inputSchema: z
      .object({
        customer_id: UuidSchema,
        title: safeText(150),
        interval: z.enum(['monthly', 'quarterly', 'yearly']),
        next_run_date: IsoDateSchema,
        end_date: IsoDateSchema.optional(),
        payment_terms: z.number().int().min(0).max(365).optional(),
        reference: safeText(200).optional(),
        notes: safeText(300).optional(),
        lines: z.array(InvoiceLine).min(1),
      })
      .strict(),
    handler: (ctx, i) => createRecurringInvoice(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'set_recurring_active',
    title: 'Aktivera/pausa återkommande faktura',
    sensitivity: 'write',
    inputSchema: z.object({ recurring_id: UuidSchema, active: z.boolean() }).strict(),
    handler: (ctx, i: { recurring_id: string; active: boolean }) =>
      setRecurringActive(ctx.client, ctx.companyId, ctx.userId, i.recurring_id, i.active),
  }),
  def({
    name: 'run_recurring_invoices',
    title: 'Generera förfallna återkommande fakturor',
    sensitivity: 'sensitive',
    inputSchema: z.object({ as_of: IsoDateSchema }).strict(),
    handler: (ctx, i: { as_of: string }) =>
      runDueRecurringInvoices(ctx.client, ctx.companyId, ctx.userId, i.as_of),
  }),
  def({
    name: 'list_projects',
    title: 'Lista projekt',
    sensitivity: 'read',
    inputSchema: z.object({ status: z.enum(['active', 'closed']).optional() }).strict(),
    handler: (ctx, i: { status?: 'active' | 'closed' }) => listProjects(ctx.client, ctx.companyId, { status: i.status }),
  }),
  def({
    name: 'get_project',
    title: 'Hämta projekt med tidsammanställning',
    sensitivity: 'read',
    inputSchema: z.object({ project_id: UuidSchema }).strict(),
    handler: (ctx, i: { project_id: string }) => getProject(ctx.client, ctx.companyId, i.project_id),
  }),
  def({
    name: 'create_project',
    title: 'Skapa projekt',
    sensitivity: 'write',
    inputSchema: z
      .object({
        name: safeText(150),
        customer_id: UuidSchema.optional(),
        hourly_rate_ore: OreSchema.optional(),
        budget_ore: OreSchema.optional(),
        notes: safeText(500).optional(),
      })
      .strict(),
    handler: (ctx, i) => createProject(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'set_project_status',
    title: 'Öppna/stäng projekt',
    sensitivity: 'write',
    inputSchema: z.object({ project_id: UuidSchema, status: z.enum(['active', 'closed']) }).strict(),
    handler: (ctx, i: { project_id: string; status: 'active' | 'closed' }) =>
      setProjectStatus(ctx.client, ctx.companyId, ctx.userId, i.project_id, i.status),
  }),
  def({
    name: 'log_time',
    title: 'Registrera tidpost',
    sensitivity: 'write',
    inputSchema: z
      .object({
        project_id: UuidSchema,
        work_date: IsoDateSchema,
        minutes: z.number().int().min(1).max(1440),
        description: safeText(300),
        hourly_rate_ore: OreSchema.optional(),
        billable: z.boolean().optional(),
      })
      .strict(),
    handler: (ctx, i) => createTimeEntry(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'import_sie',
    title: 'Importera SIE-fil (konton + verifikat)',
    sensitivity: 'sensitive',
    inputSchema: z.object({ fiscal_year_id: UuidSchema, sie_content: z.string().min(1).max(4_000_000) }).strict(),
    handler: (ctx, i: { fiscal_year_id: string; sie_content: string }) =>
      importSie(ctx.client, ctx.companyId, ctx.userId, i.fiscal_year_id, parseSie(i.sie_content)),
  }),
  def({
    name: 'import_bank_csv',
    title: 'Importera bank-CSV',
    sensitivity: 'write',
    inputSchema: z.object({ csv_content: z.string().min(1).max(4_000_000) }).strict(),
    handler: (ctx, i: { csv_content: string }) => importBankCsv(ctx.client, ctx.companyId, ctx.userId, i.csv_content),
  }),
  def({
    name: 'list_bank_transactions',
    title: 'Lista importerade banktransaktioner',
    sensitivity: 'read',
    inputSchema: z.object({ reconciled: z.boolean().optional() }).strict(),
    handler: (ctx, i: { reconciled?: boolean }) => listBankTransactions(ctx.client, ctx.companyId, { reconciled: i.reconciled }),
  }),
  def({
    name: 'reconcile_bank_transaction',
    title: 'Markera banktransaktion som avstämd',
    sensitivity: 'write',
    inputSchema: z.object({ transaction_id: UuidSchema, reconciled: z.boolean() }).strict(),
    handler: (ctx, i: { transaction_id: string; reconciled: boolean }) =>
      setBankTransactionReconciled(ctx.client, ctx.companyId, ctx.userId, i.transaction_id, i.reconciled),
  }),
  def({
    name: 'list_employees',
    title: 'Lista anställda',
    sensitivity: 'read',
    inputSchema: z.object({ active: z.boolean().optional() }).strict(),
    handler: (ctx, i: { active?: boolean }) => listEmployees(ctx.client, ctx.companyId, { active: i.active }),
  }),
  def({
    name: 'create_employee',
    title: 'Lägg till anställd',
    sensitivity: 'write',
    inputSchema: z.object({
      name: safeText(200), personnummer: safeText(20).optional(), email: EmailSchema.optional(),
      monthly_salary_ore: OreSchema, tax_rate: z.number().int().min(0).max(100).optional(),
      employment_type: safeText(40).optional(),
    }).strict(),
    handler: (ctx, i) => createEmployee(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'set_employee_active',
    title: 'Aktivera/avsluta anställd',
    sensitivity: 'write',
    inputSchema: z.object({ employee_id: UuidSchema, active: z.boolean() }).strict(),
    handler: (ctx, i: { employee_id: string; active: boolean }) => setEmployeeActive(ctx.client, ctx.companyId, ctx.userId, i.employee_id, i.active),
  }),
  def({
    name: 'list_payslips',
    title: 'Lista lönebesked',
    sensitivity: 'read',
    inputSchema: z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).strict(),
    handler: (ctx, i: { period?: string }) => listPayslips(ctx.client, ctx.companyId, { period: i.period }),
  }),
  def({
    name: 'create_payslip',
    title: 'Skapa lönebesked (utkast)',
    sensitivity: 'write',
    // tax_ore = manuell jämkning; utelämnad slås skatten upp i tabell 30 för
    // utbetalningsårets tabell (platt tax_rate som fallback utanför intervallet).
    // payment_date default: den 25:e i perioden med svensk bankdagsregel.
    // Semesterersättning: include_vacation_pay → 12 %, vacation_pay_ore → eget belopp.
    inputSchema: z.object({
      employee_id: UuidSchema, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      gross_ore: OreSchema.optional(), tax_ore: OreSchema.optional(),
      payment_date: IsoDateSchema.optional(),
      vacation_pay_ore: OreSchema.optional(), include_vacation_pay: z.boolean().optional(),
    }).strict(),
    handler: (ctx, i: { employee_id: string; period: string; gross_ore?: number; tax_ore?: number; payment_date?: string; vacation_pay_ore?: number; include_vacation_pay?: boolean }) =>
      createPayslip(ctx.client, ctx.companyId, ctx.userId, i),
  }),
  def({
    name: 'payroll_year_summary',
    title: 'Ackumulerad lön per kalenderår (brutto/skatt/netto/arbetsgivaravgift)',
    sensitivity: 'read',
    inputSchema: z.object({ year: z.number().int().min(2000).max(2100), employee_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { year: number; employee_id?: string }) =>
      payrollYearSummary(ctx.client, ctx.companyId, i.year, { employee_id: i.employee_id }),
  }),
  def({
    name: 'recalculate_draft_payslips',
    title: 'Räkna om skatten på obokade lönebesked (tabell 30)',
    sensitivity: 'write',
    inputSchema: z.object({
      from_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
      to_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    }).strict(),
    handler: (ctx, i: { from_period?: string; to_period?: string }) =>
      recalculateDraftPayslips(ctx.client, ctx.companyId, ctx.userId, i),
  }),
  def({
    name: 'book_payslip',
    title: 'Bokför lönebesked (kontantmetod: 7010 D / 1930 K = netto)',
    sensitivity: 'sensitive',
    // payment_date default: lönebeskedets utbetalningsdatum. fiscal_year_id
    // utelämnad härleds ur datumet (kräver olåst räkenskapsår).
    inputSchema: z.object({ payslip_id: UuidSchema, fiscal_year_id: UuidSchema.optional(), payment_date: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { payslip_id: string; fiscal_year_id?: string; payment_date?: string }) =>
      bookPayslip(ctx.client, ctx.companyId, ctx.userId, i.payslip_id, i.fiscal_year_id, i.payment_date),
  }),
  def({
    name: 'book_payroll_tax',
    title: 'Bokför skattekontobetalning för lön (2510 D / 1930 K = skatt + arbetsgivaravgift)',
    sensitivity: 'sensitive',
    // Beloppet föreslås ur periodens lönebesked (avrundat till hela kronor);
    // payment_date default: den 12:e månaden efter med bankdagsregeln.
    inputSchema: z.object({
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      fiscal_year_id: UuidSchema.optional(),
      payment_date: IsoDateSchema.optional(),
      amount_ore: OreSchema.optional(),
    }).strict(),
    handler: (ctx, i: { period: string; fiscal_year_id?: string; payment_date?: string; amount_ore?: number }) =>
      bookPayrollTax(ctx.client, ctx.companyId, ctx.userId, i),
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
    name: 'add_contact',
    title: 'Lägg till kontaktperson',
    sensitivity: 'write',
    inputSchema: z.object({
      party_type: PartyTypeSchema, party_id: UuidSchema, name: safeText(150),
      email: EmailSchema.optional(), phone: safeText(40).optional(), role: safeText(80).optional(), is_primary: z.boolean().optional(),
    }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string; name: string; email?: string; phone?: string; role?: string; is_primary?: boolean }) =>
      addContact(ctx.client, ctx.companyId, ctx.userId, { partyType: i.party_type, partyId: i.party_id, name: i.name, email: i.email, phone: i.phone, role: i.role, isPrimary: i.is_primary }),
  }),
  def({
    name: 'add_note',
    title: 'Lägg till anteckning',
    sensitivity: 'write',
    inputSchema: z.object({ party_type: PartyTypeSchema, party_id: UuidSchema, body: safeText(2000) }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string; body: string }) =>
      addNote(ctx.client, ctx.companyId, ctx.userId, { partyType: i.party_type, partyId: i.party_id, body: i.body }),
  }),
  def({
    name: 'set_tags',
    title: 'Sätt taggar',
    sensitivity: 'write',
    inputSchema: z.object({ party_type: PartyTypeSchema, party_id: UuidSchema, tags: z.array(safeText(40)).max(30) }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string; tags: string[] }) =>
      setTags(ctx.client, ctx.companyId, ctx.userId, i.party_type, i.party_id, i.tags),
  }),

  def({
    name: 'book_invoice',
    title: 'Bokför faktura',
    sensitivity: 'sensitive',
    inputSchema: z.object({ invoice_id: UuidSchema, fiscal_year_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { invoice_id: string; fiscal_year_id?: string }) =>
      bookInvoice(ctx.client, ctx.companyId, ctx.userId, i.invoice_id, i.fiscal_year_id),
  }),
  def({
    name: 'book_receipt',
    title: 'Bokför kvitto',
    sensitivity: 'sensitive',
    inputSchema: z.object({ receipt_id: UuidSchema, fiscal_year_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { receipt_id: string; fiscal_year_id?: string }) =>
      bookReceipt(ctx.client, ctx.companyId, ctx.userId, i.receipt_id, i.fiscal_year_id),
  }),
  def({
    name: 'register_invoice_payment',
    title: 'Registrera betalning på faktura',
    sensitivity: 'sensitive',
    // amount_ore utelämnas → betalar återstående skuld. Delbetalning stöds:
    // beloppet får aldrig överstiga återstoden (överbetalningsspärr).
    // fiscal_year_id kan utelämnas — härleds ur payment_date (olåst år krävs).
    inputSchema: z
      .object({
        invoice_id: UuidSchema,
        fiscal_year_id: UuidSchema.optional(),
        payment_date: IsoDateSchema,
        amount_ore: OreSchema.optional(),
        bank_account: AccountNumberSchema.optional(),
      })
      .strict(),
    handler: (ctx, i: { invoice_id: string; fiscal_year_id?: string; payment_date: string; amount_ore?: number; bank_account?: number }) =>
      recordInvoicePayment(ctx.client, ctx.companyId, ctx.userId, {
        invoiceId: i.invoice_id,
        fiscalYearId: i.fiscal_year_id,
        paymentDate: i.payment_date,
        amountOre: i.amount_ore,
        bankAccount: i.bank_account,
      }),
  }),
  def({
    name: 'book_invoice_and_register_payment',
    title: 'Bokför faktura OCH registrera betalning (ett godkännande)',
    sensitivity: 'sensitive',
    // K4: composite-action för det vanligaste beroendet — betalningen kräver
    // en bokförd faktura. Köas som EN godkännandepost med båda stegen synliga
    // och körs atomiskt i samma transaktion (redan bokförd faktura tolereras;
    // då registreras bara betalningen).
    inputSchema: z
      .object({
        invoice_id: UuidSchema,
        fiscal_year_id: UuidSchema.optional(),
        payment_date: IsoDateSchema,
        amount_ore: OreSchema.optional(),
        bank_account: AccountNumberSchema.optional(),
      })
      .strict(),
    handler: async (ctx, i: { invoice_id: string; fiscal_year_id?: string; payment_date: string; amount_ore?: number; bank_account?: number }) => {
      const current = await getInvoice(ctx.client, ctx.companyId, i.invoice_id);
      const bookedNow = !current.voucher_id;
      if (bookedNow) await bookInvoice(ctx.client, ctx.companyId, ctx.userId, i.invoice_id, i.fiscal_year_id);
      const paid = await recordInvoicePayment(ctx.client, ctx.companyId, ctx.userId, {
        invoiceId: i.invoice_id,
        fiscalYearId: i.fiscal_year_id,
        paymentDate: i.payment_date,
        amountOre: i.amount_ore,
        bankAccount: i.bank_account,
      });
      return { booked_now: bookedNow, invoice: paid };
    },
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
