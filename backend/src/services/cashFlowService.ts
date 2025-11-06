import { query } from '../config/database';
import {
  CashFlowForecast,
  CashFlowForecastLine,
  CashFlowPattern,
  CashFlowProjection,
  CashFlowScenario,
  CreateCashFlowForecastRequest,
  UpdateCashFlowForecastRequest,
  CreateCashFlowForecastLineRequest
} from '../types/analytics.types';

/**
 * Cash Flow Forecasting Service
 * Handles cash flow projections, pattern analysis, and scenario planning
 */

// ============================================
// CASH FLOW FORECAST CRUD OPERATIONS
// ============================================

export const getAllForecasts = async (
  companyId: string
): Promise<CashFlowForecast[]> => {
  const result = await query(
    `SELECT * FROM cash_flow_forecasts
     WHERE company_id = $1
     ORDER BY start_date DESC`,
    [companyId]
  );
  return result.rows;
};

export const getForecastById = async (
  forecastId: string,
  companyId: string
): Promise<CashFlowForecast | null> => {
  const result = await query(
    `SELECT * FROM cash_flow_forecasts
     WHERE id = $1 AND company_id = $2`,
    [forecastId, companyId]
  );
  return result.rows[0] || null;
};

export const createForecast = async (
  companyId: string,
  userId: string,
  data: CreateCashFlowForecastRequest
): Promise<CashFlowForecast> => {
  // Get current bank balance as opening balance if not provided
  let openingBalance = data.opening_balance || 0;

  if (!data.opening_balance) {
    const bankBalanceResult = await query(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as balance
       FROM journal_entry_lines jel
       JOIN journal_entries je ON jel.journal_entry_id = je.id
       WHERE je.company_id = $1
       AND jel.account_number IN (1910, 1930)`,
      [companyId]
    );
    openingBalance = parseFloat(bankBalanceResult.rows[0]?.balance || 0);
  }

  const result = await query(
    `INSERT INTO cash_flow_forecasts (
      company_id, name, description, forecast_type, start_date, end_date,
      opening_balance, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      companyId,
      data.name,
      data.description || null,
      data.forecast_type,
      data.start_date,
      data.end_date,
      openingBalance,
      userId
    ]
  );

  const forecast = result.rows[0];

  // Generate forecast lines automatically
  await generateForecast(
    forecast.id,
    companyId,
    data.start_date,
    data.end_date,
    data.forecast_type
  );

  return forecast;
};

export const updateForecast = async (
  forecastId: string,
  companyId: string,
  data: UpdateCashFlowForecastRequest
): Promise<CashFlowForecast | null> => {
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
  if (data.forecast_type !== undefined) {
    updates.push(`forecast_type = $${paramCount++}`);
    values.push(data.forecast_type);
  }
  if (data.start_date !== undefined) {
    updates.push(`start_date = $${paramCount++}`);
    values.push(data.start_date);
  }
  if (data.end_date !== undefined) {
    updates.push(`end_date = $${paramCount++}`);
    values.push(data.end_date);
  }
  if (data.opening_balance !== undefined) {
    updates.push(`opening_balance = $${paramCount++}`);
    values.push(data.opening_balance);
  }

  if (updates.length === 0) {
    return getForecastById(forecastId, companyId);
  }

  values.push(forecastId, companyId);

  const result = await query(
    `UPDATE cash_flow_forecasts
     SET ${updates.join(', ')}
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

export const deleteForecast = async (
  forecastId: string,
  companyId: string
): Promise<boolean> => {
  const result = await query(
    `DELETE FROM cash_flow_forecasts
     WHERE id = $1 AND company_id = $2`,
    [forecastId, companyId]
  );
  return (result.rowCount ?? 0) > 0;
};

// ============================================
// FORECAST LINE OPERATIONS
// ============================================

export const getForecastLines = async (
  forecastId: string,
  companyId: string
): Promise<CashFlowForecastLine[]> => {
  const forecast = await getForecastById(forecastId, companyId);
  if (!forecast) {
    throw new Error('Forecast not found');
  }

  const result = await query(
    `SELECT * FROM cash_flow_forecast_lines
     WHERE forecast_id = $1
     ORDER BY transaction_date, category`,
    [forecastId]
  );
  return result.rows;
};

export const createForecastLine = async (
  forecastId: string,
  companyId: string,
  data: CreateCashFlowForecastLineRequest
): Promise<CashFlowForecastLine> => {
  const forecast = await getForecastById(forecastId, companyId);
  if (!forecast) {
    throw new Error('Forecast not found');
  }

  const result = await query(
    `INSERT INTO cash_flow_forecast_lines (
      forecast_id, transaction_date, category, description, amount,
      confidence_level, source_type, source_id, is_recurring, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      forecastId,
      data.transaction_date,
      data.category,
      data.description || null,
      data.amount,
      data.confidence_level || 100,
      data.source_type || null,
      data.source_id || null,
      data.is_recurring || false,
      data.notes || null
    ]
  );
  return result.rows[0];
};

export const deleteForecastLine = async (
  lineId: string,
  forecastId: string,
  companyId: string
): Promise<boolean> => {
  const forecast = await getForecastById(forecastId, companyId);
  if (!forecast) {
    throw new Error('Forecast not found');
  }

  const result = await query(
    `DELETE FROM cash_flow_forecast_lines
     WHERE id = $1 AND forecast_id = $2`,
    [lineId, forecastId]
  );
  return (result.rowCount ?? 0) > 0;
};

// ============================================
// FORECAST GENERATION
// ============================================

export const generateForecast = async (
  forecastId: string,
  companyId: string,
  startDate: string,
  endDate: string,
  forecastType: string
): Promise<void> => {
  // First, update payment patterns
  await calculatePaymentPatterns(companyId);

  // Then generate forecast using database function
  await query(`SELECT generate_cash_flow_forecast($1, $2, $3, $4, $5)`, [
    companyId,
    forecastId,
    startDate,
    endDate,
    forecastType
  ]);
};

export const regenerateForecast = async (
  forecastId: string,
  companyId: string
): Promise<void> => {
  const forecast = await getForecastById(forecastId, companyId);
  if (!forecast) {
    throw new Error('Forecast not found');
  }

  await generateForecast(
    forecastId,
    companyId,
    forecast.start_date,
    forecast.end_date,
    forecast.forecast_type
  );
};

// ============================================
// PAYMENT PATTERNS
// ============================================

export const calculatePaymentPatterns = async (
  companyId: string
): Promise<void> => {
  await query(`SELECT calculate_payment_patterns($1)`, [companyId]);
};

export const getPaymentPatterns = async (
  companyId: string
): Promise<CashFlowPattern[]> => {
  const result = await query(
    `SELECT * FROM cash_flow_patterns
     WHERE company_id = $1
     ORDER BY pattern_type, category, period_identifier`,
    [companyId]
  );
  return result.rows;
};

// ============================================
// CASH FLOW PROJECTIONS
// ============================================

export const getForecastProjection = async (
  forecastId: string,
  companyId: string
): Promise<CashFlowProjection[]> => {
  const forecast = await getForecastById(forecastId, companyId);
  if (!forecast) {
    throw new Error('Forecast not found');
  }

  const result = await query(
    `SELECT * FROM get_cash_flow_projection($1)`,
    [forecastId]
  );

  return result.rows.map((row) => ({
    projection_date: row.projection_date,
    inflows: parseFloat(row.inflows || 0),
    outflows: parseFloat(row.outflows || 0),
    net_flow: parseFloat(row.net_flow || 0),
    running_balance: parseFloat(row.running_balance || 0)
  }));
};

export const getForecastSummary = async (
  forecastId: string,
  companyId: string
): Promise<{
  opening_balance: number;
  total_inflows: number;
  total_outflows: number;
  net_flow: number;
  closing_balance: number;
  lowest_balance: number;
  lowest_balance_date: string;
  highest_balance: number;
  highest_balance_date: string;
}> => {
  const forecast = await getForecastById(forecastId, companyId);
  if (!forecast) {
    throw new Error('Forecast not found');
  }

  const projection = await getForecastProjection(forecastId, companyId);

  if (projection.length === 0) {
    return {
      opening_balance: forecast.opening_balance,
      total_inflows: 0,
      total_outflows: 0,
      net_flow: 0,
      closing_balance: forecast.opening_balance,
      lowest_balance: forecast.opening_balance,
      lowest_balance_date: forecast.start_date,
      highest_balance: forecast.opening_balance,
      highest_balance_date: forecast.start_date
    };
  }

  const totalInflows = projection.reduce((sum, p) => sum + p.inflows, 0);
  const totalOutflows = projection.reduce((sum, p) => sum + p.outflows, 0);
  const closingBalance = projection[projection.length - 1].running_balance;

  // Find lowest and highest balances
  let lowestBalance = forecast.opening_balance;
  let lowestBalanceDate = forecast.start_date;
  let highestBalance = forecast.opening_balance;
  let highestBalanceDate = forecast.start_date;

  for (const p of projection) {
    if (p.running_balance < lowestBalance) {
      lowestBalance = p.running_balance;
      lowestBalanceDate = p.projection_date;
    }
    if (p.running_balance > highestBalance) {
      highestBalance = p.running_balance;
      highestBalanceDate = p.projection_date;
    }
  }

  return {
    opening_balance: forecast.opening_balance,
    total_inflows: totalInflows,
    total_outflows: totalOutflows,
    net_flow: totalInflows - totalOutflows,
    closing_balance: closingBalance,
    lowest_balance: lowestBalance,
    lowest_balance_date: lowestBalanceDate,
    highest_balance: highestBalance,
    highest_balance_date: highestBalanceDate
  };
};

// ============================================
// SCENARIOS
// ============================================

export const createScenario = async (
  companyId: string,
  userId: string,
  name: string,
  description: string,
  baseForecastId: string | null,
  assumptions: Record<string, any>
): Promise<CashFlowScenario> => {
  if (baseForecastId) {
    const forecast = await getForecastById(baseForecastId, companyId);
    if (!forecast) {
      throw new Error('Base forecast not found');
    }
  }

  const result = await query(
    `INSERT INTO cash_flow_scenarios (
      company_id, name, description, base_forecast_id, assumptions, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      companyId,
      name,
      description,
      baseForecastId || null,
      JSON.stringify(assumptions),
      userId
    ]
  );

  return result.rows[0];
};

export const getScenarios = async (
  companyId: string
): Promise<CashFlowScenario[]> => {
  const result = await query(
    `SELECT * FROM cash_flow_scenarios
     WHERE company_id = $1
     ORDER BY created_at DESC`,
    [companyId]
  );
  return result.rows;
};

export const compareScenarios = async (
  companyId: string,
  forecastIds: string[]
): Promise<{
    forecast_id: string;
    forecast_name: string;
    closing_balance: number;
    net_flow: number;
  }[]> => {
  const comparisons = [];

  for (const forecastId of forecastIds) {
    const forecast = await getForecastById(forecastId, companyId);
    if (!forecast) continue;

    const summary = await getForecastSummary(forecastId, companyId);

    comparisons.push({
      forecast_id: forecast.id,
      forecast_name: forecast.name,
      closing_balance: summary.closing_balance,
      net_flow: summary.net_flow
    });
  }

  return comparisons;
};

// ============================================
// QUICK PROJECTIONS
// ============================================

export const getQuickProjection = async (
  companyId: string,
  days: number = 30
): Promise<{
  current_balance: number;
  projected_balance: number;
  expected_inflows: number;
  expected_outflows: number;
}> => {
  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const endDate = futureDate.toISOString().split('T')[0];

  // Get current balance
  const balanceResult = await query(
    `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as balance
     FROM journal_entry_lines jel
     JOIN journal_entries je ON jel.journal_entry_id = je.id
     WHERE je.company_id = $1
     AND jel.account_number IN (1910, 1930)`,
    [companyId]
  );
  const currentBalance = parseFloat(balanceResult.rows[0]?.balance || 0);

  // Get expected receivables
  const receivablesResult = await query(
    `SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as amount
     FROM invoices
     WHERE company_id = $1
     AND status IN ('sent', 'overdue')
     AND due_date <= $2`,
    [companyId, endDate]
  );
  const expectedInflows = parseFloat(receivablesResult.rows[0]?.amount || 0);

  // Get expected payables (pending receipts)
  const payablesResult = await query(
    `SELECT COALESCE(SUM(total_amount), 0) as amount
     FROM receipts
     WHERE company_id = $1
     AND status = 'pending'
     AND created_at::DATE <= $2`,
    [companyId, endDate]
  );
  const expectedOutflows = parseFloat(payablesResult.rows[0]?.amount || 0);

  const projectedBalance =
    currentBalance + expectedInflows - expectedOutflows;

  return {
    current_balance: currentBalance,
    projected_balance: projectedBalance,
    expected_inflows: expectedInflows,
    expected_outflows: expectedOutflows
  };
};
