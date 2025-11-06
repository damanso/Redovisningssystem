import { query } from '../config/database';
import {
  Budget,
  BudgetLine,
  BudgetVsActual,
  CreateBudgetRequest,
  UpdateBudgetRequest,
  CreateBudgetLineRequest,
  BudgetRevision
} from '../types/analytics.types';

/**
 * Budget Service
 * Handles budget creation, management, and budget vs actual analysis
 */

// ============================================
// BUDGET CRUD OPERATIONS
// ============================================

export const getAllBudgets = async (companyId: string): Promise<Budget[]> => {
  const result = await query(
    `SELECT * FROM budgets
     WHERE company_id = $1
     ORDER BY start_date DESC`,
    [companyId]
  );
  return result.rows;
};

export const getBudgetById = async (
  budgetId: string,
  companyId: string
): Promise<Budget | null> => {
  const result = await query(
    `SELECT * FROM budgets
     WHERE id = $1 AND company_id = $2`,
    [budgetId, companyId]
  );
  return result.rows[0] || null;
};

export const createBudget = async (
  companyId: string,
  userId: string,
  data: CreateBudgetRequest
): Promise<Budget> => {
  const result = await query(
    `INSERT INTO budgets (
      company_id, name, description, start_date, end_date, status, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      companyId,
      data.name,
      data.description || null,
      data.start_date,
      data.end_date,
      data.status || 'draft',
      userId
    ]
  );
  return result.rows[0];
};

export const updateBudget = async (
  budgetId: string,
  companyId: string,
  data: UpdateBudgetRequest
): Promise<Budget | null> => {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(data.name);
  }
  if (data.description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(data.description);
  }
  if (data.start_date !== undefined) {
    updates.push(`start_date = $${paramCount++}`);
    values.push(data.start_date);
  }
  if (data.end_date !== undefined) {
    updates.push(`end_date = $${paramCount++}`);
    values.push(data.end_date);
  }
  if (data.status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(data.status);
  }

  if (updates.length === 0) {
    return getBudgetById(budgetId, companyId);
  }

  values.push(budgetId, companyId);

  const result = await query(
    `UPDATE budgets
     SET ${updates.join(', ')}
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

export const deleteBudget = async (
  budgetId: string,
  companyId: string
): Promise<boolean> => {
  const result = await query(
    `DELETE FROM budgets
     WHERE id = $1 AND company_id = $2`,
    [budgetId, companyId]
  );
  return (result.rowCount ?? 0) > 0;
};

// ============================================
// BUDGET LINE OPERATIONS
// ============================================

export const getBudgetLines = async (
  budgetId: string,
  companyId: string
): Promise<BudgetLine[]> => {
  // Verify budget belongs to company
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const result = await query(
    `SELECT bl.*, ba.account_name, ba.account_type
     FROM budget_lines bl
     JOIN bas_accounts ba ON bl.account_number = ba.account_number
     WHERE bl.budget_id = $1
     ORDER BY bl.account_number, bl.period_start`,
    [budgetId]
  );
  return result.rows;
};

export const createBudgetLine = async (
  budgetId: string,
  companyId: string,
  data: CreateBudgetLineRequest
): Promise<BudgetLine> => {
  // Verify budget belongs to company
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const result = await query(
    `INSERT INTO budget_lines (
      budget_id, account_number, period_start, period_end, budgeted_amount, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      budgetId,
      data.account_number,
      data.period_start,
      data.period_end,
      data.budgeted_amount,
      data.notes || null
    ]
  );
  return result.rows[0];
};

export const updateBudgetLine = async (
  budgetLineId: string,
  budgetId: string,
  companyId: string,
  data: Partial<CreateBudgetLineRequest>
): Promise<BudgetLine | null> => {
  // Verify budget belongs to company
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.account_number !== undefined) {
    updates.push(`account_number = $${paramCount++}`);
    values.push(data.account_number);
  }
  if (data.period_start !== undefined) {
    updates.push(`period_start = $${paramCount++}`);
    values.push(data.period_start);
  }
  if (data.period_end !== undefined) {
    updates.push(`period_end = $${paramCount++}`);
    values.push(data.period_end);
  }
  if (data.budgeted_amount !== undefined) {
    updates.push(`budgeted_amount = $${paramCount++}`);
    values.push(data.budgeted_amount);
  }
  if (data.notes !== undefined) {
    updates.push(`notes = $${paramCount++}`);
    values.push(data.notes);
  }

  if (updates.length === 0) {
    const result = await query(
      `SELECT * FROM budget_lines WHERE id = $1 AND budget_id = $2`,
      [budgetLineId, budgetId]
    );
    return result.rows[0] || null;
  }

  values.push(budgetLineId, budgetId);

  const result = await query(
    `UPDATE budget_lines
     SET ${updates.join(', ')}
     WHERE id = $${paramCount} AND budget_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

export const deleteBudgetLine = async (
  budgetLineId: string,
  budgetId: string,
  companyId: string
): Promise<boolean> => {
  // Verify budget belongs to company
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const result = await query(
    `DELETE FROM budget_lines
     WHERE id = $1 AND budget_id = $2`,
    [budgetLineId, budgetId]
  );
  return (result.rowCount ?? 0) > 0;
};

// ============================================
// BUDGET VS ACTUAL ANALYSIS
// ============================================

export const getBudgetVsActual = async (
  budgetId: string,
  companyId: string,
  startDate?: string,
  endDate?: string
): Promise<BudgetVsActual[]> => {
  // Verify budget belongs to company
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  // Use budget dates if not provided
  const periodStart = startDate || budget.start_date;
  const periodEnd = endDate || budget.end_date;

  const result = await query(
    `SELECT * FROM get_budget_vs_actual($1, $2, $3)`,
    [budgetId, periodStart, periodEnd]
  );

  return result.rows;
};

export const getBudgetSummary = async (
  budgetId: string,
  companyId: string
): Promise<{
  total_budgeted: number;
  total_actual: number;
  total_variance: number;
  variance_percentage: number;
  accounts_over_budget: number;
  accounts_under_budget: number;
}> => {
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const budgetVsActual = await getBudgetVsActual(
    budgetId,
    companyId,
    budget.start_date,
    budget.end_date
  );

  const summary = budgetVsActual.reduce(
    (acc, row) => {
      acc.total_budgeted += row.budgeted_amount;
      acc.total_actual += row.actual_amount;
      acc.total_variance += row.variance;

      if (row.variance > 0) {
        acc.accounts_over_budget++;
      } else if (row.variance < 0) {
        acc.accounts_under_budget++;
      }

      return acc;
    },
    {
      total_budgeted: 0,
      total_actual: 0,
      total_variance: 0,
      variance_percentage: 0,
      accounts_over_budget: 0,
      accounts_under_budget: 0
    }
  );

  // Calculate variance percentage
  if (summary.total_budgeted > 0) {
    summary.variance_percentage =
      (summary.total_variance / summary.total_budgeted) * 100;
  }

  return summary;
};

// ============================================
// BUDGET REVISIONS
// ============================================

export const createBudgetRevision = async (
  budgetId: string,
  companyId: string,
  userId: string,
  reason: string,
  changes: Record<string, any>
): Promise<BudgetRevision> => {
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  // Get next revision number
  const revisionCountResult = await query(
    `SELECT COALESCE(MAX(revision_number), 0) + 1 as next_revision
     FROM budget_revisions
     WHERE budget_id = $1`,
    [budgetId]
  );

  const nextRevision = revisionCountResult.rows[0].next_revision;

  const result = await query(
    `INSERT INTO budget_revisions (
      budget_id, revision_number, revised_by, reason, changes
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [budgetId, nextRevision, userId, reason, JSON.stringify(changes)]
  );

  return result.rows[0];
};

export const getBudgetRevisions = async (
  budgetId: string,
  companyId: string
): Promise<BudgetRevision[]> => {
  const budget = await getBudgetById(budgetId, companyId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const result = await query(
    `SELECT br.*, u.name as revised_by_name
     FROM budget_revisions br
     JOIN users u ON br.revised_by = u.id
     WHERE br.budget_id = $1
     ORDER BY br.revision_number DESC`,
    [budgetId]
  );

  return result.rows;
};

// ============================================
// BULK OPERATIONS
// ============================================

export const createBudgetWithLines = async (
  companyId: string,
  userId: string,
  budgetData: CreateBudgetRequest,
  lines: CreateBudgetLineRequest[]
): Promise<{ budget: Budget; lines: BudgetLine[] }> => {
  // Create budget
  const budget = await createBudget(companyId, userId, budgetData);

  // Create lines
  const createdLines: BudgetLine[] = [];
  for (const line of lines) {
    const createdLine = await createBudgetLine(budget.id, companyId, line);
    createdLines.push(createdLine);
  }

  return { budget, lines: createdLines };
};

export const copyBudget = async (
  sourceBudgetId: string,
  companyId: string,
  userId: string,
  newName: string,
  newStartDate: string,
  newEndDate: string
): Promise<{ budget: Budget; lines: BudgetLine[] }> => {
  // Get source budget
  const sourceBudget = await getBudgetById(sourceBudgetId, companyId);
  if (!sourceBudget) {
    throw new Error('Source budget not found');
  }

  // Get source budget lines
  const sourceLines = await getBudgetLines(sourceBudgetId, companyId);

  // Create new budget
  const newBudget = await createBudget(companyId, userId, {
    name: newName,
    description: `Copy of ${sourceBudget.name}`,
    start_date: newStartDate,
    end_date: newEndDate,
    status: 'draft'
  });

  // Copy lines with adjusted dates
  const newLines: BudgetLine[] = [];
  for (const line of sourceLines) {
    const newLine = await createBudgetLine(newBudget.id, companyId, {
      account_number: line.account_number,
      period_start: newStartDate,
      period_end: newEndDate,
      budgeted_amount: line.budgeted_amount,
      notes: line.notes || undefined
    });
    newLines.push(newLine);
  }

  return { budget: newBudget, lines: newLines };
};
