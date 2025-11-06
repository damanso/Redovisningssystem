/**
 * Types for VAT (Moms) Reports and Skatteverket Integration
 */

// ============================================================================
// ENUMS
// ============================================================================

export enum TaxPeriodType {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  ANNUAL = 'annual',
}

export enum TaxPeriodStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  SUBMITTED = 'submitted',
}

export enum VATReportStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  SUBMITTED = 'submitted',
  REJECTED = 'rejected',
  ARCHIVED = 'archived',
}

export enum VATType {
  OUTGOING = 'outgoing', // Utgående moms
  INCOMING = 'incoming', // Ingående moms
}

export enum TransactionType {
  INVOICE = 'invoice',
  RECEIPT = 'receipt',
  JOURNAL_ENTRY = 'journal_entry',
  ADJUSTMENT = 'adjustment',
}

export enum SubmissionMethod {
  API = 'api',
  MANUAL = 'manual',
  FILE_EXPORT = 'file_export',
}

export enum SubmissionStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  FAILED = 'failed',
}

export enum VATRate {
  STANDARD = 25, // Standard rate for most goods/services
  REDUCED_12 = 12, // Food, hotel services
  REDUCED_6 = 6, // Newspapers, books, cultural events, passenger transport
  ZERO = 0, // Exports, international services
}

// ============================================================================
// TAX PERIOD TYPES
// ============================================================================

export interface TaxPeriod {
  id: string;
  company_id: string;
  period_type: TaxPeriodType;
  period_year: number;
  period_number: number; // 1-12 for monthly, 1-4 for quarterly, 1 for annual
  start_date: string; // ISO date string
  end_date: string; // ISO date string
  status: TaxPeriodStatus;
  due_date?: string; // ISO date string - Skatteverket submission deadline
  created_at: string;
  updated_at: string;
}

export interface CreateTaxPeriodInput {
  company_id: string;
  period_type: TaxPeriodType;
  period_year: number;
  period_number: number;
  start_date: string;
  end_date: string;
  due_date?: string;
}

export interface UpdateTaxPeriodInput {
  status?: TaxPeriodStatus;
  due_date?: string;
}

// ============================================================================
// VAT REPORT TYPES
// ============================================================================

export interface VATReport {
  id: string;
  company_id: string;
  tax_period_id: string;
  report_number?: string;
  report_date: string; // ISO date string
  period_start: string; // ISO date string
  period_end: string; // ISO date string

  // VAT amounts (stored in öre/cents in DB, converted to SEK for API)
  outgoing_vat_25: number;
  outgoing_vat_12: number;
  outgoing_vat_6: number;
  outgoing_vat_0: number;
  incoming_vat: number;
  total_outgoing_vat: number;
  net_vat_amount: number; // Positive = to pay, Negative = to receive

  // Status
  status: VATReportStatus;
  approved_by?: string;
  approved_at?: string;

  // Metadata
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;

  // Related data (populated in joins)
  tax_period?: TaxPeriod;
  lines?: VATReportLine[];
  submissions?: SkatteverketSubmission[];
}

export interface VATReportLine {
  id: string;
  vat_report_id: string;
  transaction_type: TransactionType;
  transaction_id?: string;
  transaction_date: string; // ISO date string
  transaction_number?: string; // Invoice/receipt number

  // Account info
  account_number: string;
  account_name?: string;

  // Amounts (in SEK)
  base_amount: number; // Amount excluding VAT
  vat_rate?: number; // VAT percentage
  vat_amount: number;
  total_amount: number; // Including VAT

  // Classification
  vat_type: VATType;
  description?: string;

  created_at: string;
}

export interface CreateVATReportInput {
  company_id: string;
  tax_period_id: string;
  period_start: string;
  period_end: string;
  notes?: string;
}

export interface UpdateVATReportInput {
  status?: VATReportStatus;
  notes?: string;
  approved_by?: string;
}

export interface GenerateVATReportInput {
  company_id: string;
  period_start: string;
  period_end: string;
  tax_period_id?: string;
}

// ============================================================================
// SKATTEVERKET SUBMISSION TYPES
// ============================================================================

export interface SkatteverketSubmission {
  id: string;
  vat_report_id: string;
  company_id: string;

  // Submission details
  submission_date: string;
  submission_method: SubmissionMethod;

  // API tracking
  api_request_id?: string;
  api_response_status?: string;
  api_response_message?: string;
  api_response_data?: Record<string, any>;

  // File export
  export_file_path?: string;
  export_format?: string;

  // Auth
  certificate_thumbprint?: string;

  // Status
  status: SubmissionStatus;
  submitted_by?: string;

  created_at: string;
  updated_at: string;
}

export interface CreateSubmissionInput {
  vat_report_id: string;
  company_id: string;
  submission_method: SubmissionMethod;
  submitted_by?: string;
}

export interface UpdateSubmissionInput {
  status?: SubmissionStatus;
  api_request_id?: string;
  api_response_status?: string;
  api_response_message?: string;
  api_response_data?: Record<string, any>;
}

// ============================================================================
// SKATTEVERKET API TYPES
// ============================================================================

/**
 * Configuration for Skatteverket API client
 */
export interface SkatteverketConfig {
  apiUrl: string;
  testMode: boolean;
  certificatePath?: string;
  certificatePassword?: string;
  apiKey?: string;
  timeout?: number;
}

/**
 * Skatteverket API authentication credentials
 */
export interface SkatteverketCredentials {
  organizationNumber: string; // Swedish org number (10 digits)
  certificateThumbprint?: string;
  apiKey?: string;
}

/**
 * VAT report submission payload for Skatteverket API
 * Based on Skatteverket's XML/JSON format requirements
 */
export interface SkatteverketVATSubmission {
  // Company identification
  organizationNumber: string;
  companyName: string;

  // Reporting period
  reportingYear: number;
  reportingPeriod: number; // Month (1-12) or Quarter (1-4)
  periodType: 'M' | 'Q' | 'A'; // Monthly, Quarterly, Annual

  // VAT amounts (Skatteverket Box numbers)
  box05?: number; // Utgående moms 25%
  box06?: number; // Utgående moms 12%
  box07?: number; // Utgående moms 6%
  box10?: number; // Omsättning utan moms
  box20?: number; // Försäljning varor till annat EU-land
  box21?: number; // Försäljning tjänster till annat EU-land
  box30?: number; // Inköp varor från annat EU-land
  box31?: number; // Inköp tjänster från annat EU-land
  box35?: number; // Övriga uttag
  box48?: number; // Ingående moms
  box49?: number; // Moms att betala eller återfå

  // Metadata
  declarationType?: 'ordinarie' | 'rättelse'; // Regular or correction
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
}

/**
 * Response from Skatteverket API after submission
 */
export interface SkatteverketSubmissionResponse {
  success: boolean;
  requestId?: string;
  status: 'accepted' | 'rejected' | 'pending' | 'error';
  message?: string;
  errors?: Array<{
    code: string;
    field?: string;
    message: string;
  }>;
  submissionDate?: string;
  referenceNumber?: string;
}

// ============================================================================
// VAT CALCULATION HELPERS
// ============================================================================

/**
 * Helper type for VAT calculations
 */
export interface VATCalculation {
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
}

/**
 * Aggregated VAT summary for a period
 */
export interface VATSummary {
  period_start: string;
  period_end: string;
  outgoing_vat_25: number;
  outgoing_vat_12: number;
  outgoing_vat_6: number;
  outgoing_vat_0: number;
  total_outgoing_vat: number;
  incoming_vat: number;
  net_vat_amount: number;
  transaction_count: number;
}

// ============================================================================
// QUERY/FILTER TYPES
// ============================================================================

export interface VATReportFilters {
  company_id?: string;
  tax_period_id?: string;
  status?: VATReportStatus;
  period_start?: string;
  period_end?: string;
  created_after?: string;
  created_before?: string;
}

export interface TaxPeriodFilters {
  company_id?: string;
  period_type?: TaxPeriodType;
  period_year?: number;
  status?: TaxPeriodStatus;
}
