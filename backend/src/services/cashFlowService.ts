import { Pool } from 'pg';
import {
  CashFlowSummary,
  CashFlowSettings,
  UpdateCashFlowSettingsDto,
  CalculateAvailableFundsDto,
  AvailableFundsCalculation,
  PlannedExpense,
  CreatePlannedExpenseDto,
  UpdatePlannedExpenseDto
} from '../types/bank.types.js';

export class CashFlowService {
  constructor(private pool: Pool) {}

  /**
   * Get or create cash flow settings for a company
   */
  async getSettings(companyId: string, userId: string): Promise<CashFlowSettings> {
    let result = await this.pool.query<CashFlowSettings>(
      `SELECT * FROM cash_flow_settings WHERE company_id = $1`,
      [companyId]
    );

    // Create default settings if not exists
    if (result.rows.length === 0) {
      result = await this.pool.query<CashFlowSettings>(
        `INSERT INTO cash_flow_settings (company_id, updated_by)
         VALUES ($1, $2)
         RETURNING *`,
        [companyId, userId]
      );
    }

    return result.rows[0];
  }

  /**
   * Update cash flow settings
   */
  async updateSettings(
    companyId: string,
    userId: string,
    dto: UpdateCashFlowSettingsDto
  ): Promise<CashFlowSettings> {
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (dto.minimum_balance_amount !== undefined) {
      updates.push(`minimum_balance_amount = $${paramIndex}`);
      params.push(dto.minimum_balance_amount);
      paramIndex++;
    }

    if (dto.safety_margin_percentage !== undefined) {
      updates.push(`safety_margin_percentage = $${paramIndex}`);
      params.push(dto.safety_margin_percentage);
      paramIndex++;
    }

    if (dto.planning_horizon_days !== undefined) {
      updates.push(`planning_horizon_days = $${paramIndex}`);
      params.push(dto.planning_horizon_days);
      paramIndex++;
    }

    if (dto.auto_categorization_enabled !== undefined) {
      updates.push(`auto_categorization_enabled = $${paramIndex}`);
      params.push(dto.auto_categorization_enabled);
      paramIndex++;
    }

    if (dto.low_balance_alert_enabled !== undefined) {
      updates.push(`low_balance_alert_enabled = $${paramIndex}`);
      params.push(dto.low_balance_alert_enabled);
      paramIndex++;
    }

    if (dto.low_balance_threshold !== undefined) {
      updates.push(`low_balance_threshold = $${paramIndex}`);
      params.push(dto.low_balance_threshold);
      paramIndex++;
    }

    updates.push(`updated_by = $${paramIndex}`);
    params.push(userId);
    paramIndex++;

    params.push(companyId);

    const result = await this.pool.query<CashFlowSettings>(
      `UPDATE cash_flow_settings
       SET ${updates.join(', ')}
       WHERE company_id = $${paramIndex}
       RETURNING *`,
      params
    );

    return result.rows[0];
  }

  /**
   * Calculate current balance from bank transactions
   */
  private async getCurrentBalance(companyId: string): Promise<number> {
    const result = await this.pool.query<{ balance: number }>(
      `SELECT COALESCE(SUM(amount), 0) as balance
       FROM bank_transactions
       WHERE company_id = $1
         AND status != 'duplicate'
         AND status != 'ignored'`,
      [companyId]
    );

    return parseFloat(result.rows[0].balance.toString());
  }

  /**
   * Calculate total income and expenses from transactions
   */
  private async getIncomeAndExpenses(
    companyId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ income: number; expenses: number }> {
    let query = `
      SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as expenses
      FROM bank_transactions
      WHERE company_id = $1
        AND status != 'duplicate'
        AND status != 'ignored'
    `;
    const params: any[] = [companyId];

    if (startDate) {
      params.push(startDate.toISOString().split('T')[0]);
      query += ` AND transaction_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate.toISOString().split('T')[0]);
      query += ` AND transaction_date <= $${params.length}`;
    }

    const result = await this.pool.query<{ income: number; expenses: number }>(query, params);

    return {
      income: parseFloat(result.rows[0].income.toString()),
      expenses: parseFloat(result.rows[0].expenses.toString())
    };
  }

  /**
   * Get unpaid invoices (upcoming income)
   */
  private async getUnpaidInvoices(companyId: string): Promise<{ count: number; amount: number }> {
    const result = await this.pool.query<{ count: number; amount: number }>(
      `SELECT
         COUNT(*) as count,
         COALESCE(SUM(total_amount - paid_amount), 0) as amount
       FROM invoices
       WHERE company_id = $1
         AND status IN ('sent', 'overdue')
         AND (total_amount - paid_amount) > 0`,
      [companyId]
    );

    return {
      count: parseInt(result.rows[0].count.toString()),
      amount: parseFloat(result.rows[0].amount.toString())
    };
  }

  /**
   * Get planned expenses within planning horizon
   */
  private async getPlannedExpenses(
    companyId: string,
    planningDays: number
  ): Promise<{ count: number; amount: number }> {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + planningDays);

    const result = await this.pool.query<{ count: number; amount: number }>(
      `SELECT
         COUNT(*) as count,
         COALESCE(SUM(amount), 0) as amount
       FROM planned_expenses
       WHERE company_id = $1
         AND status = 'pending'
         AND due_date <= $2`,
      [companyId, endDate.toISOString().split('T')[0]]
    );

    return {
      count: parseInt(result.rows[0].count.toString()),
      amount: parseFloat(result.rows[0].amount.toString())
    };
  }

  /**
   * Get pending salary withdrawals
   */
  private async getPendingSalaryWithdrawals(
    companyId: string
  ): Promise<{ count: number; amount: number }> {
    const result = await this.pool.query<{ count: number; amount: number }>(
      `SELECT
         COUNT(*) as count,
         COALESCE(SUM(requested_amount), 0) as amount
       FROM salary_withdrawals
       WHERE company_id = $1
         AND status IN ('pending', 'approved')`,
      [companyId]
    );

    return {
      count: parseInt(result.rows[0].count.toString()),
      amount: parseFloat(result.rows[0].amount.toString())
    };
  }

  /**
   * Get pending expense reimbursements
   */
  private async getPendingExpenseReimbursements(
    companyId: string
  ): Promise<{ count: number; amount: number }> {
    const result = await this.pool.query<{ count: number; amount: number }>(
      `SELECT
         COUNT(*) as count,
         COALESCE(SUM(amount), 0) as amount
       FROM expense_reimbursements
       WHERE company_id = $1
         AND status IN ('pending', 'approved')`,
      [companyId]
    );

    return {
      count: parseInt(result.rows[0].count.toString()),
      amount: parseFloat(result.rows[0].amount.toString())
    };
  }

  /**
   * Get comprehensive cash flow summary
   */
  async getCashFlowSummary(companyId: string, userId: string): Promise<CashFlowSummary> {
    const settings = await this.getSettings(companyId, userId);

    // Get current balance
    const currentBalance = await this.getCurrentBalance(companyId);

    // Get income and expenses (last 30 days for context)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { income: totalIncome, expenses: totalExpenses } = await this.getIncomeAndExpenses(
      companyId,
      thirtyDaysAgo
    );

    // Get upcoming income (unpaid invoices)
    const unpaidInvoices = await this.getUnpaidInvoices(companyId);

    // Get upcoming expenses (planned expenses)
    const plannedExpenses = await this.getPlannedExpenses(
      companyId,
      settings.planning_horizon_days
    );

    // Get pending withdrawals and reimbursements
    const pendingSalaries = await this.getPendingSalaryWithdrawals(companyId);
    const pendingReimbursements = await this.getPendingExpenseReimbursements(companyId);

    // Calculate projected balance
    const projectedBalance =
      currentBalance +
      unpaidInvoices.amount -
      plannedExpenses.amount -
      pendingSalaries.amount -
      pendingReimbursements.amount;

    // Calculate safety margin
    const safetyMargin = (totalExpenses * settings.safety_margin_percentage) / 100;

    // Calculate available for withdrawal
    const availableForWithdrawal = Math.max(
      0,
      projectedBalance - settings.minimum_balance_amount - safetyMargin
    );

    // Check warnings
    const warnings: string[] = [];
    const isLowBalance =
      settings.low_balance_alert_enabled &&
      settings.low_balance_threshold &&
      currentBalance < settings.low_balance_threshold;

    if (isLowBalance) {
      warnings.push(
        `Saldo är lågt (${currentBalance.toFixed(2)} SEK). Gräns: ${settings.low_balance_threshold?.toFixed(2)} SEK`
      );
    }

    if (projectedBalance < settings.minimum_balance_amount) {
      warnings.push(
        `Beräknat saldo (${projectedBalance.toFixed(2)} SEK) är under minimigräns (${settings.minimum_balance_amount.toFixed(2)} SEK)`
      );
    }

    if (plannedExpenses.amount > currentBalance) {
      warnings.push(
        `Planerade utgifter (${plannedExpenses.amount.toFixed(2)} SEK) överstiger nuvarande saldo`
      );
    }

    return {
      current_balance: currentBalance,
      total_income: totalIncome,
      total_expenses: totalExpenses,
      net_cash_flow: totalIncome - totalExpenses,

      upcoming_income: unpaidInvoices.amount,
      upcoming_expenses: plannedExpenses.amount,

      projected_balance: projectedBalance,
      safety_margin: safetyMargin,
      minimum_balance: settings.minimum_balance_amount,
      available_for_withdrawal: availableForWithdrawal,

      unpaid_invoices_count: unpaidInvoices.count,
      unpaid_invoices_amount: unpaidInvoices.amount,
      planned_expenses_count: plannedExpenses.count,
      planned_expenses_amount: plannedExpenses.amount,
      pending_salary_withdrawals_count: pendingSalaries.count,
      pending_salary_withdrawals_amount: pendingSalaries.amount,
      pending_expense_reimbursements_count: pendingReimbursements.count,
      pending_expense_reimbursements_amount: pendingReimbursements.amount,

      is_low_balance: isLowBalance,
      warnings
    };
  }

  /**
   * Calculate available funds with simulation
   */
  async calculateAvailableFunds(
    companyId: string,
    userId: string,
    dto: CalculateAvailableFundsDto
  ): Promise<AvailableFundsCalculation> {
    const summary = await this.getCashFlowSummary(companyId, userId);

    const requestedAmount = (dto.exclude_salary_amount || 0) + (dto.exclude_expense_amount || 0);

    // Simulate withdrawal
    const remainingAfterWithdrawal = summary.available_for_withdrawal - requestedAmount;
    const projectedBalanceAfterWithdrawal = summary.projected_balance - requestedAmount;

    const canAfford = remainingAfterWithdrawal >= 0;

    const warnings: string[] = [...summary.warnings];

    if (!canAfford) {
      warnings.push(
        `Otillräckliga medel. Tillgängligt: ${summary.available_for_withdrawal.toFixed(2)} SEK, Begärt: ${requestedAmount.toFixed(2)} SEK`
      );
    }

    if (projectedBalanceAfterWithdrawal < summary.minimum_balance) {
      warnings.push(
        `Uttag skulle lämna saldo under minimigräns (${summary.minimum_balance.toFixed(2)} SEK)`
      );
    }

    return {
      requested_amount: requestedAmount,
      available_amount: summary.available_for_withdrawal,
      can_afford: canAfford,
      remaining_after_withdrawal: remainingAfterWithdrawal,
      warnings,
      breakdown: {
        current_balance: summary.current_balance,
        upcoming_income: summary.upcoming_income,
        upcoming_expenses: summary.upcoming_expenses,
        safety_margin: summary.safety_margin,
        minimum_balance: summary.minimum_balance
      }
    };
  }

  // ==================== Planned Expenses ====================

  /**
   * Create planned expense
   */
  async createPlannedExpense(
    companyId: string,
    userId: string,
    dto: CreatePlannedExpenseDto
  ): Promise<PlannedExpense> {
    const result = await this.pool.query<PlannedExpense>(
      `INSERT INTO planned_expenses (
        company_id, name, description, category, amount, currency,
        due_date, is_recurring, recurrence_frequency, recurrence_day,
        supplier_id, recipient_name, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        companyId,
        dto.name,
        dto.description || null,
        dto.category || null,
        dto.amount,
        dto.currency || 'SEK',
        dto.due_date,
        dto.is_recurring || false,
        dto.recurrence_frequency || null,
        dto.recurrence_day || null,
        dto.supplier_id || null,
        dto.recipient_name || null,
        userId
      ]
    );

    return result.rows[0];
  }

  /**
   * Get planned expenses
   */
  async getPlannedExpensesList(
    companyId: string,
    status?: string
  ): Promise<PlannedExpense[]> {
    let query = `
      SELECT pe.*,
             s.name as supplier_name,
             u.name as created_by_name
      FROM planned_expenses pe
      LEFT JOIN suppliers s ON pe.supplier_id = s.id
      LEFT JOIN users u ON pe.created_by = u.id
      WHERE pe.company_id = $1
    `;
    const params: any[] = [companyId];

    if (status) {
      params.push(status);
      query += ` AND pe.status = $${params.length}`;
    }

    query += ` ORDER BY pe.due_date ASC`;

    const result = await this.pool.query<PlannedExpense>(query, params);
    return result.rows;
  }

  /**
   * Update planned expense
   */
  async updatePlannedExpense(
    companyId: string,
    expenseId: string,
    dto: UpdatePlannedExpenseDto
  ): Promise<PlannedExpense> {
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (dto.name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      params.push(dto.name);
      paramIndex++;
    }

    if (dto.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(dto.description);
      paramIndex++;
    }

    if (dto.category !== undefined) {
      updates.push(`category = $${paramIndex}`);
      params.push(dto.category);
      paramIndex++;
    }

    if (dto.amount !== undefined) {
      updates.push(`amount = $${paramIndex}`);
      params.push(dto.amount);
      paramIndex++;
    }

    if (dto.due_date !== undefined) {
      updates.push(`due_date = $${paramIndex}`);
      params.push(dto.due_date);
      paramIndex++;
    }

    if (dto.status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      params.push(dto.status);
      paramIndex++;
    }

    if (dto.is_recurring !== undefined) {
      updates.push(`is_recurring = $${paramIndex}`);
      params.push(dto.is_recurring);
      paramIndex++;
    }

    if (dto.recurrence_frequency !== undefined) {
      updates.push(`recurrence_frequency = $${paramIndex}`);
      params.push(dto.recurrence_frequency);
      paramIndex++;
    }

    if (dto.recurrence_day !== undefined) {
      updates.push(`recurrence_day = $${paramIndex}`);
      params.push(dto.recurrence_day);
      paramIndex++;
    }

    if (dto.supplier_id !== undefined) {
      updates.push(`supplier_id = $${paramIndex}`);
      params.push(dto.supplier_id);
      paramIndex++;
    }

    if (dto.recipient_name !== undefined) {
      updates.push(`recipient_name = $${paramIndex}`);
      params.push(dto.recipient_name);
      paramIndex++;
    }

    params.push(companyId, expenseId);

    const result = await this.pool.query<PlannedExpense>(
      `UPDATE planned_expenses
       SET ${updates.join(', ')}
       WHERE company_id = $${paramIndex} AND id = $${paramIndex + 1}
       RETURNING *`,
      params
    );

    return result.rows[0];
  }

  /**
   * Delete planned expense
   */
  async deletePlannedExpense(companyId: string, expenseId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM planned_expenses
       WHERE company_id = $1 AND id = $2`,
      [companyId, expenseId]
    );
  }

  /**
   * Mark planned expense as paid
   */
  async markPlannedExpenseAsPaid(
    companyId: string,
    expenseId: string,
    transactionId: string,
    paidDate: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE planned_expenses
       SET status = 'paid', paid_via_transaction_id = $1, paid_date = $2
       WHERE company_id = $3 AND id = $4`,
      [transactionId, paidDate, companyId, expenseId]
    );
  }
}
