export interface BASAccount {
  account_number: number;
  account_name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  description?: string;
}

export interface JournalEntry {
  id: string;
  company_id: string;
  entry_date: Date;
  description?: string;
  reference_type?: string;
  reference_id?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  lines?: JournalEntryLine[];
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_number: number;
  account_name?: string;  // Joined from bas_accounts
  debit: number;
  credit: number;
  description?: string;
  line_order: number;
}

export interface CreateJournalEntryDto {
  entry_date: string;
  description?: string;
  reference_type?: string;
  reference_id?: string;
  lines: Array<{
    account_number: number;
    debit?: number;
    credit?: number;
    description?: string;
  }>;
}

export interface JournalEntryFilters {
  start_date?: string;
  end_date?: string;
  account_number?: number;
  reference_type?: string;
}

export interface AccountBalance {
  account_number: number;
  account_name: string;
  account_type: string;
  debit_total: number;
  credit_total: number;
  balance: number;
}

export interface TrialBalance {
  assets_total: number;
  liabilities_total: number;
  equity_total: number;
  revenue_total: number;
  expense_total: number;
  accounts: AccountBalance[];
}
