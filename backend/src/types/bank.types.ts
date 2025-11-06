// Bank Transaction Types
export interface BankTransaction {
  id: string;
  company_id: string;
  transaction_date: Date;
  booking_date?: Date;
  transaction_id?: string;
  reference_number?: string;
  transaction_type: 'debit' | 'credit' | 'fee' | 'interest';
  description: string;
  category?: string;
  amount: number;
  currency: string;
  balance_after?: number;
  linked_invoice_id?: string;
  linked_receipt_id?: string;
  linked_expense_id?: string;
  linked_salary_id?: string;
  import_source: 'file_upload' | 'api_swedbank' | 'api_handelsbanken' | 'manual';
  import_batch_id?: string;
  file_name?: string;
  is_duplicate: boolean;
  duplicate_of_id?: string;
  hash?: string;
  status: 'unmatched' | 'matched' | 'ignored' | 'duplicate';
  is_reconciled: boolean;
  reconciled_at?: Date;
  reconciled_by?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateBankTransactionDto {
  transaction_date: string;
  booking_date?: string;
  transaction_id?: string;
  reference_number?: string;
  transaction_type: 'debit' | 'credit' | 'fee' | 'interest';
  description: string;
  category?: string;
  amount: number;
  currency?: string;
  balance_after?: number;
  import_source: 'file_upload' | 'api_swedbank' | 'api_handelsbanken' | 'manual';
  file_name?: string;
}

export interface ImportTransactionsDto {
  transactions: CreateBankTransactionDto[];
  import_batch_id: string;
}

export interface BankTransactionFilters {
  start_date?: string;
  end_date?: string;
  transaction_type?: string;
  status?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BankTransactionListResponse {
  transactions: BankTransaction[];
  total: number;
  duplicates: BankTransaction[];
}

// Planned Expense Types
export interface PlannedExpense {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  category?: string;
  amount: number;
  currency: string;
  due_date: Date;
  is_recurring: boolean;
  recurrence_frequency?: 'monthly' | 'quarterly' | 'yearly';
  recurrence_day?: number;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paid_via_transaction_id?: string;
  paid_date?: Date;
  supplier_id?: string;
  recipient_name?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePlannedExpenseDto {
  name: string;
  description?: string;
  category?: string;
  amount: number;
  currency?: string;
  due_date: string;
  is_recurring?: boolean;
  recurrence_frequency?: 'monthly' | 'quarterly' | 'yearly';
  recurrence_day?: number;
  supplier_id?: string;
  recipient_name?: string;
}

export interface UpdatePlannedExpenseDto {
  name?: string;
  description?: string;
  category?: string;
  amount?: number;
  due_date?: string;
  is_recurring?: boolean;
  recurrence_frequency?: 'monthly' | 'quarterly' | 'yearly';
  recurrence_day?: number;
  status?: 'pending' | 'paid' | 'overdue' | 'cancelled';
  supplier_id?: string;
  recipient_name?: string;
}

// Salary Withdrawal Types
export interface SalaryWithdrawal {
  id: string;
  company_id: string;
  requested_by: string;
  requested_amount: number;
  requested_date: Date;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  approved_by?: string;
  approved_at?: Date;
  approved_amount?: number;
  rejection_reason?: string;
  payment_date?: Date;
  paid_via_transaction_id?: string;
  gross_amount?: number;
  tax_amount?: number;
  net_amount?: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  // Extended fields
  requested_by_name?: string;
  approved_by_name?: string;
}

export interface CreateSalaryWithdrawalDto {
  requested_amount: number;
  requested_date: string;
  notes?: string;
}

export interface ApproveSalaryWithdrawalDto {
  approved_amount: number;
  gross_amount?: number;
  tax_amount?: number;
  net_amount?: number;
  notes?: string;
}

export interface RejectSalaryWithdrawalDto {
  rejection_reason: string;
}

// Expense Reimbursement Types
export interface ExpenseReimbursement {
  id: string;
  company_id: string;
  claimed_by: string;
  claim_date: Date;
  expense_date: Date;
  description: string;
  category?: string;
  amount: number;
  currency: string;
  receipt_id?: string;
  additional_receipts?: string[];
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  approved_by?: string;
  approved_at?: Date;
  approved_amount?: number;
  rejection_reason?: string;
  payment_date?: Date;
  paid_via_transaction_id?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  // Extended fields
  claimed_by_name?: string;
  approved_by_name?: string;
}

export interface CreateExpenseReimbursementDto {
  claim_date: string;
  expense_date: string;
  description: string;
  category?: string;
  amount: number;
  currency?: string;
  receipt_id?: string;
  additional_receipts?: string[];
  notes?: string;
}

export interface ApproveExpenseReimbursementDto {
  approved_amount: number;
  notes?: string;
}

export interface RejectExpenseReimbursementDto {
  rejection_reason: string;
}

// Cash Flow Types
export interface CashFlowSettings {
  id: string;
  company_id: string;
  minimum_balance_amount: number;
  safety_margin_percentage: number;
  planning_horizon_days: number;
  auto_categorization_enabled: boolean;
  low_balance_alert_enabled: boolean;
  low_balance_threshold?: number;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateCashFlowSettingsDto {
  minimum_balance_amount?: number;
  safety_margin_percentage?: number;
  planning_horizon_days?: number;
  auto_categorization_enabled?: boolean;
  low_balance_alert_enabled?: boolean;
  low_balance_threshold?: number;
}

export interface CashFlowSummary {
  current_balance: number;
  total_income: number;
  total_expenses: number;
  net_cash_flow: number;

  // Upcoming (planned)
  upcoming_income: number; // Unpaid invoices
  upcoming_expenses: number; // Planned expenses

  // Available funds calculation
  projected_balance: number; // current + upcoming income - upcoming expenses
  safety_margin: number; // Based on settings
  minimum_balance: number; // Based on settings
  available_for_withdrawal: number; // What can be safely withdrawn

  // Details
  unpaid_invoices_count: number;
  unpaid_invoices_amount: number;
  planned_expenses_count: number;
  planned_expenses_amount: number;
  pending_salary_withdrawals_count: number;
  pending_salary_withdrawals_amount: number;
  pending_expense_reimbursements_count: number;
  pending_expense_reimbursements_amount: number;

  // Warnings
  is_low_balance: boolean;
  warnings: string[];
}

export interface CalculateAvailableFundsDto {
  exclude_salary_amount?: number; // Simulate salary withdrawal
  exclude_expense_amount?: number; // Simulate expense payment
  planning_days?: number; // Override default planning horizon
}

export interface AvailableFundsCalculation {
  requested_amount: number;
  available_amount: number;
  can_afford: boolean;
  remaining_after_withdrawal: number;
  warnings: string[];
  breakdown: {
    current_balance: number;
    upcoming_income: number;
    upcoming_expenses: number;
    safety_margin: number;
    minimum_balance: number;
  };
}

// File Upload Types
export interface TransactionFileUpload {
  file: Express.Multer.File;
  file_type: 'csv' | 'excel' | 'ofx' | 'qif';
  bank_name?: string; // 'swedbank' | 'handelsbanken' | 'seb' | 'nordea' | 'generic'
  date_format?: string; // For custom parsing
}

export interface ParsedTransaction {
  transaction_date: string;
  booking_date?: string;
  description: string;
  amount: number;
  balance_after?: number;
  reference_number?: string;
  transaction_id?: string;
  raw_data?: any; // Original row for debugging
}

export interface TransactionImportResult {
  success: boolean;
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  import_batch_id: string;
  duplicates: BankTransaction[];
  errors: Array<{
    row: number;
    error: string;
    data?: any;
  }>;
}
