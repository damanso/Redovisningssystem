export interface InvoicePDFData {
  invoice: {
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    ocr_number: string;
    reference?: string;
    notes?: string;
  };
  company: {
    name: string;
    org_number: string;
    address?: string;
    postal_code?: string;
    city?: string;
    phone?: string;
    email?: string;
    website?: string;
    logo_url?: string;
    bank_account?: string;
    vat_number?: string;
  };
  customer: {
    name: string;
    org_number?: string;
    address?: string;
    postal_code?: string;
    city?: string;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unit: string;
    unit_price: number;
    vat_rate: number;
    amount: number;
  }>;
  totals: {
    subtotal: number;
    vat_amount: number;
    total_amount: number;
  };
}

export interface PDFGenerationResult {
  filePath: string;
  fileName: string;
  buffer: Buffer;
}
