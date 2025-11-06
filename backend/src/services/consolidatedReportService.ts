/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Service
 */

import pool from '../config/database';
import {
  ConsolidatedReportConfig,
  CreateConsolidatedReportConfigDto,
  UpdateConsolidatedReportConfigDto,
  ConsolidatedReportData,
  CompanyReportData
} from '../types/consolidatedReport.types';

/**
 * Create a new consolidated report configuration
 */
export const createReportConfig = async (
  userId: string,
  data: CreateConsolidatedReportConfigDto
): Promise<ConsolidatedReportConfig> => {
  // Verify user has access to all specified companies
  const companyAccessQuery = `
    SELECT COUNT(*) as count
    FROM user_companies
    WHERE user_id = $1 AND company_id = ANY($2::uuid[])
  `;

  const accessCheck = await pool.query(companyAccessQuery, [
    userId,
    data.company_ids
  ]);

  if (parseInt(accessCheck.rows[0].count) !== data.company_ids.length) {
    throw new Error('Access denied to one or more companies');
  }

  const query = `
    INSERT INTO consolidated_report_configs (
      user_id,
      name,
      description,
      company_ids,
      group_ids,
      report_type,
      date_range_start,
      date_range_end,
      currency,
      options
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;

  const values = [
    userId,
    data.name,
    data.description || null,
    JSON.stringify(data.company_ids),
    data.group_ids ? JSON.stringify(data.group_ids) : null,
    data.report_type,
    data.date_range_start || null,
    data.date_range_end || null,
    data.currency || 'SEK',
    data.options ? JSON.stringify(data.options) : null
  ];

  const result = await pool.query(query, values);

  // Parse JSON fields back
  const config = result.rows[0];
  config.company_ids = JSON.parse(config.company_ids);
  if (config.group_ids) config.group_ids = JSON.parse(config.group_ids);
  if (config.options) config.options = JSON.parse(config.options);

  return config;
};

/**
 * Get all report configs for a user
 */
export const getReportConfigs = async (
  userId: string
): Promise<ConsolidatedReportConfig[]> => {
  const query = `
    SELECT * FROM consolidated_report_configs
    WHERE user_id = $1
    ORDER BY updated_at DESC
  `;

  const result = await pool.query(query, [userId]);

  // Parse JSON fields
  return result.rows.map((config) => ({
    ...config,
    company_ids: JSON.parse(config.company_ids),
    group_ids: config.group_ids ? JSON.parse(config.group_ids) : null,
    options: config.options ? JSON.parse(config.options) : null
  }));
};

/**
 * Get a specific report config
 */
export const getReportConfigById = async (
  configId: string,
  userId: string
): Promise<ConsolidatedReportConfig | null> => {
  const query = `
    SELECT * FROM consolidated_report_configs
    WHERE id = $1 AND user_id = $2
  `;

  const result = await pool.query(query, [configId, userId]);

  if (result.rows.length === 0) {
    return null;
  }

  const config = result.rows[0];
  config.company_ids = JSON.parse(config.company_ids);
  if (config.group_ids) config.group_ids = JSON.parse(config.group_ids);
  if (config.options) config.options = JSON.parse(config.options);

  return config;
};

/**
 * Update a report config
 */
export const updateReportConfig = async (
  configId: string,
  userId: string,
  data: UpdateConsolidatedReportConfigDto
): Promise<ConsolidatedReportConfig | null> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${paramCount++}`);
    values.push(data.name);
  }

  if (data.description !== undefined) {
    fields.push(`description = $${paramCount++}`);
    values.push(data.description);
  }

  if (data.company_ids !== undefined) {
    fields.push(`company_ids = $${paramCount++}`);
    values.push(JSON.stringify(data.company_ids));
  }

  if (data.group_ids !== undefined) {
    fields.push(`group_ids = $${paramCount++}`);
    values.push(data.group_ids ? JSON.stringify(data.group_ids) : null);
  }

  if (data.report_type !== undefined) {
    fields.push(`report_type = $${paramCount++}`);
    values.push(data.report_type);
  }

  if (data.date_range_start !== undefined) {
    fields.push(`date_range_start = $${paramCount++}`);
    values.push(data.date_range_start);
  }

  if (data.date_range_end !== undefined) {
    fields.push(`date_range_end = $${paramCount++}`);
    values.push(data.date_range_end);
  }

  if (data.currency !== undefined) {
    fields.push(`currency = $${paramCount++}`);
    values.push(data.currency);
  }

  if (data.options !== undefined) {
    fields.push(`options = $${paramCount++}`);
    values.push(data.options ? JSON.stringify(data.options) : null);
  }

  if (fields.length === 0) {
    return null;
  }

  values.push(configId, userId);

  const query = `
    UPDATE consolidated_report_configs
    SET ${fields.join(', ')}
    WHERE id = $${paramCount++} AND user_id = $${paramCount++}
    RETURNING *
  `;

  const result = await pool.query(query, values);

  if (result.rows.length === 0) {
    return null;
  }

  const config = result.rows[0];
  config.company_ids = JSON.parse(config.company_ids);
  if (config.group_ids) config.group_ids = JSON.parse(config.group_ids);
  if (config.options) config.options = JSON.parse(config.options);

  return config;
};

/**
 * Delete a report config
 */
export const deleteReportConfig = async (
  configId: string,
  userId: string
): Promise<boolean> => {
  const query = `
    DELETE FROM consolidated_report_configs
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `;

  const result = await pool.query(query, [configId, userId]);
  return result.rows.length > 0;
};

/**
 * Generate consolidated report data
 * This is a placeholder that returns mock data structure
 * In a real implementation, this would aggregate actual financial data
 */
export const generateConsolidatedReport = async (
  userId: string,
  companyIds: string[],
  reportType: string,
  dateRangeStart: Date,
  dateRangeEnd: Date,
  currency: string = 'SEK'
): Promise<ConsolidatedReportData> => {
  // Verify user has access to all companies
  const companyAccessQuery = `
    SELECT c.id, c.name
    FROM companies c
    JOIN user_companies uc ON c.id = uc.company_id
    WHERE uc.user_id = $1 AND c.id = ANY($2::uuid[])
  `;

  const companiesResult = await pool.query(companyAccessQuery, [userId, companyIds]);

  if (companiesResult.rows.length !== companyIds.length) {
    throw new Error('Access denied to one or more companies');
  }

  // Mock data structure - in real implementation, aggregate actual financial data
  const companies: CompanyReportData[] = companiesResult.rows.map((company) => ({
    company_id: company.id,
    company_name: company.name,
    data: {
      // This would contain actual financial data based on report_type
      revenue: 0,
      expenses: 0,
      profit: 0,
      // Add more fields based on report_type
    }
  }));

  const consolidatedTotals: Record<string, number> = {
    total_revenue: companies.reduce((sum, c) => sum + (c.data.revenue || 0), 0),
    total_expenses: companies.reduce((sum, c) => sum + (c.data.expenses || 0), 0),
    total_profit: companies.reduce((sum, c) => sum + (c.data.profit || 0), 0)
  };

  return {
    report_type: reportType as any,
    date_range_start: dateRangeStart,
    date_range_end: dateRangeEnd,
    currency,
    companies,
    consolidated_totals: consolidatedTotals,
    generated_at: new Date()
  };
};

/**
 * Get companies from groups
 */
export const getCompaniesFromGroups = async (
  userId: string,
  groupIds: string[]
): Promise<string[]> => {
  const query = `
    SELECT DISTINCT cgm.company_id
    FROM company_group_members cgm
    JOIN company_groups cg ON cgm.group_id = cg.id
    JOIN user_companies uc ON cgm.company_id = uc.company_id
    WHERE cg.id = ANY($1::uuid[])
      AND (cg.created_by = $2 OR uc.user_id = $2)
  `;

  const result = await pool.query(query, [groupIds, userId]);
  return result.rows.map((row) => row.company_id);
};

/**
 * Get aggregated cross-company transaction data
 */
export const getConsolidatedTransactionData = async (
  userId: string,
  companyIds: string[],
  dateRangeStart: Date,
  dateRangeEnd: Date
): Promise<any> => {
  const query = `
    SELECT
      from_company_id,
      to_company_id,
      transaction_type,
      SUM(amount) as total_amount,
      COUNT(*) as transaction_count,
      currency
    FROM cross_company_transactions
    WHERE
      (from_company_id = ANY($1::uuid[]) OR to_company_id = ANY($1::uuid[]))
      AND transaction_date >= $2
      AND transaction_date <= $3
      AND status = 'completed'
    GROUP BY from_company_id, to_company_id, transaction_type, currency
  `;

  const result = await pool.query(query, [companyIds, dateRangeStart, dateRangeEnd]);
  return result.rows;
};
