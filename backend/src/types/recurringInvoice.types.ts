export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface RecurringInvoice {
  id: string;
  company_id: string;
  customer_id: string;

  // Template information
  template_name: string;

  // Invoice details
  payment_terms: number;
  currency: string;
  reference?: string;
  notes?: string;

  // Recurrence settings
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: Date;
  end_date?: Date;
  next_generation_date: Date;

  // Status
  status: RecurringStatus;

  // Tracking
  last_generated_date?: Date;
  generated_count: number;
  max_occurrences?: number;

  // Metadata
  created_by: string;
  created_at: Date;
  updated_at: Date;

  // Extended fields from joins
  customer_name?: string;
  customer_email?: string;
  lines?: RecurringInvoiceLine[];
}

export interface RecurringInvoiceLine {
  id: string;
  recurring_invoice_id: string;
  article_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  vat_rate: number;
  line_order: number;
}

export interface RecurringInvoiceHistory {
  id: string;
  recurring_invoice_id: string;
  invoice_id: string;
  generated_date: Date;
  period_start?: Date;
  period_end?: Date;

  // Extended fields
  invoice_number?: string;
  invoice_status?: string;
  invoice_total?: number;
}

export interface CreateRecurringInvoiceDto {
  customer_id: string;
  template_name: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  frequency: RecurringFrequency;
  interval_count?: number;
  start_date: string;
  end_date?: string;
  max_occurrences?: number;
  lines: {
    article_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    vat_rate: number;
  }[];
}

export interface UpdateRecurringInvoiceDto {
  template_name?: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  frequency?: RecurringFrequency;
  interval_count?: number;
  start_date?: string;
  end_date?: string;
  max_occurrences?: number;
  lines?: {
    article_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    vat_rate: number;
  }[];
}

export interface RecurringInvoiceFilters {
  customer_id?: string;
  status?: RecurringStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RecurringInvoiceListResponse {
  recurring_invoices: RecurringInvoice[];
  total: number;
}

export interface RecurringInvoiceStats {
  total_recurring: number;
  active_recurring: number;
  paused_recurring: number;
  total_generated: number;
  pending_generation: number; // Count of recurring invoices due for generation
}

export interface GenerateInvoiceFromRecurringDto {
  generation_date?: string; // Defaults to today
}
