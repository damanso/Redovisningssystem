export interface Receipt {
  id: string;
  company_id: string;
  supplier_id?: string;
  supplier_name?: string;
  receipt_date: Date;
  amount: number;
  vat_amount?: number;
  total_amount: number;
  category?: string;
  description?: string;
  file_url: string;
  file_type: string;
  status: 'pending' | 'processed' | 'booked';
  ocr_data?: any;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateReceiptDto {
  supplier_id?: string;
  receipt_date: string;
  amount: number;
  vat_amount?: number;
  category?: string;
  description?: string;
}

export interface UpdateReceiptDto {
  supplier_id?: string;
  receipt_date?: string;
  amount?: number;
  vat_amount?: number;
  category?: string;
  description?: string;
  status?: 'pending' | 'processed' | 'booked';
  ocr_data?: any;
}

export interface ReceiptFilters {
  supplier_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  category?: string;
}

export interface ReceiptStats {
  total_receipts: number;
  pending_receipts: number;
  processed_receipts: number;
  booked_receipts: number;
  total_amount: number;
  total_vat: number;
}
