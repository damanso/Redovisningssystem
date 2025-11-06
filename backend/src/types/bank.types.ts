/**
 * Bank Integration Types
 * Types for Open Banking integration with Tink
 */

export interface BankConnection {
  id: string;
  company_id: string;
  provider: 'tink' | 'nordigen' | 'other';
  provider_connection_id: string;
  bank_name?: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: Date;
  last_sync_at?: Date;
  error_message?: string;
  metadata?: Record<string, any>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface BankAccount {
  id: string;
  bank_connection_id: string;
  company_id: string;
  provider_account_id: string;
  account_number?: string;
  clearing_number?: string;
  account_name: string;
  account_type?: string;
  currency: string;
  balance?: number;
  available_balance?: number;
  last_synced_at?: Date;
  is_active: boolean;
  bas_account_number?: number; // Link to accounting chart
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  company_id: string;
  provider_transaction_id?: string;
  transaction_date: Date;
  booking_date?: Date;
  amount: number;
  currency: string;
  description?: string;
  counterparty_name?: string;
  counterparty_account?: string;
  reference?: string;
  category?: string;
  status: 'unmatched' | 'matched' | 'reconciled' | 'ignored';
  is_reconciled: boolean;
  reconciled_at?: Date;
  reconciled_by?: string;
  journal_entry_id?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionMatch {
  id: string;
  bank_transaction_id: string;
  match_type: 'invoice' | 'receipt' | 'manual';
  match_id: string; // Invoice or receipt ID
  matched_amount: number;
  confidence_score?: number; // 0.00 to 1.00
  match_method?: 'automatic' | 'manual' | 'suggested';
  notes?: string;
  created_by: string;
  created_at: Date;
}

export interface BankSyncLog {
  id: string;
  bank_connection_id: string;
  sync_type: 'full' | 'incremental' | 'manual';
  status: 'started' | 'completed' | 'failed';
  transactions_imported: number;
  transactions_matched: number;
  error_message?: string;
  started_at: Date;
  completed_at?: Date;
  metadata?: Record<string, any>;
}

// DTOs for API requests/responses

export interface CreateBankConnectionRequest {
  company_id: string;
  provider?: 'tink' | 'nordigen';
  authorization_code?: string;
  redirect_uri?: string;
}

export interface CreateBankConnectionResponse {
  connection: BankConnection;
  accounts: BankAccount[];
  authorization_url?: string; // For OAuth flow
}

export interface SyncBankAccountRequest {
  from_date?: Date;
  to_date?: Date;
  force_full_sync?: boolean;
}

export interface SyncBankAccountResponse {
  sync_log: BankSyncLog;
  imported_transactions: number;
  new_transactions: BankTransaction[];
}

export interface MatchTransactionRequest {
  match_type: 'invoice' | 'receipt' | 'manual';
  match_id: string;
  matched_amount: number;
  notes?: string;
}

export interface MatchTransactionResponse {
  match: TransactionMatch;
  transaction: BankTransaction;
}

export interface ReconcileTransactionRequest {
  create_journal_entry?: boolean;
  account_mappings?: {
    debit_account?: number;
    credit_account?: number;
  };
}

export interface ReconcileTransactionResponse {
  transaction: BankTransaction;
  journal_entry_id?: string;
}

export interface BankTransactionWithMatches extends BankTransaction {
  matches?: TransactionMatch[];
  account?: BankAccount;
}

export interface BankAccountWithTransactions extends BankAccount {
  connection?: BankConnection;
  transactions?: BankTransaction[];
  unmatched_count?: number;
}

// Tink API specific types

export interface TinkAuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  scope: string;
  market: string; // 'SE' for Sweden
  locale: string; // 'sv_SE'
  state?: string;
}

export interface TinkTokenRequest {
  code: string;
  client_id: string;
  client_secret: string;
  grant_type: 'authorization_code' | 'refresh_token';
  refresh_token?: string;
}

export interface TinkTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface TinkAccount {
  id: string;
  name: string;
  type: string;
  accountNumber?: string;
  balance?: number;
  currencyCode: string;
  financialInstitutionId: string;
}

export interface TinkTransaction {
  id: string;
  accountId: string;
  amount: number;
  currencyCode: string;
  date: string;
  description: string;
  type: 'DEBIT' | 'CREDIT';
  status: string;
  counterpartyName?: string;
  reference?: string;
}

// Matching algorithms

export interface TransactionMatchCandidate {
  invoice_id?: string;
  receipt_id?: string;
  type: 'invoice' | 'receipt';
  amount: number;
  date: Date;
  reference?: string;
  counterparty_name?: string;
  confidence_score: number;
  match_reasons: string[];
}

export interface MatchingCriteria {
  amount_tolerance?: number; // e.g., 0.01 for ±1 SEK
  date_range_days?: number; // e.g., 30 days before/after
  require_reference_match?: boolean;
  min_confidence_score?: number; // e.g., 0.7
}
