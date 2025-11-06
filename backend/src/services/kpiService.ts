import { query } from '../config/database';
import {
  KPIDefinition,
  KPIValue,
  KPITarget,
  KPIWithValue,
  CreateKPIDefinitionRequest,
  UpdateKPIDefinitionRequest,
  CreateKPIValueRequest
} from '../types/analytics.types';

/**
 * KPI Service
 * Handles KPI definitions, calculations, and tracking
 */

// ============================================
// KPI DEFINITION CRUD OPERATIONS
// ============================================

export const getAllKPIDefinitions = async (
  companyId: string
): Promise<KPIDefinition[]> => {
  const result = await query(
    `SELECT * FROM kpi_definitions
     WHERE company_id = $1
     ORDER BY category, name`,
    [companyId]
  );
  return result.rows;
};

export const getKPIDefinitionById = async (
  kpiId: string,
  companyId: string
): Promise<KPIDefinition | null> => {
  const result = await query(
    `SELECT * FROM kpi_definitions
     WHERE id = $1 AND company_id = $2`,
    [kpiId, companyId]
  );
  return result.rows[0] || null;
};

export const getKPIDefinitionByCode = async (
  code: string,
  companyId: string
): Promise<KPIDefinition | null> => {
  const result = await query(
    `SELECT * FROM kpi_definitions
     WHERE code = $1 AND company_id = $2`,
    [code, companyId]
  );
  return result.rows[0] || null;
};

export const createKPIDefinition = async (
  companyId: string,
  data: CreateKPIDefinitionRequest
): Promise<KPIDefinition> => {
  const result = await query(
    `INSERT INTO kpi_definitions (
      company_id, code, name, description, category, unit,
      calculation_method, target_value, target_operator, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      companyId,
      data.code,
      data.name,
      data.description || null,
      data.category,
      data.unit,
      data.calculation_method || null,
      data.target_value || null,
      data.target_operator || null,
      data.is_active !== undefined ? data.is_active : true
    ]
  );
  return result.rows[0];
};

export const updateKPIDefinition = async (
  kpiId: string,
  companyId: string,
  data: UpdateKPIDefinitionRequest
): Promise<KPIDefinition | null> => {
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
  if (data.category !== undefined) {
    updates.push(`category = $${paramCount++}`);
    values.push(data.category);
  }
  if (data.unit !== undefined) {
    updates.push(`unit = $${paramCount++}`);
    values.push(data.unit);
  }
  if (data.calculation_method !== undefined) {
    updates.push(`calculation_method = $${paramCount++}`);
    values.push(data.calculation_method);
  }
  if (data.target_value !== undefined) {
    updates.push(`target_value = $${paramCount++}`);
    values.push(data.target_value);
  }
  if (data.target_operator !== undefined) {
    updates.push(`target_operator = $${paramCount++}`);
    values.push(data.target_operator);
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${paramCount++}`);
    values.push(data.is_active);
  }

  if (updates.length === 0) {
    return getKPIDefinitionById(kpiId, companyId);
  }

  values.push(kpiId, companyId);

  const result = await query(
    `UPDATE kpi_definitions
     SET ${updates.join(', ')}
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

export const deleteKPIDefinition = async (
  kpiId: string,
  companyId: string
): Promise<boolean> => {
  const result = await query(
    `DELETE FROM kpi_definitions
     WHERE id = $1 AND company_id = $2`,
    [kpiId, companyId]
  );
  return (result.rowCount ?? 0) > 0;
};

// ============================================
// KPI VALUE OPERATIONS
// ============================================

export const getKPIValues = async (
  kpiId: string,
  companyId: string,
  startDate?: string,
  endDate?: string
): Promise<KPIValue[]> => {
  const kpi = await getKPIDefinitionById(kpiId, companyId);
  if (!kpi) {
    throw new Error('KPI definition not found');
  }

  let queryText = `
    SELECT * FROM kpi_values
    WHERE kpi_definition_id = $1
  `;
  const params: any[] = [kpiId];

  if (startDate) {
    params.push(startDate);
    queryText += ` AND period_end >= $${params.length}`;
  }

  if (endDate) {
    params.push(endDate);
    queryText += ` AND period_start <= $${params.length}`;
  }

  queryText += ` ORDER BY period_start DESC`;

  const result = await query(queryText, params);
  return result.rows;
};

export const createKPIValue = async (
  companyId: string,
  data: CreateKPIValueRequest
): Promise<KPIValue> => {
  const kpi = await getKPIDefinitionById(data.kpi_definition_id, companyId);
  if (!kpi) {
    throw new Error('KPI definition not found');
  }

  const result = await query(
    `INSERT INTO kpi_values (
      kpi_definition_id, period_start, period_end, value, notes, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      data.kpi_definition_id,
      data.period_start,
      data.period_end,
      data.value,
      data.notes || null,
      JSON.stringify(data.metadata || {})
    ]
  );
  return result.rows[0];
};

// ============================================
// KPI CALCULATION ENGINE
// ============================================

export const calculateKPI = async (
  code: string,
  companyId: string,
  startDate: string,
  endDate: string
): Promise<number> => {
  const kpi = await getKPIDefinitionByCode(code, companyId);
  if (!kpi) {
    throw new Error(`KPI definition not found: ${code}`);
  }

  let value = 0;

  switch (code) {
    case 'REVENUE_GROWTH':
      value = await calculateRevenueGrowth(companyId, startDate, endDate);
      break;
    case 'INVOICE_COLLECTION_TIME':
      value = await calculateCollectionTime(companyId, startDate, endDate);
      break;
    case 'OVERDUE_INVOICE_RATIO':
      value = await calculateOverdueRatio(companyId, startDate, endDate);
      break;
    case 'REVENUE_PER_CUSTOMER':
      value = await calculateRevenuePerCustomer(companyId, startDate, endDate);
      break;
    case 'GROSS_MARGIN':
      value = await calculateGrossMargin(companyId, startDate, endDate);
      break;
    default:
      throw new Error(`Unknown KPI code: ${code}`);
  }

  return value;
};

export const calculateAndSaveKPI = async (
  code: string,
  companyId: string,
  startDate: string,
  endDate: string
): Promise<KPIValue> => {
  const kpi = await getKPIDefinitionByCode(code, companyId);
  if (!kpi) {
    throw new Error(`KPI definition not found: ${code}`);
  }

  const value = await calculateKPI(code, companyId, startDate, endDate);

  return createKPIValue(companyId, {
    kpi_definition_id: kpi.id,
    period_start: startDate,
    period_end: endDate,
    value,
    notes: 'Auto-calculated'
  });
};

export const calculateAllKPIs = async (
  companyId: string,
  startDate: string,
  endDate: string
): Promise<KPIValue[]> => {
  const kpis = await getAllKPIDefinitions(companyId);
  const values: KPIValue[] = [];

  for (const kpi of kpis.filter((k) => k.is_active)) {
    try {
      const value = await calculateAndSaveKPI(
        kpi.code,
        companyId,
        startDate,
        endDate
      );
      values.push(value);
    } catch (error) {
      console.error(`Error calculating KPI ${kpi.code}:`, error);
    }
  }

  return values;
};

// ============================================
// KPI CALCULATION FUNCTIONS
// ============================================

const calculateRevenueGrowth = async (
  companyId: string,
  startDate: string,
  endDate: string
): Promise<number> => {
  const result = await query(
    `SELECT calculate_revenue_growth_kpi($1, $2, $3) as value`,
    [companyId, startDate, endDate]
  );
  return parseFloat(result.rows[0]?.value || 0);
};

const calculateCollectionTime = async (
  companyId: string,
  startDate: string,
  endDate: string
): Promise<number> => {
  const result = await query(
    `SELECT calculate_collection_time_kpi($1, $2, $3) as value`,
    [companyId, startDate, endDate]
  );
  return parseFloat(result.rows[0]?.value || 0);
};

const calculateOverdueRatio = async (
  companyId: string,
  startDate: string,
  endDate: string
): Promise<number> => {
  const result = await query(
    `SELECT calculate_overdue_ratio_kpi($1, $2, $3) as value`,
    [companyId, startDate, endDate]
  );
  return parseFloat(result.rows[0]?.value || 0);
};

const calculateRevenuePerCustomer = async (
  companyId: string,
  startDate: string,
  endDate: string
): Promise<number> => {
  const result = await query(
    `SELECT calculate_revenue_per_customer_kpi($1, $2, $3) as value`,
    [companyId, startDate, endDate]
  );
  return parseFloat(result.rows[0]?.value || 0);
};

const calculateGrossMargin = async (
  companyId: string,
  startDate: string,
  endDate: string
): Promise<number> => {
  const result = await query(
    `SELECT calculate_gross_margin_kpi($1, $2, $3) as value`,
    [companyId, startDate, endDate]
  );
  return parseFloat(result.rows[0]?.value || 0);
};

// ============================================
// KPI DASHBOARD & REPORTING
// ============================================

export const getKPIDashboard = async (
  companyId: string,
  startDate?: string,
  endDate?: string
): Promise<KPIWithValue[]> => {
  const definitions = await getAllKPIDefinitions(companyId);
  const dashboard: KPIWithValue[] = [];

  for (const kpi of definitions.filter((k) => k.is_active)) {
    const values = await getKPIValues(kpi.id, companyId, startDate, endDate);

    const kpiWithValue: KPIWithValue = {
      ...kpi,
      current_value: values[0]?.value,
      status: 'no_data',
      trend: 'stable'
    };

    // Determine status
    if (values.length > 0 && kpi.target_value !== null) {
      const currentValue = values[0].value;
      const targetValue = kpi.target_value;

      switch (kpi.target_operator) {
        case 'greater_than':
          kpiWithValue.status =
            currentValue >= targetValue ? 'on_target' : 'off_target';
          break;
        case 'less_than':
          kpiWithValue.status =
            currentValue <= targetValue ? 'on_target' : 'off_target';
          break;
        case 'equals':
          kpiWithValue.status =
            currentValue === targetValue ? 'on_target' : 'off_target';
          break;
      }
    } else if (values.length > 0) {
      kpiWithValue.status = 'on_target'; // No target set, assume OK
    }

    // Determine trend
    if (values.length >= 2) {
      const current = values[0].value;
      const previous = values[1].value;

      if (current > previous) {
        kpiWithValue.trend = 'up';
      } else if (current < previous) {
        kpiWithValue.trend = 'down';
      } else {
        kpiWithValue.trend = 'stable';
      }
    }

    dashboard.push(kpiWithValue);
  }

  return dashboard;
};

export const getKPITrend = async (
  kpiId: string,
  companyId: string,
  periods: number = 12
): Promise<KPIValue[]> => {
  const kpi = await getKPIDefinitionById(kpiId, companyId);
  if (!kpi) {
    throw new Error('KPI definition not found');
  }

  const result = await query(
    `SELECT * FROM kpi_values
     WHERE kpi_definition_id = $1
     ORDER BY period_start DESC
     LIMIT $2`,
    [kpiId, periods]
  );

  return result.rows.reverse(); // Return oldest to newest
};

// ============================================
// KPI TARGETS
// ============================================

export const createKPITarget = async (
  kpiId: string,
  companyId: string,
  periodStart: string,
  periodEnd: string,
  targetValue: number,
  notes?: string
): Promise<KPITarget> => {
  const kpi = await getKPIDefinitionById(kpiId, companyId);
  if (!kpi) {
    throw new Error('KPI definition not found');
  }

  const result = await query(
    `INSERT INTO kpi_targets (
      kpi_definition_id, period_start, period_end, target_value, notes
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [kpiId, periodStart, periodEnd, targetValue, notes || null]
  );

  return result.rows[0];
};

export const getKPITargets = async (
  kpiId: string,
  companyId: string
): Promise<KPITarget[]> => {
  const kpi = await getKPIDefinitionById(kpiId, companyId);
  if (!kpi) {
    throw new Error('KPI definition not found');
  }

  const result = await query(
    `SELECT * FROM kpi_targets
     WHERE kpi_definition_id = $1
     ORDER BY period_start DESC`,
    [kpiId]
  );

  return result.rows;
};
