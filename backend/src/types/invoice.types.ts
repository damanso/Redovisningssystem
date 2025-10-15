export interface Invoice {
  id: string;
  company_id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: Date;
  due_date: Date;
  payment_terms: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  currency: string;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  paid_date?: Date;
  sent_date?: Date;
  reference?: string;
  notes?: string;
  pdf_url?: string;
  ocr_number?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  // Extended fields from joins
  customer_name?: string;
  customer_email?: string;
  lines?: InvoiceLine[];
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  article_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  vat_rate: number;
  amount: number;
  line_order: number;
}

export interface CreateInvoiceDto {
  customer_id: string;
  invoice_date: string;
  due_date?: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  lines: {
    article_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    vat_rate: number;
  }[];
}

export interface UpdateInvoiceDto {
  invoice_date?: string;
  due_date?: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  lines?: {
    article_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    vat_rate: number;
  }[];
}

export interface InvoiceFilters {
  customer_id?: string;
  status?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface InvoiceListResponse {
  invoices: Invoice[];
  total: number;
}

export interface InvoiceStats {
  total_invoices: number;
  draft_invoices: number;
  sent_invoices: number;
  paid_invoices: number;
  overdue_invoices: number;
  total_outstanding: number;
  total_paid: number;
}

export interface MarkAsPaidDto {
  paid_amount: number;
  paid_date: string;
}
