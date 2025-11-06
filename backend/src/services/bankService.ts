/**
 * Bank Service
 * Handles bank connections, transaction imports, matching, and reconciliation
 */

import { query } from '../config/database.js';
import tinkService from './tinkService.js';
import * as auditService from './auditService.js';
import * as accountingService from './accountingService.js';
import {
  BankConnection,
  BankAccount,
  BankTransaction,
  TransactionMatch,
  BankSyncLog,
  CreateBankConnectionRequest,
  CreateBankConnectionResponse,
  SyncBankAccountRequest,
  SyncBankAccountResponse,
  MatchTransactionRequest,
  MatchTransactionResponse,
  ReconcileTransactionRequest,
  ReconcileTransactionResponse,
  TransactionMatchCandidate,
  MatchingCriteria,
  BankTransactionWithMatches,
  BankAccountWithTransactions,
} from '../types/bank.types.js';

/**
 * Create a new bank connection via Tink
 */
export const createBankConnection = async (
  userId: string,
  data: CreateBankConnectionRequest
): Promise<CreateBankConnectionResponse> => {
  const provider = data.provider || 'tink';

  if (provider === 'tink') {
    if (!tinkService.isConfigured()) {
      throw new Error('Tink integration is not configured. Please set TINK_CLIENT_ID and TINK_CLIENT_SECRET.');
    }

    // If authorization_code is provided, complete the connection
    if (data.authorization_code) {
      return await completeTinkConnection(userId, data.company_id, data.authorization_code);
    }

    // Otherwise, generate authorization URL
    const state = `${data.company_id}:${userId}:${Date.now()}`;
    const authUrl = tinkService.generateAuthorizationUrl(state);

    // Create pending connection
    const result = await query(
      `INSERT INTO bank_connections
       (company_id, provider, provider_connection_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.company_id, provider, state, 'pending', userId]
    );

    return {
      connection: result.rows[0],
      accounts: [],
      authorization_url: authUrl,
    };
  }

  throw new Error(`Provider ${provider} is not supported`);
};

/**
 * Complete Tink connection after OAuth callback
 */
const completeTinkConnection = async (
  userId: string,
  companyId: string,
  authorizationCode: string
): Promise<CreateBankConnectionResponse> => {
  try {
    // Exchange authorization code for tokens
    const tokens = await tinkService.exchangeAuthorizationCode(authorizationCode);

    // Get accounts
    const tinkAccounts = await tinkService.getAccounts(tokens.access_token);

    // Get or create connection
    const connectionResult = await query(
      `INSERT INTO bank_connections
       (company_id, provider, provider_connection_id, status, access_token, refresh_token,
        token_expires_at, last_sync_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, provider_connection_id)
       DO UPDATE SET
         status = $4,
         access_token = $5,
         refresh_token = $6,
         token_expires_at = $7,
         last_sync_at = $8,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        companyId,
        'tink',
        authorizationCode,
        'active',
        tokens.access_token,
        tokens.refresh_token,
        new Date(Date.now() + tokens.expires_in * 1000),
        new Date(),
        userId,
      ]
    );

    const connection: BankConnection = connectionResult.rows[0];

    // Create bank accounts
    const accounts: BankAccount[] = [];
    for (const tinkAccount of tinkAccounts) {
      const accountResult = await query(
        `INSERT INTO bank_accounts
         (bank_connection_id, company_id, provider_account_id, account_number,
          account_name, account_type, currency, balance, is_active, bas_account_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (bank_connection_id, provider_account_id)
         DO UPDATE SET
           account_name = $5,
           balance = $8,
           last_synced_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          connection.id,
          companyId,
          tinkAccount.id,
          tinkAccount.accountNumber,
          tinkAccount.name,
          tinkAccount.type,
          tinkAccount.currencyCode || 'SEK',
          tinkAccount.balance || 0,
          true,
          1930, // Default to "Företagskonto" in BAS
        ]
      );

      accounts.push(accountResult.rows[0]);
    }

    // Log audit
    await auditService.createAuditLog({
      user_id: userId,
      company_id: companyId,
      action: 'bank_connection_created',
      resource_type: 'bank_connection',
      resource_id: connection.id,
      details: { provider: 'tink', accounts_count: accounts.length },
    });

    return {
      connection,
      accounts,
    };
  } catch (error: any) {
    console.error('Error completing Tink connection:', error);
    throw new Error(`Failed to complete bank connection: ${error.message}`);
  }
};

/**
 * Get all bank connections for a company
 */
export const getBankConnections = async (companyId: string): Promise<BankConnection[]> => {
  const result = await query(
    `SELECT * FROM bank_connections WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId]
  );
  return result.rows;
};

/**
 * Get bank connection by ID
 */
export const getBankConnectionById = async (
  connectionId: string,
  companyId: string
): Promise<BankConnection> => {
  const result = await query(
    `SELECT * FROM bank_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Bank connection not found');
  }

  return result.rows[0];
};

/**
 * Get all bank accounts for a connection
 */
export const getBankAccounts = async (
  connectionId: string,
  companyId: string
): Promise<BankAccountWithTransactions[]> => {
  const result = await query(
    `SELECT ba.*, bc.bank_name, bc.status as connection_status,
      (SELECT COUNT(*) FROM bank_transactions WHERE bank_account_id = ba.id AND status = 'unmatched') as unmatched_count
     FROM bank_accounts ba
     JOIN bank_connections bc ON ba.bank_connection_id = bc.id
     WHERE ba.bank_connection_id = $1 AND ba.company_id = $2
     ORDER BY ba.created_at DESC`,
    [connectionId, companyId]
  );

  return result.rows;
};

/**
 * Get bank account by ID
 */
export const getBankAccountById = async (
  accountId: string,
  companyId: string
): Promise<BankAccount> => {
  const result = await query(
    `SELECT * FROM bank_accounts WHERE id = $1 AND company_id = $2`,
    [accountId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Bank account not found');
  }

  return result.rows[0];
};

/**
 * Sync bank account transactions
 */
export const syncBankAccount = async (
  accountId: string,
  companyId: string,
  userId: string,
  options: SyncBankAccountRequest = {}
): Promise<SyncBankAccountResponse> => {
  const account = await getBankAccountById(accountId, companyId);

  const connectionResult = await query(
    `SELECT * FROM bank_connections WHERE id = $1`,
    [account.bank_connection_id]
  );

  if (connectionResult.rows.length === 0) {
    throw new Error('Bank connection not found');
  }

  const connection: BankConnection = connectionResult.rows[0];

  // Create sync log
  const syncLogResult = await query(
    `INSERT INTO bank_sync_logs
     (bank_connection_id, sync_type, status, started_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [connection.id, options.force_full_sync ? 'full' : 'incremental', 'started', new Date()]
  );

  const syncLog: BankSyncLog = syncLogResult.rows[0];

  try {
    // Refresh token if needed
    let accessToken = connection.access_token;
    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
      if (!connection.refresh_token) {
        throw new Error('Access token expired and no refresh token available');
      }

      const tokens = await tinkService.refreshAccessToken(connection.refresh_token);
      accessToken = tokens.access_token;

      // Update connection
      await query(
        `UPDATE bank_connections
         SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [tokens.access_token, tokens.refresh_token, new Date(Date.now() + tokens.expires_in * 1000), connection.id]
      );
    }

    // Fetch transactions from Tink
    const fromDate = options.from_date || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default 90 days
    const toDate = options.to_date || new Date();

    const tinkTransactions = await tinkService.getTransactions(
      accessToken!,
      account.provider_account_id,
      fromDate,
      toDate
    );

    // Import transactions
    const newTransactions: BankTransaction[] = [];
    let importedCount = 0;

    for (const tinkTx of tinkTransactions) {
      const result = await query(
        `INSERT INTO bank_transactions
         (bank_account_id, company_id, provider_transaction_id, transaction_date,
          booking_date, amount, currency, description, counterparty_name, reference, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (bank_account_id, provider_transaction_id)
         DO NOTHING
         RETURNING *`,
        [
          accountId,
          companyId,
          tinkTx.id,
          tinkTx.date,
          tinkTx.date,
          tinkTx.amount,
          tinkTx.currencyCode || 'SEK',
          tinkTx.description,
          tinkTx.counterpartyName,
          tinkTx.reference,
          'unmatched',
        ]
      );

      if (result.rows.length > 0) {
        newTransactions.push(result.rows[0]);
        importedCount++;
      }
    }

    // Update sync log
    await query(
      `UPDATE bank_sync_logs
       SET status = $1, transactions_imported = $2, completed_at = $3
       WHERE id = $4`,
      ['completed', importedCount, new Date(), syncLog.id]
    );

    // Update account last sync
    await query(
      `UPDATE bank_accounts
       SET last_synced_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [accountId]
    );

    // Log audit
    await auditService.createAuditLog({
      user_id: userId,
      company_id: companyId,
      action: 'bank_transactions_synced',
      resource_type: 'bank_account',
      resource_id: accountId,
      details: { imported_count: importedCount },
    });

    return {
      sync_log: { ...syncLog, status: 'completed', transactions_imported: importedCount },
      imported_transactions: importedCount,
      new_transactions: newTransactions,
    };
  } catch (error: any) {
    // Update sync log with error
    await query(
      `UPDATE bank_sync_logs
       SET status = $1, error_message = $2, completed_at = $3
       WHERE id = $4`,
      ['failed', error.message, new Date(), syncLog.id]
    );

    throw error;
  }
};

/**
 * Get transactions for a bank account
 */
export const getBankTransactions = async (
  accountId: string,
  companyId: string,
  filters: {
    status?: string;
    from_date?: Date;
    to_date?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ transactions: BankTransactionWithMatches[]; total: number }> => {
  let whereClause = 'WHERE bt.bank_account_id = $1 AND bt.company_id = $2';
  const params: any[] = [accountId, companyId];
  let paramIndex = 3;

  if (filters.status) {
    whereClause += ` AND bt.status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }

  if (filters.from_date) {
    whereClause += ` AND bt.transaction_date >= $${paramIndex}`;
    params.push(filters.from_date);
    paramIndex++;
  }

  if (filters.to_date) {
    whereClause += ` AND bt.transaction_date <= $${paramIndex}`;
    params.push(filters.to_date);
    paramIndex++;
  }

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM bank_transactions bt ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total);

  // Get transactions with matches
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await query(
    `SELECT bt.*, ba.account_name, ba.account_number,
      COALESCE(
        json_agg(
          json_build_object(
            'id', tm.id,
            'match_type', tm.match_type,
            'match_id', tm.match_id,
            'matched_amount', tm.matched_amount,
            'confidence_score', tm.confidence_score,
            'match_method', tm.match_method
          )
        ) FILTER (WHERE tm.id IS NOT NULL),
        '[]'
      ) as matches
     FROM bank_transactions bt
     JOIN bank_accounts ba ON bt.bank_account_id = ba.id
     LEFT JOIN transaction_matches tm ON bt.id = tm.bank_transaction_id
     ${whereClause}
     GROUP BY bt.id, ba.account_name, ba.account_number
     ORDER BY bt.transaction_date DESC, bt.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    transactions: result.rows,
    total,
  };
};

/**
 * Find matching candidates for a transaction
 */
export const findMatchingCandidates = async (
  transactionId: string,
  companyId: string,
  criteria: MatchingCriteria = {}
): Promise<TransactionMatchCandidate[]> => {
  const transaction = await getBankTransactionById(transactionId, companyId);

  const amountTolerance = criteria.amount_tolerance || 0.01;
  const dateRangeDays = criteria.date_range_days || 30;
  const minConfidence = criteria.min_confidence_score || 0.5;

  const candidates: TransactionMatchCandidate[] = [];

  // Search for matching invoices (for incoming payments)
  if (transaction.amount > 0) {
    const invoiceResult = await query(
      `SELECT id, invoice_number, total_amount, invoice_date, customer_id, ocr_number
       FROM invoices
       WHERE company_id = $1
         AND status IN ('sent', 'overdue')
         AND ABS(total_amount - paid_amount - $2) <= $3
         AND invoice_date >= $4
         AND invoice_date <= $5
       ORDER BY ABS(total_amount - paid_amount - $2)
       LIMIT 10`,
      [
        companyId,
        Math.abs(transaction.amount),
        amountTolerance,
        new Date(transaction.transaction_date.getTime() - dateRangeDays * 24 * 60 * 60 * 1000),
        new Date(transaction.transaction_date.getTime() + dateRangeDays * 24 * 60 * 60 * 1000),
      ]
    );

    for (const invoice of invoiceResult.rows) {
      const matchReasons: string[] = [];
      let confidence = 0.5;

      // Amount match
      const amountDiff = Math.abs((invoice.total_amount - invoice.paid_amount) - Math.abs(transaction.amount));
      if (amountDiff <= 0.01) {
        confidence += 0.3;
        matchReasons.push('Exact amount match');
      } else if (amountDiff <= amountTolerance) {
        confidence += 0.2;
        matchReasons.push('Close amount match');
      }

      // OCR/Reference match
      if (transaction.reference && invoice.ocr_number) {
        const cleanRef = transaction.reference.replace(/\s/g, '');
        const cleanOCR = invoice.ocr_number.replace(/\s/g, '');
        if (cleanRef.includes(cleanOCR) || cleanOCR.includes(cleanRef)) {
          confidence += 0.3;
          matchReasons.push('OCR/Reference match');
        }
      }

      // Invoice number match
      if (transaction.description && transaction.description.includes(invoice.invoice_number)) {
        confidence += 0.2;
        matchReasons.push('Invoice number in description');
      }

      if (confidence >= minConfidence) {
        candidates.push({
          invoice_id: invoice.id,
          type: 'invoice',
          amount: invoice.total_amount - invoice.paid_amount,
          date: invoice.invoice_date,
          reference: invoice.ocr_number,
          confidence_score: Math.min(confidence, 1.0),
          match_reasons: matchReasons,
        });
      }
    }
  }

  // Search for matching receipts (for outgoing payments)
  if (transaction.amount < 0) {
    const receiptResult = await query(
      `SELECT id, receipt_number, total_amount, receipt_date, supplier_id
       FROM receipts
       WHERE company_id = $1
         AND status = 'approved'
         AND ABS(total_amount - $2) <= $3
         AND receipt_date >= $4
         AND receipt_date <= $5
       ORDER BY ABS(total_amount - $2)
       LIMIT 10`,
      [
        companyId,
        Math.abs(transaction.amount),
        amountTolerance,
        new Date(transaction.transaction_date.getTime() - dateRangeDays * 24 * 60 * 60 * 1000),
        new Date(transaction.transaction_date.getTime() + dateRangeDays * 24 * 60 * 60 * 1000),
      ]
    );

    for (const receipt of receiptResult.rows) {
      const matchReasons: string[] = [];
      let confidence = 0.5;

      // Amount match
      const amountDiff = Math.abs(receipt.total_amount - Math.abs(transaction.amount));
      if (amountDiff <= 0.01) {
        confidence += 0.3;
        matchReasons.push('Exact amount match');
      } else if (amountDiff <= amountTolerance) {
        confidence += 0.2;
        matchReasons.push('Close amount match');
      }

      if (confidence >= minConfidence) {
        candidates.push({
          receipt_id: receipt.id,
          type: 'receipt',
          amount: receipt.total_amount,
          date: receipt.receipt_date,
          confidence_score: Math.min(confidence, 1.0),
          match_reasons: matchReasons,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.confidence_score - a.confidence_score);
};

/**
 * Match transaction to invoice or receipt
 */
export const matchTransaction = async (
  transactionId: string,
  companyId: string,
  userId: string,
  matchRequest: MatchTransactionRequest
): Promise<MatchTransactionResponse> => {
  const transaction = await getBankTransactionById(transactionId, companyId);

  // Verify match exists
  if (matchRequest.match_type === 'invoice') {
    const result = await query(`SELECT id FROM invoices WHERE id = $1 AND company_id = $2`, [
      matchRequest.match_id,
      companyId,
    ]);
    if (result.rows.length === 0) {
      throw new Error('Invoice not found');
    }
  } else if (matchRequest.match_type === 'receipt') {
    const result = await query(`SELECT id FROM receipts WHERE id = $1 AND company_id = $2`, [
      matchRequest.match_id,
      companyId,
    ]);
    if (result.rows.length === 0) {
      throw new Error('Receipt not found');
    }
  }

  // Create match
  const matchResult = await query(
    `INSERT INTO transaction_matches
     (bank_transaction_id, match_type, match_id, matched_amount, match_method, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      transactionId,
      matchRequest.match_type,
      matchRequest.match_id,
      matchRequest.matched_amount,
      'manual',
      matchRequest.notes,
      userId,
    ]
  );

  // Update transaction status
  await query(
    `UPDATE bank_transactions SET status = 'matched', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [transactionId]
  );

  // Update invoice/receipt payment status
  if (matchRequest.match_type === 'invoice') {
    await query(
      `UPDATE invoices
       SET paid_amount = paid_amount + $1,
           paid_date = CASE WHEN paid_date IS NULL THEN $2 ELSE paid_date END,
           status = CASE WHEN total_amount <= paid_amount + $1 THEN 'paid' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [matchRequest.matched_amount, transaction.transaction_date, matchRequest.match_id]
    );
  }

  // Log audit
  await auditService.createAuditLog({
    user_id: userId,
    company_id: companyId,
    action: 'transaction_matched',
    resource_type: 'bank_transaction',
    resource_id: transactionId,
    details: { match_type: matchRequest.match_type, match_id: matchRequest.match_id },
  });

  const match: TransactionMatch = matchResult.rows[0];
  const updatedTransaction = await getBankTransactionById(transactionId, companyId);

  return {
    match,
    transaction: updatedTransaction,
  };
};

/**
 * Reconcile a transaction (create journal entry)
 */
export const reconcileTransaction = async (
  transactionId: string,
  companyId: string,
  userId: string,
  request: ReconcileTransactionRequest = {}
): Promise<ReconcileTransactionResponse> => {
  const transaction = await getBankTransactionById(transactionId, companyId);

  if (transaction.status !== 'matched') {
    throw new Error('Transaction must be matched before reconciliation');
  }

  if (request.create_journal_entry !== false) {
    // Get bank account's BAS account number
    const accountResult = await query(
      `SELECT bas_account_number FROM bank_accounts WHERE id = $1`,
      [transaction.bank_account_id]
    );
    const bankBASAccount = accountResult.rows[0]?.bas_account_number || 1930;

    // Get matched invoice/receipt for account mapping
    const matchResult = await query(
      `SELECT * FROM transaction_matches WHERE bank_transaction_id = $1 LIMIT 1`,
      [transactionId]
    );

    if (matchResult.rows.length === 0) {
      throw new Error('No match found for transaction');
    }

    const match = matchResult.rows[0];
    let counterAccount = 1510; // Default: Kundfordringar (Customer receivables)

    if (match.match_type === 'receipt') {
      counterAccount = 2440; // Leverantörsskulder (Supplier debt)
    }

    // Create journal entry
    const journalEntry = await accountingService.createJournalEntry(companyId, userId, {
      entry_date: transaction.transaction_date,
      description: `Bank transaction: ${transaction.description || 'Payment'}`,
      reference_type: 'payment',
      reference_id: transactionId,
      lines: [
        {
          account_number: transaction.amount > 0 ? bankBASAccount : counterAccount,
          debit: transaction.amount > 0 ? Math.abs(transaction.amount) : 0,
          credit: transaction.amount > 0 ? 0 : Math.abs(transaction.amount),
          description: transaction.description || '',
        },
        {
          account_number: transaction.amount > 0 ? counterAccount : bankBASAccount,
          debit: transaction.amount > 0 ? 0 : Math.abs(transaction.amount),
          credit: transaction.amount > 0 ? Math.abs(transaction.amount) : 0,
          description: transaction.description || '',
        },
      ],
    });

    // Update transaction
    await query(
      `UPDATE bank_transactions
       SET is_reconciled = true, reconciled_at = CURRENT_TIMESTAMP, reconciled_by = $1,
           journal_entry_id = $2, status = 'reconciled', updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [userId, journalEntry.id, transactionId]
    );

    // Log audit
    await auditService.createAuditLog({
      user_id: userId,
      company_id: companyId,
      action: 'transaction_reconciled',
      resource_type: 'bank_transaction',
      resource_id: transactionId,
      details: { journal_entry_id: journalEntry.id },
    });

    const reconciledTransaction = await getBankTransactionById(transactionId, companyId);

    return {
      transaction: reconciledTransaction,
      journal_entry_id: journalEntry.id,
    };
  }

  return {
    transaction,
  };
};

/**
 * Get bank transaction by ID
 */
const getBankTransactionById = async (
  transactionId: string,
  companyId: string
): Promise<BankTransaction> => {
  const result = await query(
    `SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2`,
    [transactionId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Bank transaction not found');
  }

  return result.rows[0];
};

/**
 * Delete/revoke bank connection
 */
export const deleteBankConnection = async (
  connectionId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  const connection = await getBankConnectionById(connectionId, companyId);

  // Revoke access with Tink
  if (connection.provider === 'tink' && connection.access_token) {
    try {
      await tinkService.revokeAccess(connection.access_token);
    } catch (error) {
      console.error('Error revoking Tink access:', error);
    }
  }

  // Update connection status
  await query(
    `UPDATE bank_connections SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [connectionId]
  );

  // Log audit
  await auditService.createAuditLog({
    user_id: userId,
    company_id: companyId,
    action: 'bank_connection_deleted',
    resource_type: 'bank_connection',
    resource_id: connectionId,
    details: { provider: connection.provider },
  });
};

/**
 * Get reconciliation summary for a company
 */
export const getReconciliationSummary = async (companyId: string) => {
  const result = await query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'unmatched') as unmatched_count,
      COUNT(*) FILTER (WHERE status = 'matched') as matched_count,
      COUNT(*) FILTER (WHERE status = 'reconciled') as reconciled_count,
      COUNT(*) FILTER (WHERE status = 'ignored') as ignored_count,
      SUM(amount) FILTER (WHERE status = 'unmatched' AND amount > 0) as unmatched_income,
      SUM(amount) FILTER (WHERE status = 'unmatched' AND amount < 0) as unmatched_expense
     FROM bank_transactions
     WHERE company_id = $1`,
    [companyId]
  );

  return result.rows[0];
};
