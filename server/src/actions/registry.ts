import type { PoolClient } from 'pg';
import type { CompanyRole } from '../db/tx.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AccountNumberSchema, EmailSchema, IsoDateSchema, IsoDateTimeSchema, OreSchema, safeText, UuidSchema, VatRateSchema } from '../lib/validation.js';
import {
  confirmCrmValue, getOrganization, getRetention, listCommitments, listOrganizations, listPeople, logContact,
  purgeCrmData, recordCommitment, recordInteraction, setCommitmentStatus, setRelationNudge, setRetention,
  snoozeCommitment, upsertOrganization, upsertPerson,
} from '../services/crmRelations.js';
import { sourceForActor } from '../services/crmProvenance.js';
import { mergeOrganizations, mergePeople, removeOrganizationNameAlias, searchCrm } from '../services/crmMerge.js';
import { contactSuggestions, relationState, silenceReport, todayView } from '../services/crmDerivations.js';
import { ingestCrmEvents } from '../services/crmIngest.js';
import { isThreadFilter, relationThread } from '../services/crmThread.js';
import { addContact, addNote, getPartyCrm, listContacts, listNotes, setTags, upsertContact } from '../services/crm.js';
const PartyTypeSchema = z.enum(['customer', 'supplier']);
import { createCustomer, createSupplier, getCustomer, getSupplier, listCustomers, listSuppliers, updateCustomer, updateSupplier } from '../services/parties.js';
import { createInvoice, bookInvoice, getInvoice, listInvoices, recordInvoicePayment } from '../services/invoices.js';
import { bookReceipt, createReceipt, listReceipts } from '../services/receipts.js';
import { getVoucher, listVouchers, postVoucher, reverseVoucher } from '../services/accounting/vouchers.js';
import { listFiscalYears, setFiscalYearLock } from '../services/accounting/fiscalYears.js';
import { vatReport } from '../services/accounting/vatReport.js';
import { accountsPayableAging, accountsReceivableAging, cashFlow, liquidityForecast, monthlyRevenue } from '../services/reports.js';
import { bookSupplierInvoice, createSupplierInvoice, listSupplierInvoices, recordSupplierPayment } from '../services/supplierInvoices.js';
import { createRecurringInvoice, listRecurringInvoices, runDueRecurringInvoices, setRecurringActive } from '../services/recurringInvoices.js';
import { createProject, createTimeEntry, getProject, listProjects, setProjectStatus } from '../services/projects.js';
import { listWorkActors, setWorkActorUser, upsertWorkActor } from '../services/workActors.js';
import { assignProjectActor, listProjectAssignments, unassignProjectActor } from '../services/projectAssignments.js';
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
import { addTaxAdjustment, deleteTaxAdjustment, ink2rReport, ink2sReport, listTaxAdjustments, setAccountNonDeductible } from '../services/ink2.js';
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
import { getInvoiceNumberSeries, setExternalInvoiceNumbers, setInvoiceNumberSeries } from '../services/invoiceNumbering.js';
import {
  appendixFromTimeEntries, getInvoiceAppendix, setInvoiceAppendix,
  type AppendixKind, type AppendixRowInput,
} from '../services/invoiceAppendix.js';
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
  // Rollen kommer ur medlemskapet i SAMMA transaktion — aldrig ur indata. Bara
  // actions som verkligen skiljer på ägare/admin och medlem läser den.
  role: CompanyRole;
  // Vem som faktiskt skriver: en människa eller AI:t. Avgör INTE behörigheten
  // (den sitter i medlemskapet) utan sanningsanspråket — ett fält som AI:t satt
  // är en gissning, ett fält en människa satt är ett beslut. Se crmProvenance.
  actor: Actor;
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
    name: 'get_invoice_number_series',
    title: 'Visa fakturaräknaren (nästa nummer + högsta utställda)',
    sensitivity: 'read',
    inputSchema: z.object({}).strict(),
    handler: (ctx) => getInvoiceNumberSeries(ctx.client, ctx.companyId),
  }),
  def({
    name: 'set_invoice_number_series',
    title: 'Flytta fakturaräknaren framåt (synka med kundserien)',
    // LOC-263: påverkar vilket nummer kundens nästa faktura får — en
    // bokföringsintegritetsåtgärd, därför mänskligt godkännande. Endast framåt.
    sensitivity: 'sensitive',
    inputSchema: z.object({ next_invoice_number: z.number().int().min(1).max(1_000_000) }).strict(),
    handler: (ctx, i: { next_invoice_number: number }) =>
      setInvoiceNumberSeries(ctx.client, ctx.companyId, ctx.userId, i.next_invoice_number),
  }),
  def({
    name: 'set_external_invoice_numbers',
    title: 'Registrera kundens fakturanummer på befintliga fakturor',
    // LOC-263: ändrar numret kunden ser på fakturan — samma vikt som ovan.
    sensitivity: 'sensitive',
    inputSchema: z.object({
      assignments: z.array(z.object({
        invoice_id: UuidSchema,
        external_invoice_number: z.number().int().min(1).max(1_000_000),
      }).strict()).min(1).max(200),
    }).strict(),
    handler: (ctx, i: { assignments: { invoice_id: string; external_invoice_number: number }[] }) =>
      setExternalInvoiceNumbers(ctx.client, ctx.companyId, ctx.userId,
        i.assignments.map((a) => ({ invoiceId: a.invoice_id, externalNumber: a.external_invoice_number }))),
  }),
  def({
    name: 'set_invoice_appendix',
    title: 'Sätt fakturans bilaga (tids- eller utläggsspecifikation, sida 2)',
    sensitivity: 'write',
    // Tid som heltal minuter, utlägg som heltal ören — aldrig flyttal.
    inputSchema: z.object({
      invoice_id: UuidSchema,
      kind: z.enum(['time', 'expense']),
      title: safeText(150).optional(),
      preamble: safeText(400).optional(),
      notes: safeText(800).optional(),
      rows: z.array(z.object({
        entry_date: IsoDateSchema,
        description: safeText(300),
        minutes: z.number().int().positive().max(100_000).optional(),
        amount_ore: z.number().int().nonnegative().safe().optional(),
      }).strict()).min(1).max(500),
    }).strict(),
    handler: (ctx, i) => setInvoiceAppendix(ctx.client, ctx.companyId, ctx.userId, {
      invoiceId: (i as { invoice_id: string }).invoice_id,
      kind: (i as { kind: AppendixKind }).kind,
      title: (i as { title?: string }).title,
      preamble: (i as { preamble?: string }).preamble,
      notes: (i as { notes?: string }).notes,
      rows: (i as { rows: AppendixRowInput[] }).rows,
    }),
  }),
  def({
    name: 'get_invoice_appendix',
    title: 'Hämta fakturans bilaga',
    sensitivity: 'read',
    inputSchema: z.object({ invoice_id: UuidSchema }).strict(),
    handler: (ctx, i: { invoice_id: string }) => getInvoiceAppendix(ctx.client, ctx.companyId, i.invoice_id),
  }),
  def({
    name: 'invoice_appendix_from_time_entries',
    title: 'Fyll tidsbilagan ur systemets tidrapportering',
    sensitivity: 'write',
    // Markerar de använda tidsposterna som fakturerade (kan inte dubbelfaktureras).
    inputSchema: z.object({
      invoice_id: UuidSchema,
      project_id: UuidSchema.optional(),
      from: IsoDateSchema,
      to: IsoDateSchema,
      title: safeText(150).optional(),
      preamble: safeText(400).optional(),
    }).strict(),
    handler: (ctx, i: { invoice_id: string; project_id?: string; from: string; to: string; title?: string; preamble?: string }) =>
      appendixFromTimeEntries(ctx.client, ctx.companyId, ctx.userId, {
        invoiceId: i.invoice_id, projectId: i.project_id, from: i.from, to: i.to,
        title: i.title, preamble: i.preamble,
      }),
  }),
  def({
    name: 'set_account_non_deductible',
    title: 'Flagga konto som ej avdragsgillt (räknas med i INK2S 4.3 c)',
    sensitivity: 'write',
    // Kostnader på flaggade konton härleds automatiskt till INK2S ruta 4.3 c —
    // ingen manuell justering behövs. 6072 och 6992 är flaggade från start.
    inputSchema: z.object({
      account_number: z.number().int().min(1000).max(9999),
      non_deductible: z.boolean(),
    }).strict(),
    handler: (ctx, i: { account_number: number; non_deductible: boolean }) =>
      setAccountNonDeductible(ctx.client, ctx.companyId, ctx.userId, i.account_number, i.non_deductible),
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
    name: 'update_customer',
    title: 'Rätta uppgifter på en kund',
    sensitivity: 'write',
    // En kund har ingen betalningsmottagare hos oss — payment_terms är ett
    // VILLKOR, inte ett konto. Därför är hela kunden rättningsbar direkt.
    inputSchema: z
      .object({
        customer_id: UuidSchema,
        name: safeText(200).optional(),
        org_number: safeText(20).optional(),
        vat_number: safeText(20).optional(),
        email: safeText(254).optional(),
        phone: safeText(50).optional(),
        address: safeText(200).optional(),
        postal_code: safeText(20).optional(),
        city: safeText(100).optional(),
        payment_terms: z.number().int().min(0).max(365).optional(),
        is_active: z.boolean().optional(),
      })
      .strict(),
    handler: (ctx, i) => {
      const { customer_id, ...falt } = i as Record<string, unknown> & { customer_id: string };
      return updateCustomer(ctx.client, ctx.companyId, ctx.userId, customer_id, falt);
    },
  }),
  def({
    name: 'update_supplier',
    title: 'Rätta uppgifter på en leverantör (ej betalningsmottagare)',
    sensitivity: 'write',
    // bankgiro och plusgiro saknas här MED FLIT. `.strict()` gör utelämnandet
    // till en spärr och inte en konvention: skickas de hit avvisas anropet.
    // De hör till update_supplier_payment_details, som kräver godkännande.
    inputSchema: z
      .object({
        supplier_id: UuidSchema,
        name: safeText(200).optional(),
        org_number: safeText(20).optional(),
        email: safeText(254).optional(),
        phone: safeText(50).optional(),
        is_active: z.boolean().optional(),
      })
      .strict(),
    handler: (ctx, i) => {
      const { supplier_id, ...falt } = i as Record<string, unknown> & { supplier_id: string };
      return updateSupplier(ctx.client, ctx.companyId, ctx.userId, supplier_id, falt);
    },
  }),
  def({
    name: 'update_supplier_payment_details',
    title: 'Ändra betalningsmottagare (bankgiro/plusgiro) för en leverantör',
    // SENSITIVE, och skälet är inte formellt: den som ändrar ett bankgiro
    // flyttar vart pengarna går. Det är vektorn i leverantörsbedrägeri, och
    // den upptäcks annars först när fakturan är betald till fel konto.
    //
    // Åtgärden har ett eget namn för att godkännandekön ska säga VAD som står
    // på spel. "Ändra betalningsmottagare för X" går att bedöma på en rad;
    // "update_supplier" gör det inte.
    sensitivity: 'sensitive',
    inputSchema: z
      .object({
        supplier_id: UuidSchema,
        bankgiro: safeText(20).optional(),
        plusgiro: safeText(20).optional(),
      })
      .strict()
      // Ett tomt anrop hade gått igenom godkännandekön och ändrat ingenting -
      // en godkänd åtgärd som inte gjorde något är värre än ett fel, för den
      // lär läsaren att kön innehåller brus.
      .refine((i) => i.bankgiro !== undefined || i.plusgiro !== undefined, {
        message: 'ange bankgiro eller plusgiro — annars finns ingenting att ändra',
      }),
    handler: (ctx, i) => {
      const { supplier_id, ...falt } = i as Record<string, unknown> & { supplier_id: string };
      return updateSupplier(ctx.client, ctx.companyId, ctx.userId, supplier_id, falt);
    },
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
        // Pris mot kund. Utelämnat = projektets taxa.
        hourly_rate_ore: OreSchema.optional(),
        billable: z.boolean().optional(),
        // Vem som UTFÖRDE arbetet. Utelämnat = den inloggade användarens aktör,
        // som skapas automatiskt. Ingen behöver komma ihåg att fylla i det.
        performed_by_actor_id: UuidSchema.optional(),
        // Vad timmen kostar OSS. Utelämnat = aktörens standardtaxa, fryst nu.
        cost_rate_ore: OreSchema.optional(),
      })
      .strict(),
    handler: (ctx, i) => createTimeEntry(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'set_work_actor_user',
    title: 'Koppla aktör till användarkonto',
    // KÄNSLIG: kopplingen aktör→konto är det RLS läser för att avgöra vem som
    // får se ett projekt och dess tid (0053). En AI som kunde ändra den utan
    // godkännande kunde flytta åtkomst — samma sorts konsekvens som att flytta
    // pengar. Ägare/admin krävs dessutom, och målanvändaren måste vara medlem.
    sensitivity: 'sensitive',
    inputSchema: z.object({ actor_id: UuidSchema, user_id: UuidSchema.nullable() }).strict(),
    handler: (ctx, i: { actor_id: string; user_id: string | null }) =>
      setWorkActorUser(ctx.client, ctx.companyId, ctx.userId, ctx.role, i.actor_id, i.user_id),
  }),
  def({
    name: 'assign_project_actor',
    title: 'Tilldela aktör till projekt',
    // KÄNSLIG av samma skäl som set_work_actor_user: tilldelningen ÄR
    // behörigheten. Ägare/admin kontrolleras både i tjänstelagret och i policyn.
    sensitivity: 'sensitive',
    inputSchema: z.object({ project_id: UuidSchema, actor_id: UuidSchema }).strict(),
    handler: (ctx, i: { project_id: string; actor_id: string }) =>
      assignProjectActor(ctx.client, ctx.companyId, ctx.userId, ctx.role, i.project_id, i.actor_id),
  }),
  def({
    name: 'unassign_project_actor',
    title: 'Ta bort aktör från projekt',
    // Känslig som sin motsats: att dra tillbaka åtkomst ska också synas i kön.
    sensitivity: 'sensitive',
    inputSchema: z.object({ project_id: UuidSchema, actor_id: UuidSchema }).strict(),
    handler: (ctx, i: { project_id: string; actor_id: string }) =>
      unassignProjectActor(ctx.client, ctx.companyId, ctx.userId, ctx.role, i.project_id, i.actor_id),
  }),
  def({
    name: 'list_project_assignments',
    title: 'Lista uppdragstilldelningar',
    sensitivity: 'read',
    inputSchema: z.object({ project_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { project_id?: string }) =>
      listProjectAssignments(ctx.client, ctx.companyId, { project_id: i.project_id }),
  }),
  def({
    name: 'list_work_actors',
    title: 'Lista aktörer (vem som utför arbete)',
    sensitivity: 'read',
    inputSchema: z.object({ active: z.boolean().optional() }).strict(),
    handler: (ctx, i: { active?: boolean }) => listWorkActors(ctx.client, ctx.companyId, { active: i.active }),
  }),
  def({
    name: 'upsert_work_actor',
    title: 'Lägg upp/uppdatera aktör med inköpskostnad',
    sensitivity: 'write',
    inputSchema: z
      .object({
        name: safeText(150),
        kind: z.enum(['internal', 'subcontractor']).optional(),
        employee_id: UuidSchema.optional(),
        supplier_id: UuidSchema.optional(),
        // INKÖPSKOSTNAD per timme — inte priset mot kund. Marginal = pris − kostnad.
        cost_rate_ore: OreSchema.optional(),
        active: z.boolean().optional(),
        notes: safeText(500).optional(),
      })
      .strict(),
    handler: (ctx, i) => upsertWorkActor(ctx.client, ctx.companyId, ctx.userId, i as never),
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
    name: 'upsert_contact',
    title: 'Skapa eller uppdatera kontaktperson (idempotent)',
    sensitivity: 'write',
    // CRM E1: körs en synk om ska den UPPDATERA, inte lägga en dubblett.
    // Nyckel: e-post när den finns, annars namnet inom samma part.
    inputSchema: z.object({
      party_type: PartyTypeSchema, party_id: UuidSchema, name: safeText(150),
      email: EmailSchema.optional(), phone: safeText(40).optional(),
      role: safeText(80).optional(), is_primary: z.boolean().optional(),
    }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string; name: string; email?: string; phone?: string; role?: string; is_primary?: boolean }) =>
      upsertContact(ctx.client, ctx.companyId, ctx.userId, {
        partyType: i.party_type, partyId: i.party_id, name: i.name,
        email: i.email, phone: i.phone, role: i.role, isPrimary: i.is_primary,
      }),
  }),
  def({
    name: 'list_contacts',
    title: 'Lista kontaktpersoner på en part',
    sensitivity: 'read',
    // CRM E1: utan denna kan agenten skriva kontakter men aldrig läsa tillbaka
    // dem — och därmed inte veta om den redan skrivit dem.
    inputSchema: z.object({ party_type: PartyTypeSchema, party_id: UuidSchema }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string }) =>
      listContacts(ctx.client, ctx.companyId, i.party_type, i.party_id),
  }),
  def({
    name: 'list_notes',
    title: 'Lista anteckningar på en part',
    sensitivity: 'read',
    inputSchema: z.object({ party_type: PartyTypeSchema, party_id: UuidSchema }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string }) =>
      listNotes(ctx.client, ctx.companyId, i.party_type, i.party_id),
  }),
  def({
    name: 'get_party_crm',
    title: 'Hämta partens CRM-bild (kontakter, anteckningar, taggar)',
    sensitivity: 'read',
    inputSchema: z.object({ party_type: PartyTypeSchema, party_id: UuidSchema }).strict(),
    handler: (ctx, i: { party_type: 'customer' | 'supplier'; party_id: string }) =>
      getPartyCrm(ctx.client, ctx.companyId, i.party_type, i.party_id),
  }),
  def({
    name: 'get_customer',
    title: 'Hämta en kund',
    sensitivity: 'read',
    inputSchema: z.object({ customer_id: UuidSchema }).strict(),
    handler: (ctx, i: { customer_id: string }) => getCustomer(ctx.client, ctx.companyId, i.customer_id),
  }),
  def({
    name: 'get_supplier',
    title: 'Hämta en leverantör',
    sensitivity: 'read',
    inputSchema: z.object({ supplier_id: UuidSchema }).strict(),
    handler: (ctx, i: { supplier_id: string }) => getSupplier(ctx.client, ctx.companyId, i.supplier_id),
  }),

  // --- CRM E2: relationsdata i schemat `crm` ---------------------------------
  // Skilt från kund-/leverantörsregistret ovan: ett prospekt får inte läggas
  // som kund innan affären är vunnen, och relationsdata är inte
  // räkenskapsinformation (egen gallring, aldrig med i SIE eller revisorsvy).
  def({
    name: 'upsert_crm_organization',
    title: 'Lägg upp/uppdatera organisation (prospekt eller kund)',
    sensitivity: 'write',
    inputSchema: z
      .object({
        // Anges när raden redan är känd (rättning i vyn). Utan den matchas namnet.
        organization_id: UuidSchema.optional(),
        name: safeText(200),
        org_number: safeText(20).optional(),
        website: safeText(200).optional(),
        // Sätts när prospektet blivit kund. Kunduppgifterna kopieras inte hit.
        customer_id: UuidSchema.optional(),
        status: z.enum(['prospect', 'customer', 'partner', 'former', 'archived']).optional(),
        source: safeText(200).optional(),
        notes: safeText(2000).optional(),
      })
      .strict(),
    handler: (ctx, i) => upsertOrganization(ctx.client, ctx.companyId, ctx.userId, i as never,
      { source: sourceForActor(ctx.actor) }),
  }),
  def({
    name: 'list_crm_organizations',
    title: 'Lista organisationer med senaste kontakt',
    sensitivity: 'read',
    inputSchema: z.object({
      status: z.enum(['prospect', 'customer', 'partner', 'former', 'archived']).optional(),
    }).strict(),
    handler: (ctx, i: { status?: 'prospect' | 'customer' | 'partner' | 'former' | 'archived' }) =>
      listOrganizations(ctx.client, ctx.companyId, { status: i.status }),
  }),
  def({
    name: 'get_crm_organization',
    title: 'Hämta organisationens relation (personer, kontakter, åtaganden)',
    sensitivity: 'read',
    inputSchema: z.object({ organization_id: UuidSchema }).strict(),
    handler: (ctx, i: { organization_id: string }) => getOrganization(ctx.client, ctx.companyId, i.organization_id),
  }),
  // F4: "stämmer". Det billigaste handgreppet i hela ytan — en människa intygar
  // ett värde AI:t gissat, utan att ändra det. Därefter kan ingen synk skriva
  // över det. Fältnamnet kommer ur en enum, aldrig ur fri text: en skrivning som
  // pekar ut en kolumn byggs på allowlist.
  def({
    name: 'confirm_crm_value',
    title: 'Bekräfta en uppgift (gissning blir beslut)',
    sensitivity: 'write',
    // MCP-spec kräver type:"object" på toppnivån i tools/list — därför ETT objekt
    // med superRefine i stället för z.union (som ger anyOf utan type).
    inputSchema: z
      .object({
        organization_id: UuidSchema.optional(),
        person_id: UuidSchema.optional(),
        field: z.enum([
          'name', 'org_number', 'website', 'customer_id', 'status', 'notes',
          'email', 'phone', 'role_title', 'organization_id',
        ]),
      })
      .strict()
      .superRefine((v, ctx) => {
        const orgFields = ['name', 'org_number', 'website', 'customer_id', 'status', 'notes'];
        const personFields = ['name', 'email', 'phone', 'role_title', 'organization_id'];
        if (!!v.organization_id === !!v.person_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'ange exakt en av organization_id och person_id',
            path: ['organization_id'],
          });
          return;
        }
        const allowed = v.organization_id ? orgFields : personFields;
        if (!allowed.includes(v.field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `field '${v.field}' är inte giltigt för ${v.organization_id ? 'organisation' : 'person'}`,
            path: ['field'],
          });
        }
      }),
    handler: (ctx, i: { organization_id?: string; person_id?: string; field: string }) =>
      confirmCrmValue(ctx.client, ctx.companyId, ctx.userId, ctx.actor,
        i.organization_id ? { organization_id: i.organization_id } : { person_id: i.person_id! }, i.field),
  }),
  def({
    name: 'upsert_crm_person',
    title: 'Lägg upp/uppdatera person',
    sensitivity: 'write',
    inputSchema: z
      .object({
        name: safeText(150),
        email: EmailSchema.optional(),
        phone: safeText(40).optional(),
        role_title: safeText(150).optional(),
        organization_id: UuidSchema.optional(),
        // Personkortet i brain-vaulten. CRM:et äger inte omdömet — det pekar på det.
        external_ref: safeText(300).optional(),
        notes: safeText(2000).optional(),
      })
      .strict(),
    handler: (ctx, i) => upsertPerson(ctx.client, ctx.companyId, ctx.userId, i as never,
      { source: sourceForActor(ctx.actor) }),
  }),
  def({
    name: 'list_crm_people',
    title: 'Lista personer med senaste kontakt',
    sensitivity: 'read',
    inputSchema: z.object({ organization_id: UuidSchema.optional() }).strict(),
    handler: (ctx, i: { organization_id?: string }) =>
      listPeople(ctx.client, ctx.companyId, { organization_id: i.organization_id }),
  }),
  def({
    name: 'record_crm_interaction',
    title: 'Registrera kontaktpunkt (mail, möte, samtal, ärende)',
    sensitivity: 'write',
    inputSchema: z
      .object({
        person_id: UuidSchema.optional(),
        organization_id: UuidSchema.optional(),
        occurred_at: IsoDateTimeSchema,
        channel: z.enum(['email', 'meeting', 'call', 'issue', 'note']),
        direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
        summary: safeText(2000),
        // Tidrapportering är medvetet ingen giltig källa — se migration 0052.
        source_system: z.enum(['gmail', 'calendar', 'linear', 'manual']),
        source_ref: safeText(300).optional(),
      })
      .strict(),
    handler: (ctx, i) => recordInteraction(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'record_crm_commitment',
    title: 'Registrera åtagande (vem lovade vad, var det sades)',
    sensitivity: 'write',
    inputSchema: z
      .object({
        person_id: UuidSchema.optional(),
        organization_id: UuidSchema.optional(),
        direction: z.enum(['we_owe', 'they_owe']),
        body: safeText(2000),
        due_date: IsoDateSchema.optional(),
        occurred_at: IsoDateTimeSchema,
        source_system: z.enum(['gmail', 'calendar', 'linear', 'manual']),
        source_ref: safeText(300).optional(),
      })
      .strict(),
    handler: (ctx, i) => recordCommitment(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'set_crm_commitment_status',
    title: 'Markera åtagande som klart/avskrivet',
    sensitivity: 'write',
    inputSchema: z.object({ commitment_id: UuidSchema, status: z.enum(['open', 'done', 'dropped']) }).strict(),
    handler: (ctx, i: { commitment_id: string; status: 'open' | 'done' | 'dropped' }) =>
      setCommitmentStatus(ctx.client, ctx.companyId, ctx.userId, i.commitment_id, i.status),
  }),
  def({
    name: 'log_contact',
    title: 'Logga kontakt (snabbregistrering)',
    // Handgreppet som INTE ska kräva AI: fem sekunder, ett klick, klockan
    // nollställd. Går det inte snabbare än en papperslapp används det inte.
    sensitivity: 'write',
    inputSchema: z.object({
      organization_id: UuidSchema.optional(),
      person_id: UuidSchema.optional(),
      channel: z.enum(['email', 'meeting', 'call', 'note']).optional(),
      summary: safeText(2000).optional(),
      occurred_at: IsoDateTimeSchema.optional(),
    }).strict(),
    handler: (ctx, i) => logContact(ctx.client, ctx.companyId, ctx.userId, i as never),
  }),
  def({
    name: 'snooze_crm_commitment',
    title: 'Skjut upp åtagande i dagsytan',
    sensitivity: 'write',
    inputSchema: z.object({ commitment_id: UuidSchema, days: z.number().int().min(1).max(365) }).strict(),
    handler: (ctx, i: { commitment_id: string; days: number }) =>
      snoozeCommitment(ctx.client, ctx.companyId, ctx.userId, i.commitment_id, i.days),
  }),
  def({
    name: 'set_crm_relation_nudge',
    title: 'Skjut upp eller tysta en relations påminnelser',
    sensitivity: 'write',
    inputSchema: z.object({
      organization_id: UuidSchema,
      snooze_days: z.number().int().min(1).max(3650).optional(),
      muted: z.boolean().optional(),
      // F5: egen tystnadsgräns. null = återgå till bolagets standard.
      cadence_days: z.number().int().min(1).max(3650).nullable().optional(),
    }).strict(),
    handler: (ctx, i: { organization_id: string; snooze_days?: number; muted?: boolean; cadence_days?: number | null }) =>
      setRelationNudge(ctx.client, ctx.companyId, ctx.userId, i.organization_id,
        {
          snooze_days: i.snooze_days, muted: i.muted,
          ...('cadence_days' in i ? { cadence_days: i.cadence_days } : {}),
        }),
  }),
  // F5: dubbletter är ingen bugg i synken utan en följd av att data kommer från
  // flera håll — Gmail säger "Nordic Vision Retail", kundregistret säger
  // "Nordic Vision Retail AB". Utan sammanslagning delas historiken i två, och
  // ett kort som ser komplett ut saknar hälften.
  def({
    name: 'merge_crm_organizations',
    title: 'Slå ihop två organisationer (dubbletter)',
    sensitivity: 'sensitive',
    inputSchema: z.object({ keep_id: UuidSchema, merge_id: UuidSchema }).strict(),
    handler: (ctx, i: { keep_id: string; merge_id: string }) =>
      mergeOrganizations(ctx.client, ctx.companyId, ctx.userId, i.keep_id, i.merge_id),
  }),
  // Gravstenens ångerknapp. Sammanslagningen är känslig (den flyttar historik
  // och går inte att göra ogjord) — att lyfta ett namn ur gravstenen är
  // motsatsen: det förstör ingenting, det öppnar bara namnet för en egen rad
  // igen. Blir "Hermes" en riktig kund 2027 ska det inte kräva ett godkännande
  // att säga så; en ångerknapp bakom en kö är ingen ångerknapp. Går den fel går
  // den att gå tillbaka: nästa synk lägger upp raden, och den kan slås ihop igen.
  def({
    name: 'remove_crm_name_alias',
    title: 'Ta bort ett tidigare namn (öppna det för en egen relation igen)',
    sensitivity: 'write',
    inputSchema: z.object({ name: safeText(200) }).strict(),
    handler: (ctx, i: { name: string }) =>
      removeOrganizationNameAlias(ctx.client, ctx.companyId, ctx.userId, i.name),
  }),
  def({
    name: 'merge_crm_people',
    title: 'Slå ihop två personer (dubbletter)',
    sensitivity: 'sensitive',
    inputSchema: z.object({ keep_id: UuidSchema, merge_id: UuidSchema }).strict(),
    handler: (ctx, i: { keep_id: string; merge_id: string }) =>
      mergePeople(ctx.client, ctx.companyId, ctx.userId, i.keep_id, i.merge_id),
  }),
  def({
    name: 'search_crm',
    title: 'Sök i relationer, personer, kunder och leverantörer',
    sensitivity: 'read',
    inputSchema: z.object({ query: safeText(120), limit: z.number().int().min(1).max(50).optional() }).strict(),
    handler: (ctx, i: { query: string; limit?: number }) =>
      searchCrm(ctx.client, ctx.companyId, i.query, i.limit),
  }),
  def({
    name: 'list_crm_commitments',
    title: 'Lista åtaganden',
    sensitivity: 'read',
    inputSchema: z.object({
      status: z.enum(['open', 'done', 'dropped']).optional(),
      due_before: IsoDateSchema.optional(),
    }).strict(),
    handler: (ctx, i: { status?: 'open' | 'done' | 'dropped'; due_before?: string }) =>
      listCommitments(ctx.client, ctx.companyId, { status: i.status, due_before: i.due_before }),
  }),
  // --- CRM E4: API-kontraktet och härledningsjobben -------------------------
  // Källorna (mailindex, kalender, Linear) ligger utanför systemet. Det här
  // repot ringer dem aldrig — det tar emot en batch och räknar fram resten.
  def({
    name: 'ingest_crm_events',
    title: 'Ta emot kontaktpunkter och åtaganden (API-kontraktet)',
    sensitivity: 'write',
    inputSchema: z
      .object({
        events: z
          .array(
            z.object({
              kind: z.enum(['interaction', 'commitment']),
              // Naturliga nycklar: avsändaren känner inte våra uuid:n.
              organization: z.object({
                name: safeText(200),
                org_number: safeText(20).optional(),
                website: safeText(200).optional(),
              }).strict().optional(),
              person: z.object({
                name: safeText(150),
                email: EmailSchema.optional(),
                role_title: safeText(150).optional(),
                external_ref: safeText(300).optional(),
              }).strict().optional(),
              occurred_at: IsoDateTimeSchema,
              source_system: z.enum(['gmail', 'calendar', 'linear', 'manual']),
              // Källans eget id. Utan det kan samma händelse inte kännas igen
              // vid nästa körning — synken blir en dubblettgenerator.
              source_ref: safeText(300).optional(),
              channel: z.enum(['email', 'meeting', 'call', 'issue', 'note']).optional(),
              direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
              summary: safeText(2000).optional(),
              commitment_direction: z.enum(['we_owe', 'they_owe']).optional(),
              body: safeText(2000).optional(),
              due_date: IsoDateSchema.optional(),
            }).strict(),
          )
          .min(1)
          .max(500),
      })
      .strict(),
    handler: (ctx, i) => ingestCrmEvents(ctx.client, ctx.companyId, ctx.userId, (i as { events: never[] }).events),
  }),
  def({
    name: 'get_crm_thread',
    title: 'Relationens hela historia i en kronologi',
    sensitivity: 'read',
    inputSchema: z.object({
      organization_id: UuidSchema,
      filter: z.enum(['allt', 'kontakt', 'pengar', 'loften']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).strict(),
    handler: (ctx, i: { organization_id: string; filter?: string; limit?: number }) =>
      relationThread(ctx.client, ctx.companyId, i.organization_id, {
        filter: isThreadFilter(i.filter) ? i.filter : 'allt', limit: i.limit,
      }),
  }),
  def({
    name: 'crm_relation_state',
    title: 'Relationsläget per organisation (härlett)',
    sensitivity: 'read',
    inputSchema: z.object({ as_of: IsoDateSchema.optional() }).strict(),
    handler: (ctx, i: { as_of?: string }) => relationState(ctx.client, ctx.companyId, { as_of: i.as_of }),
  }),
  // Dagsytan som fråga. Vyn har haft den sedan F2, men AI:t har inte kunnat
  // ställa den — och "vad ska jag göra i dag?" är den vanligaste frågan i hela
  // ytan. Kapad på samma tal som vyn, av samma skäl: svaret ska gå att beta av.
  def({
    name: 'crm_today',
    title: 'Dagens lista: vilka att höra av sig till och vilka löften som förfaller',
    sensitivity: 'read',
    inputSchema: z.object({
      as_of: IsoDateSchema.optional(),
      silence_days: z.number().int().min(1).max(3650).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      horizon_days: z.number().int().min(0).max(365).optional(),
    }).strict(),
    handler: (ctx, i: { as_of?: string; silence_days?: number; limit?: number; horizon_days?: number }) =>
      todayView(ctx.client, ctx.companyId, i),
  }),
  def({
    name: 'crm_silence_report',
    title: 'Vem vi varit tysta mot för länge',
    sensitivity: 'read',
    inputSchema: z.object({
      as_of: IsoDateSchema.optional(),
      silence_days: z.number().int().min(1).max(3650).optional(),
    }).strict(),
    handler: (ctx, i: { as_of?: string; silence_days?: number }) =>
      silenceReport(ctx.client, ctx.companyId, { as_of: i.as_of, silence_days: i.silence_days }),
  }),
  def({
    name: 'crm_contact_suggestions',
    title: 'Vilka som bör kontaktas, och varför',
    // Läsning: ett FÖRSLAG. Systemet skickar aldrig något till en kund.
    sensitivity: 'read',
    inputSchema: z.object({
      as_of: IsoDateSchema.optional(),
      silence_days: z.number().int().min(1).max(3650).optional(),
    }).strict(),
    handler: (ctx, i: { as_of?: string; silence_days?: number }) =>
      contactSuggestions(ctx.client, ctx.companyId, { as_of: i.as_of, silence_days: i.silence_days }),
  }),
  def({
    name: 'get_crm_retention',
    title: 'Visa gallringspolicy för relationsdata',
    sensitivity: 'read',
    inputSchema: z.object({}).strict(),
    handler: (ctx) => getRetention(ctx.client, ctx.companyId),
  }),
  def({
    name: 'set_crm_retention',
    title: 'Sätt gallringspolicy för relationsdata (månader)',
    sensitivity: 'write',
    inputSchema: z.object({ retention_months: z.number().int().min(1).max(240).nullable() }).strict(),
    handler: (ctx, i: { retention_months: number | null }) =>
      setRetention(ctx.client, ctx.companyId, ctx.userId, i.retention_months),
  }),
  def({
    name: 'purge_crm_data',
    title: 'Gallra relationsdata äldre än angiven period',
    // Känslig: raderar data. Kräver mänskligt godkännande i Att göra, och
    // perioden gissas aldrig — den måste anges eller vara satt som policy.
    sensitivity: 'sensitive',
    inputSchema: z.object({ older_than_months: z.number().int().min(1).max(240).optional() }).strict(),
    handler: (ctx, i: { older_than_months?: number }) =>
      purgeCrmData(ctx.client, ctx.companyId, ctx.userId, { older_than_months: i.older_than_months }),
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
