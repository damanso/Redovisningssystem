export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface RecurringInvoice {
  id: string;
  company_id: string;
  customer_id: string;
  template_name: string;
  payment_terms: number;
  currency: string;
  reference?: string;
  notes?: string;
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: string;
  end_date?: string;
  next_generation_date: string;
  status: RecurringStatus;
  last_generated_date?: string;
  generated_count: number;
  max_occurrences?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  generated_date: string;
  period_start?: string;
  period_end?: string;
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

export interface RecurringInvoiceStats {
  total_recurring: number;
  active_recurring: number;
  paused_recurring: number;
  total_generated: number;
  pending_generation: number;
}
