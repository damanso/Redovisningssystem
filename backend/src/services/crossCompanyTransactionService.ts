/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transaction Service
 */

import pool from '../config/database';
import {
  CrossCompanyTransaction,
  CrossCompanyTransactionWithDetails,
  CreateCrossCompanyTransactionDto,
  UpdateCrossCompanyTransactionDto,
  TransactionStatus
} from '../types/crossCompanyTransaction.types';

/**
 * Create a new cross-company transaction
 */
export const createCrossCompanyTransaction = async (
  userId: string,
  data: CreateCrossCompanyTransactionDto
): Promise<CrossCompanyTransaction> => {
  // Verify user has access to both companies
  const companyAccessQuery = `
    SELECT company_id
    FROM user_companies
    WHERE user_id = $1 AND company_id IN ($2, $3)
  `;

  const accessCheck = await pool.query(companyAccessQuery, [
    userId,
    data.from_company_id,
    data.to_company_id
  ]);

  if (accessCheck.rows.length < 2) {
    throw new Error('Access denied to one or both companies');
  }

  const query = `
    INSERT INTO cross_company_transactions (
      from_company_id,
      to_company_id,
      transaction_type,
      description,
      amount,
      currency,
      transaction_date,
      from_invoice_id,
      to_invoice_id,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;

  const values = [
    data.from_company_id,
    data.to_company_id,
    data.transaction_type,
    data.description,
    data.amount,
    data.currency || 'SEK',
    data.transaction_date,
    data.from_invoice_id || null,
    data.to_invoice_id || null,
    userId
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

/**
 * Get all cross-company transactions for companies user has access to
 */
export const getCrossCompanyTransactions = async (
  userId: string,
  filters?: {
    company_id?: string;
    status?: TransactionStatus;
    from_date?: Date;
    to_date?: Date;
  }
): Promise<CrossCompanyTransactionWithDetails[]> => {
  let query = `
    SELECT
      cct.*,
      fc.name as from_company_name,
      tc.name as to_company_name,
      u.name as created_by_name
    FROM cross_company_transactions cct
    JOIN companies fc ON cct.from_company_id = fc.id
    JOIN companies tc ON cct.to_company_id = tc.id
    JOIN users u ON cct.created_by = u.id
    WHERE (
      cct.from_company_id IN (SELECT company_id FROM user_companies WHERE user_id = $1)
      OR cct.to_company_id IN (SELECT company_id FROM user_companies WHERE user_id = $1)
    )
  `;

  const values: any[] = [userId];
  let paramCount = 2;

  if (filters?.company_id) {
    query += ` AND (cct.from_company_id = $${paramCount} OR cct.to_company_id = $${paramCount})`;
    values.push(filters.company_id);
    paramCount++;
  }

  if (filters?.status) {
    query += ` AND cct.status = $${paramCount}`;
    values.push(filters.status);
    paramCount++;
  }

  if (filters?.from_date) {
    query += ` AND cct.transaction_date >= $${paramCount}`;
    values.push(filters.from_date);
    paramCount++;
  }

  if (filters?.to_date) {
    query += ` AND cct.transaction_date <= $${paramCount}`;
    values.push(filters.to_date);
    paramCount++;
  }

  query += ' ORDER BY cct.transaction_date DESC, cct.created_at DESC';

  const result = await pool.query(query, values);
  return result.rows;
};

/**
 * Get a specific cross-company transaction by ID
 */
export const getCrossCompanyTransactionById = async (
  transactionId: string,
  userId: string
): Promise<CrossCompanyTransactionWithDetails | null> => {
  const query = `
    SELECT
      cct.*,
      fc.name as from_company_name,
      tc.name as to_company_name,
      u.name as created_by_name
    FROM cross_company_transactions cct
    JOIN companies fc ON cct.from_company_id = fc.id
    JOIN companies tc ON cct.to_company_id = tc.id
    JOIN users u ON cct.created_by = u.id
    WHERE cct.id = $1
      AND (
        cct.from_company_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
        OR cct.to_company_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
      )
  `;

  const result = await pool.query(query, [transactionId, userId]);
  return result.rows[0] || null;
};

/**
 * Update a cross-company transaction
 */
export const updateCrossCompanyTransaction = async (
  transactionId: string,
  userId: string,
  data: UpdateCrossCompanyTransactionDto
): Promise<CrossCompanyTransaction | null> => {
  // Verify user has access to the transaction
  const transaction = await getCrossCompanyTransactionById(transactionId, userId);
  if (!transaction) {
    throw new Error('Transaction not found or access denied');
  }

  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.transaction_type !== undefined) {
    fields.push(`transaction_type = $${paramCount++}`);
    values.push(data.transaction_type);
  }

  if (data.description !== undefined) {
    fields.push(`description = $${paramCount++}`);
    values.push(data.description);
  }

  if (data.amount !== undefined) {
    fields.push(`amount = $${paramCount++}`);
    values.push(data.amount);
  }

  if (data.currency !== undefined) {
    fields.push(`currency = $${paramCount++}`);
    values.push(data.currency);
  }

  if (data.transaction_date !== undefined) {
    fields.push(`transaction_date = $${paramCount++}`);
    values.push(data.transaction_date);
  }

  if (data.status !== undefined) {
    fields.push(`status = $${paramCount++}`);
    values.push(data.status);
  }

  if (data.from_invoice_id !== undefined) {
    fields.push(`from_invoice_id = $${paramCount++}`);
    values.push(data.from_invoice_id);
  }

  if (data.to_invoice_id !== undefined) {
    fields.push(`to_invoice_id = $${paramCount++}`);
    values.push(data.to_invoice_id);
  }

  if (fields.length === 0) {
    return null;
  }

  values.push(transactionId);

  const query = `
    UPDATE cross_company_transactions
    SET ${fields.join(', ')}
    WHERE id = $${paramCount++}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
};

/**
 * Reconcile a cross-company transaction
 */
export const reconcileTransaction = async (
  transactionId: string,
  userId: string
): Promise<CrossCompanyTransaction | null> => {
  const query = `
    UPDATE cross_company_transactions
    SET
      is_reconciled = true,
      reconciled_at = CURRENT_TIMESTAMP,
      reconciled_by = $2,
      status = 'completed'
    WHERE id = $1
      AND (
        from_company_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
        OR to_company_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
      )
    RETURNING *
  `;

  const result = await pool.query(query, [transactionId, userId]);
  return result.rows[0] || null;
};

/**
 * Delete a cross-company transaction
 */
export const deleteCrossCompanyTransaction = async (
  transactionId: string,
  userId: string
): Promise<boolean> => {
  // Only allow deletion if user created the transaction and it's not reconciled
  const query = `
    DELETE FROM cross_company_transactions
    WHERE id = $1
      AND created_by = $2
      AND is_reconciled = false
    RETURNING id
  `;

  const result = await pool.query(query, [transactionId, userId]);
  return result.rows.length > 0;
};

/**
 * Get transaction summary for a company
 */
export const getCompanyTransactionSummary = async (
  companyId: string,
  userId: string,
  dateRange?: { from: Date; to: Date }
): Promise<any> => {
  // Verify user has access to company
  const accessCheck = await pool.query(
    'SELECT company_id FROM user_companies WHERE company_id = $1 AND user_id = $2',
    [companyId, userId]
  );

  if (accessCheck.rows.length === 0) {
    throw new Error('Access denied to company');
  }

  let query = `
    SELECT
      COUNT(*) as total_transactions,
      SUM(CASE WHEN from_company_id = $1 THEN amount ELSE 0 END) as total_outgoing,
      SUM(CASE WHEN to_company_id = $1 THEN amount ELSE 0 END) as total_incoming,
      COUNT(CASE WHEN is_reconciled = true THEN 1 END) as reconciled_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
    FROM cross_company_transactions
    WHERE (from_company_id = $1 OR to_company_id = $1)
  `;

  const values: any[] = [companyId];
  let paramCount = 2;

  if (dateRange?.from) {
    query += ` AND transaction_date >= $${paramCount}`;
    values.push(dateRange.from);
    paramCount++;
  }

  if (dateRange?.to) {
    query += ` AND transaction_date <= $${paramCount}`;
    values.push(dateRange.to);
    paramCount++;
  }

  const result = await pool.query(query, values);
  return result.rows[0];
};
