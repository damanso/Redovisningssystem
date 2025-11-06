import { Pool } from 'pg';
import {
  SalaryWithdrawal,
  CreateSalaryWithdrawalDto,
  ApproveSalaryWithdrawalDto,
  RejectSalaryWithdrawalDto
} from '../types/bank.types.js';

export class SalaryWithdrawalService {
  constructor(private pool: Pool) {}

  /**
   * Create salary withdrawal request
   */
  async createWithdrawal(
    companyId: string,
    userId: string,
    dto: CreateSalaryWithdrawalDto
  ): Promise<SalaryWithdrawal> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `INSERT INTO salary_withdrawals (
        company_id, requested_by, requested_amount, requested_date, notes
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [companyId, userId, dto.requested_amount, dto.requested_date, dto.notes || null]
    );

    return result.rows[0];
  }

  /**
   * Get all salary withdrawals for a company
   */
  async getWithdrawals(companyId: string, status?: string): Promise<SalaryWithdrawal[]> {
    let query = `
      SELECT sw.*,
             u1.name as requested_by_name,
             u2.name as approved_by_name,
             bt.transaction_date as payment_transaction_date
      FROM salary_withdrawals sw
      LEFT JOIN users u1 ON sw.requested_by = u1.id
      LEFT JOIN users u2 ON sw.approved_by = u2.id
      LEFT JOIN bank_transactions bt ON sw.paid_via_transaction_id = bt.id
      WHERE sw.company_id = $1
    `;
    const params: any[] = [companyId];

    if (status) {
      params.push(status);
      query += ` AND sw.status = $${params.length}`;
    }

    query += ` ORDER BY sw.requested_date DESC, sw.created_at DESC`;

    const result = await this.pool.query<SalaryWithdrawal>(query, params);
    return result.rows;
  }

  /**
   * Get withdrawal by ID
   */
  async getWithdrawalById(companyId: string, withdrawalId: string): Promise<SalaryWithdrawal | null> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `SELECT sw.*,
              u1.name as requested_by_name,
              u2.name as approved_by_name
       FROM salary_withdrawals sw
       LEFT JOIN users u1 ON sw.requested_by = u1.id
       LEFT JOIN users u2 ON sw.approved_by = u2.id
       WHERE sw.company_id = $1 AND sw.id = $2`,
      [companyId, withdrawalId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get withdrawals for a specific user
   */
  async getWithdrawalsByUser(companyId: string, userId: string): Promise<SalaryWithdrawal[]> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `SELECT sw.*,
              u1.name as requested_by_name,
              u2.name as approved_by_name
       FROM salary_withdrawals sw
       LEFT JOIN users u1 ON sw.requested_by = u1.id
       LEFT JOIN users u2 ON sw.approved_by = u2.id
       WHERE sw.company_id = $1 AND sw.requested_by = $2
       ORDER BY sw.requested_date DESC`,
      [companyId, userId]
    );

    return result.rows;
  }

  /**
   * Approve salary withdrawal
   */
  async approveWithdrawal(
    companyId: string,
    withdrawalId: string,
    approverId: string,
    dto: ApproveSalaryWithdrawalDto
  ): Promise<SalaryWithdrawal> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `UPDATE salary_withdrawals
       SET status = 'approved',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           approved_amount = $2,
           gross_amount = $3,
           tax_amount = $4,
           net_amount = $5,
           notes = COALESCE($6, notes)
       WHERE company_id = $7 AND id = $8 AND status = 'pending'
       RETURNING *`,
      [
        approverId,
        dto.approved_amount,
        dto.gross_amount || null,
        dto.tax_amount || null,
        dto.net_amount || null,
        dto.notes || null,
        companyId,
        withdrawalId
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Withdrawal not found or already processed');
    }

    return result.rows[0];
  }

  /**
   * Reject salary withdrawal
   */
  async rejectWithdrawal(
    companyId: string,
    withdrawalId: string,
    approverId: string,
    dto: RejectSalaryWithdrawalDto
  ): Promise<SalaryWithdrawal> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `UPDATE salary_withdrawals
       SET status = 'rejected',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           rejection_reason = $2
       WHERE company_id = $3 AND id = $4 AND status = 'pending'
       RETURNING *`,
      [approverId, dto.rejection_reason, companyId, withdrawalId]
    );

    if (result.rows.length === 0) {
      throw new Error('Withdrawal not found or already processed');
    }

    return result.rows[0];
  }

  /**
   * Mark withdrawal as paid
   */
  async markAsPaid(
    companyId: string,
    withdrawalId: string,
    transactionId: string,
    paymentDate: string
  ): Promise<SalaryWithdrawal> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `UPDATE salary_withdrawals
       SET status = 'paid',
           payment_date = $1,
           paid_via_transaction_id = $2
       WHERE company_id = $3 AND id = $4 AND status = 'approved'
       RETURNING *`,
      [paymentDate, transactionId, companyId, withdrawalId]
    );

    if (result.rows.length === 0) {
      throw new Error('Withdrawal not found or not in approved status');
    }

    // Link the transaction to this withdrawal
    await this.pool.query(
      `UPDATE bank_transactions
       SET linked_salary_id = $1, status = 'matched'
       WHERE id = $2`,
      [withdrawalId, transactionId]
    );

    return result.rows[0];
  }

  /**
   * Cancel salary withdrawal
   */
  async cancelWithdrawal(companyId: string, withdrawalId: string, userId: string): Promise<SalaryWithdrawal> {
    const result = await this.pool.query<SalaryWithdrawal>(
      `UPDATE salary_withdrawals
       SET status = 'cancelled'
       WHERE company_id = $1 AND id = $2
         AND (requested_by = $3 OR status = 'pending')
       RETURNING *`,
      [companyId, withdrawalId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Withdrawal not found or cannot be cancelled');
    }

    return result.rows[0];
  }

  /**
   * Delete salary withdrawal (only pending)
   */
  async deleteWithdrawal(companyId: string, withdrawalId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM salary_withdrawals
       WHERE company_id = $1 AND id = $2 AND status = 'pending'`,
      [companyId, withdrawalId]
    );

    if (result.rowCount === 0) {
      throw new Error('Withdrawal not found or cannot be deleted');
    }
  }

  /**
   * Get total pending withdrawals amount
   */
  async getTotalPendingAmount(companyId: string): Promise<number> {
    const result = await this.pool.query<{ total: number }>(
      `SELECT COALESCE(SUM(requested_amount), 0) as total
       FROM salary_withdrawals
       WHERE company_id = $1 AND status IN ('pending', 'approved')`,
      [companyId]
    );

    return parseFloat(result.rows[0].total.toString());
  }
}
