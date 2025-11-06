import { Pool } from 'pg';
import {
  ExpenseReimbursement,
  CreateExpenseReimbursementDto,
  ApproveExpenseReimbursementDto,
  RejectExpenseReimbursementDto
} from '../types/bank.types.js';

export class ExpenseReimbursementService {
  constructor(private pool: Pool) {}

  /**
   * Create expense reimbursement claim
   */
  async createReimbursement(
    companyId: string,
    userId: string,
    dto: CreateExpenseReimbursementDto
  ): Promise<ExpenseReimbursement> {
    const additionalReceipts = dto.additional_receipts ? JSON.stringify(dto.additional_receipts) : null;

    const result = await this.pool.query<ExpenseReimbursement>(
      `INSERT INTO expense_reimbursements (
        company_id, claimed_by, claim_date, expense_date, description,
        category, amount, currency, receipt_id, additional_receipts, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        companyId,
        userId,
        dto.claim_date,
        dto.expense_date,
        dto.description,
        dto.category || null,
        dto.amount,
        dto.currency || 'SEK',
        dto.receipt_id || null,
        additionalReceipts,
        dto.notes || null
      ]
    );

    return result.rows[0];
  }

  /**
   * Get all expense reimbursements for a company
   */
  async getReimbursements(companyId: string, status?: string): Promise<ExpenseReimbursement[]> {
    let query = `
      SELECT er.*,
             u1.name as claimed_by_name,
             u2.name as approved_by_name,
             r.file_url as receipt_file_url,
             bt.transaction_date as payment_transaction_date
      FROM expense_reimbursements er
      LEFT JOIN users u1 ON er.claimed_by = u1.id
      LEFT JOIN users u2 ON er.approved_by = u2.id
      LEFT JOIN receipts r ON er.receipt_id = r.id
      LEFT JOIN bank_transactions bt ON er.paid_via_transaction_id = bt.id
      WHERE er.company_id = $1
    `;
    const params: any[] = [companyId];

    if (status) {
      params.push(status);
      query += ` AND er.status = $${params.length}`;
    }

    query += ` ORDER BY er.expense_date DESC, er.created_at DESC`;

    const result = await this.pool.query<ExpenseReimbursement>(query, params);
    return result.rows;
  }

  /**
   * Get reimbursement by ID
   */
  async getReimbursementById(
    companyId: string,
    reimbursementId: string
  ): Promise<ExpenseReimbursement | null> {
    const result = await this.pool.query<ExpenseReimbursement>(
      `SELECT er.*,
              u1.name as claimed_by_name,
              u2.name as approved_by_name,
              r.file_url as receipt_file_url
       FROM expense_reimbursements er
       LEFT JOIN users u1 ON er.claimed_by = u1.id
       LEFT JOIN users u2 ON er.approved_by = u2.id
       LEFT JOIN receipts r ON er.receipt_id = r.id
       WHERE er.company_id = $1 AND er.id = $2`,
      [companyId, reimbursementId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get reimbursements for a specific user
   */
  async getReimbursementsByUser(companyId: string, userId: string): Promise<ExpenseReimbursement[]> {
    const result = await this.pool.query<ExpenseReimbursement>(
      `SELECT er.*,
              u1.name as claimed_by_name,
              u2.name as approved_by_name,
              r.file_url as receipt_file_url
       FROM expense_reimbursements er
       LEFT JOIN users u1 ON er.claimed_by = u1.id
       LEFT JOIN users u2 ON er.approved_by = u2.id
       LEFT JOIN receipts r ON er.receipt_id = r.id
       WHERE er.company_id = $1 AND er.claimed_by = $2
       ORDER BY er.expense_date DESC`,
      [companyId, userId]
    );

    return result.rows;
  }

  /**
   * Approve expense reimbursement
   */
  async approveReimbursement(
    companyId: string,
    reimbursementId: string,
    approverId: string,
    dto: ApproveExpenseReimbursementDto
  ): Promise<ExpenseReimbursement> {
    const result = await this.pool.query<ExpenseReimbursement>(
      `UPDATE expense_reimbursements
       SET status = 'approved',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           approved_amount = $2,
           notes = COALESCE($3, notes)
       WHERE company_id = $4 AND id = $5 AND status = 'pending'
       RETURNING *`,
      [approverId, dto.approved_amount, dto.notes || null, companyId, reimbursementId]
    );

    if (result.rows.length === 0) {
      throw new Error('Reimbursement not found or already processed');
    }

    return result.rows[0];
  }

  /**
   * Reject expense reimbursement
   */
  async rejectReimbursement(
    companyId: string,
    reimbursementId: string,
    approverId: string,
    dto: RejectExpenseReimbursementDto
  ): Promise<ExpenseReimbursement> {
    const result = await this.pool.query<ExpenseReimbursement>(
      `UPDATE expense_reimbursements
       SET status = 'rejected',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           rejection_reason = $2
       WHERE company_id = $3 AND id = $4 AND status = 'pending'
       RETURNING *`,
      [approverId, dto.rejection_reason, companyId, reimbursementId]
    );

    if (result.rows.length === 0) {
      throw new Error('Reimbursement not found or already processed');
    }

    return result.rows[0];
  }

  /**
   * Mark reimbursement as paid
   */
  async markAsPaid(
    companyId: string,
    reimbursementId: string,
    transactionId: string,
    paymentDate: string
  ): Promise<ExpenseReimbursement> {
    const result = await this.pool.query<ExpenseReimbursement>(
      `UPDATE expense_reimbursements
       SET status = 'paid',
           payment_date = $1,
           paid_via_transaction_id = $2
       WHERE company_id = $3 AND id = $4 AND status = 'approved'
       RETURNING *`,
      [paymentDate, transactionId, companyId, reimbursementId]
    );

    if (result.rows.length === 0) {
      throw new Error('Reimbursement not found or not in approved status');
    }

    // Link the transaction to this reimbursement
    await this.pool.query(
      `UPDATE bank_transactions
       SET linked_expense_id = $1, status = 'matched'
       WHERE id = $2`,
      [reimbursementId, transactionId]
    );

    return result.rows[0];
  }

  /**
   * Cancel expense reimbursement
   */
  async cancelReimbursement(
    companyId: string,
    reimbursementId: string,
    userId: string
  ): Promise<ExpenseReimbursement> {
    const result = await this.pool.query<ExpenseReimbursement>(
      `UPDATE expense_reimbursements
       SET status = 'cancelled'
       WHERE company_id = $1 AND id = $2
         AND (claimed_by = $3 OR status = 'pending')
       RETURNING *`,
      [companyId, reimbursementId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Reimbursement not found or cannot be cancelled');
    }

    return result.rows[0];
  }

  /**
   * Delete expense reimbursement (only pending)
   */
  async deleteReimbursement(companyId: string, reimbursementId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM expense_reimbursements
       WHERE company_id = $1 AND id = $2 AND status = 'pending'`,
      [companyId, reimbursementId]
    );

    if (result.rowCount === 0) {
      throw new Error('Reimbursement not found or cannot be deleted');
    }
  }

  /**
   * Get total pending reimbursements amount
   */
  async getTotalPendingAmount(companyId: string): Promise<number> {
    const result = await this.pool.query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expense_reimbursements
       WHERE company_id = $1 AND status IN ('pending', 'approved')`,
      [companyId]
    );

    return parseFloat(result.rows[0].total.toString());
  }

  /**
   * Get reimbursements by category (for reporting)
   */
  async getReimbursementsByCategory(
    companyId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<{ category: string; total: number; count: number }>> {
    let query = `
      SELECT
        category,
        COALESCE(SUM(amount), 0) as total,
        COUNT(*) as count
      FROM expense_reimbursements
      WHERE company_id = $1
        AND status IN ('approved', 'paid')
    `;
    const params: any[] = [companyId];

    if (startDate) {
      params.push(startDate);
      query += ` AND expense_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND expense_date <= $${params.length}`;
    }

    query += ` GROUP BY category ORDER BY total DESC`;

    const result = await this.pool.query<{ category: string; total: number; count: number }>(query, params);

    return result.rows.map(row => ({
      category: row.category,
      total: parseFloat(row.total.toString()),
      count: parseInt(row.count.toString())
    }));
  }
}
