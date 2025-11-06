/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transaction Types (Frontend)
 */

export type TransactionType =
  | 'sale'
  | 'purchase'
  | 'loan'
  | 'transfer'
  | 'expense_allocation'
  | 'other';

export type TransactionStatus =
  | 'pending'
  | 'approved'
  | 'completed'
  | 'cancelled';

export interface CrossCompanyTransaction {
  id: string;
  from_company_id: string;
  to_company_id: string;
  transaction_type: TransactionType;
  description: string;
  amount: number;
  currency: string;
  transaction_date: string;
  status: TransactionStatus;
  from_invoice_id?: string;
  to_invoice_id?: string;
  is_reconciled: boolean;
  reconciled_at?: string;
  reconciled_by?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CrossCompanyTransactionWithDetails extends CrossCompanyTransaction {
  from_company_name: string;
  to_company_name: string;
  created_by_name: string;
}

export interface CreateCrossCompanyTransactionDto {
  from_company_id: string;
  to_company_id: string;
  transaction_type: TransactionType;
  description: string;
  amount: number;
  currency?: string;
  transaction_date: string;
  from_invoice_id?: string;
  to_invoice_id?: string;
}

export interface UpdateCrossCompanyTransactionDto {
  transaction_type?: TransactionType;
  description?: string;
  amount?: number;
  currency?: string;
  transaction_date?: string;
  status?: TransactionStatus;
  from_invoice_id?: string;
  to_invoice_id?: string;
}

export interface TransactionSummary {
  total_transactions: number;
  total_outgoing: number;
  total_incoming: number;
  reconciled_count: number;
  pending_count: number;
}
