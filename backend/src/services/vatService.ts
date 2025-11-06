/**
 * VAT (Moms) Service
 * Handles VAT report generation, tax period management, and Skatteverket integration
 */

import { query } from '../config/database';
import {
  VATReport,
  VATReportLine,
  VATSummary,
  TaxPeriod,
  CreateVATReportInput,
  UpdateVATReportInput,
  CreateTaxPeriodInput,
  UpdateTaxPeriodInput,
  GenerateVATReportInput,
  VATReportStatus,
  VATType,
  TransactionType,
  VATReportFilters,
  TaxPeriodFilters,
} from '../types/vat.types';

// Constants for BAS accounts
const VAT_ACCOUNTS = {
  INCOMING: '1630', // Ingående moms (deductible VAT on purchases)
  OUTGOING_25: '2610', // Utgående moms 25% (VAT on sales)
  OUTGOING_12: '2611', // Utgående moms 12% (if implemented)
  OUTGOING_6: '2612', // Utgående moms 6% (if implemented)
};

// ============================================================================
// TAX PERIOD MANAGEMENT
// ============================================================================

/**
 * Get all tax periods with optional filtering
 */
export const getTaxPeriods = async (filters?: TaxPeriodFilters): Promise<TaxPeriod[]> => {
  let queryText = 'SELECT * FROM tax_periods WHERE 1=1';
  const params: any[] = [];
  let paramCount = 1;

  if (filters?.company_id) {
    queryText += ` AND company_id = $${paramCount}`;
    params.push(filters.company_id);
    paramCount++;
  }

  if (filters?.period_type) {
    queryText += ` AND period_type = $${paramCount}`;
    params.push(filters.period_type);
    paramCount++;
  }

  if (filters?.period_year) {
    queryText += ` AND period_year = $${paramCount}`;
    params.push(filters.period_year);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  queryText += ' ORDER BY period_year DESC, period_number DESC';

  const result = await query(queryText, params);
  return result.rows;
};

/**
 * Get tax period by ID
 */
export const getTaxPeriodById = async (
  periodId: string,
  companyId: string
): Promise<TaxPeriod | null> => {
  const result = await query(
    'SELECT * FROM tax_periods WHERE id = $1 AND company_id = $2',
    [periodId, companyId]
  );
  return result.rows[0] || null;
};

/**
 * Create a new tax period
 */
export const createTaxPeriod = async (data: CreateTaxPeriodInput): Promise<TaxPeriod> => {
  const result = await query(
    `INSERT INTO tax_periods (
      company_id, period_type, period_year, period_number,
      start_date, end_date, due_date, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      data.company_id,
      data.period_type,
      data.period_year,
      data.period_number,
      data.start_date,
      data.end_date,
      data.due_date || null,
      'open',
    ]
  );
  return result.rows[0];
};

/**
 * Update tax period
 */
export const updateTaxPeriod = async (
  periodId: string,
  companyId: string,
  updates: UpdateTaxPeriodInput
): Promise<TaxPeriod | null> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount}`);
    values.push(updates.status);
    paramCount++;
  }

  if (updates.due_date !== undefined) {
    fields.push(`due_date = $${paramCount}`);
    values.push(updates.due_date);
    paramCount++;
  }

  if (fields.length === 0) {
    return getTaxPeriodById(periodId, companyId);
  }

  values.push(periodId, companyId);
  const result = await query(
    `UPDATE tax_periods SET ${fields.join(', ')}
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

// ============================================================================
// VAT CALCULATION
// ============================================================================

/**
 * Calculate VAT summary for a given period
 * Aggregates VAT amounts from journal entries, invoices, and receipts
 */
export const calculateVATSummary = async (
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<VATSummary> => {
  // Query for outgoing VAT (sales - account 2610)
  const outgoingResult = await query(
    `SELECT
      COALESCE(SUM(jel.credit), 0) as total_outgoing_vat
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.company_id = $1
      AND je.entry_date >= $2
      AND je.entry_date <= $3
      AND jel.account_number IN ('2610', '2611', '2612')`,
    [companyId, periodStart, periodEnd]
  );

  // Query for incoming VAT (purchases - account 1630)
  const incomingResult = await query(
    `SELECT
      COALESCE(SUM(jel.debit), 0) as total_incoming_vat
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.company_id = $1
      AND je.entry_date >= $2
      AND je.entry_date <= $3
      AND jel.account_number = '1630'`,
    [companyId, periodStart, periodEnd]
  );

  // Get breakdown by VAT rate from invoices
  const invoiceVATResult = await query(
    `SELECT
      il.vat_rate,
      SUM((il.quantity * il.unit_price) * (il.vat_rate / 100)) as vat_amount
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE i.company_id = $1
      AND i.invoice_date >= $2
      AND i.invoice_date <= $3
      AND i.status IN ('sent', 'paid', 'overdue')
    GROUP BY il.vat_rate`,
    [companyId, periodStart, periodEnd]
  );

  // Count transactions
  const countResult = await query(
    `SELECT
      COUNT(DISTINCT je.id) as transaction_count
    FROM journal_entries je
    WHERE je.company_id = $1
      AND je.entry_date >= $2
      AND je.entry_date <= $3`,
    [companyId, periodStart, periodEnd]
  );

  // Process VAT breakdown by rate
  let outgoing_vat_25 = 0;
  let outgoing_vat_12 = 0;
  let outgoing_vat_6 = 0;
  let outgoing_vat_0 = 0;

  invoiceVATResult.rows.forEach((row) => {
    const rate = parseFloat(row.vat_rate);
    const amount = parseFloat(row.vat_amount);

    if (rate === 25) outgoing_vat_25 += amount;
    else if (rate === 12) outgoing_vat_12 += amount;
    else if (rate === 6) outgoing_vat_6 += amount;
    else if (rate === 0) outgoing_vat_0 += amount;
  });

  const total_outgoing_vat = parseFloat(outgoingResult.rows[0].total_outgoing_vat);
  const incoming_vat = parseFloat(incomingResult.rows[0].total_incoming_vat);
  const net_vat_amount = total_outgoing_vat - incoming_vat;

  return {
    period_start: periodStart,
    period_end: periodEnd,
    outgoing_vat_25,
    outgoing_vat_12,
    outgoing_vat_6,
    outgoing_vat_0,
    total_outgoing_vat,
    incoming_vat,
    net_vat_amount,
    transaction_count: parseInt(countResult.rows[0].transaction_count || '0'),
  };
};

// ============================================================================
// VAT REPORT MANAGEMENT
// ============================================================================

/**
 * Get all VAT reports with optional filtering
 */
export const getVATReports = async (filters?: VATReportFilters): Promise<VATReport[]> => {
  let queryText = 'SELECT * FROM vat_reports WHERE 1=1';
  const params: any[] = [];
  let paramCount = 1;

  if (filters?.company_id) {
    queryText += ` AND company_id = $${paramCount}`;
    params.push(filters.company_id);
    paramCount++;
  }

  if (filters?.tax_period_id) {
    queryText += ` AND tax_period_id = $${paramCount}`;
    params.push(filters.tax_period_id);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  if (filters?.period_start) {
    queryText += ` AND period_start >= $${paramCount}`;
    params.push(filters.period_start);
    paramCount++;
  }

  if (filters?.period_end) {
    queryText += ` AND period_end <= $${paramCount}`;
    params.push(filters.period_end);
    paramCount++;
  }

  queryText += ' ORDER BY period_end DESC, created_at DESC';

  const result = await query(queryText, params);

  // Convert amounts from öre to SEK
  return result.rows.map(convertVATReportFromDB);
};

/**
 * Get VAT report by ID
 */
export const getVATReportById = async (
  reportId: string,
  companyId: string
): Promise<VATReport | null> => {
  const result = await query(
    'SELECT * FROM vat_reports WHERE id = $1 AND company_id = $2',
    [reportId, companyId]
  );

  if (!result.rows[0]) return null;

  return convertVATReportFromDB(result.rows[0]);
};

/**
 * Get VAT report with lines
 */
export const getVATReportWithLines = async (
  reportId: string,
  companyId: string
): Promise<VATReport | null> => {
  const report = await getVATReportById(reportId, companyId);
  if (!report) return null;

  const linesResult = await query(
    'SELECT * FROM vat_report_lines WHERE vat_report_id = $1 ORDER BY transaction_date DESC',
    [reportId]
  );

  report.lines = linesResult.rows.map(convertVATReportLineFromDB);
  return report;
};

/**
 * Generate a new VAT report for a period
 */
export const generateVATReport = async (
  userId: string,
  data: GenerateVATReportInput
): Promise<VATReport> => {
  await query('BEGIN');

  try {
    // Calculate VAT summary
    const summary = await calculateVATSummary(
      data.company_id,
      data.period_start,
      data.period_end
    );

    // Generate report number (format: VAT-YYYYMM-XXX)
    const yearMonth = data.period_start.substring(0, 7).replace('-', '');
    const countResult = await query(
      `SELECT COUNT(*) as count FROM vat_reports
       WHERE company_id = $1 AND report_number LIKE $2`,
      [data.company_id, `VAT-${yearMonth}-%`]
    );
    const reportCount = parseInt(countResult.rows[0].count) + 1;
    const report_number = `VAT-${yearMonth}-${reportCount.toString().padStart(3, '0')}`;

    // Create VAT report
    const reportResult = await query(
      `INSERT INTO vat_reports (
        company_id, tax_period_id, report_number, report_date,
        period_start, period_end,
        outgoing_vat_25, outgoing_vat_12, outgoing_vat_6, outgoing_vat_0,
        incoming_vat, total_outgoing_vat, net_vat_amount,
        status, created_by
      ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        data.company_id,
        data.tax_period_id || null,
        report_number,
        data.period_start,
        data.period_end,
        convertToOre(summary.outgoing_vat_25),
        convertToOre(summary.outgoing_vat_12),
        convertToOre(summary.outgoing_vat_6),
        convertToOre(summary.outgoing_vat_0),
        convertToOre(summary.incoming_vat),
        convertToOre(summary.total_outgoing_vat),
        convertToOre(summary.net_vat_amount),
        'draft',
        userId,
      ]
    );

    const report = reportResult.rows[0];

    // Create report lines from invoices (outgoing VAT)
    const invoicesResult = await query(
      `SELECT
        i.id as invoice_id,
        i.invoice_number,
        i.invoice_date,
        il.vat_rate,
        SUM(il.quantity * il.unit_price) as base_amount,
        SUM((il.quantity * il.unit_price) * (il.vat_rate / 100)) as vat_amount,
        SUM(il.amount) as total_amount
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE i.company_id = $1
        AND i.invoice_date >= $2
        AND i.invoice_date <= $3
        AND i.status IN ('sent', 'paid', 'overdue')
      GROUP BY i.id, i.invoice_number, i.invoice_date, il.vat_rate
      ORDER BY i.invoice_date DESC`,
      [data.company_id, data.period_start, data.period_end]
    );

    for (const invoice of invoicesResult.rows) {
      await query(
        `INSERT INTO vat_report_lines (
          vat_report_id, transaction_type, transaction_id, transaction_date,
          transaction_number, account_number, account_name,
          base_amount, vat_rate, vat_amount, total_amount, vat_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          report.id,
          'invoice',
          invoice.invoice_id,
          invoice.invoice_date,
          invoice.invoice_number,
          '2610',
          'Utgående moms',
          convertToOre(parseFloat(invoice.base_amount)),
          parseFloat(invoice.vat_rate),
          convertToOre(parseFloat(invoice.vat_amount)),
          convertToOre(parseFloat(invoice.total_amount)),
          'outgoing',
        ]
      );
    }

    // Create report lines from receipts (incoming VAT)
    const receiptsResult = await query(
      `SELECT
        r.id as receipt_id,
        r.receipt_date,
        r.amount as base_amount,
        r.vat_amount,
        r.total_amount,
        r.description
      FROM receipts r
      WHERE r.company_id = $1
        AND r.receipt_date >= $2
        AND r.receipt_date <= $3
        AND r.vat_amount IS NOT NULL
        AND r.vat_amount > 0
      ORDER BY r.receipt_date DESC`,
      [data.company_id, data.period_start, data.period_end]
    );

    for (const receipt of receiptsResult.rows) {
      const vatRate = receipt.vat_amount && receipt.base_amount
        ? (parseFloat(receipt.vat_amount) / parseFloat(receipt.base_amount)) * 100
        : 0;

      await query(
        `INSERT INTO vat_report_lines (
          vat_report_id, transaction_type, transaction_id, transaction_date,
          account_number, account_name,
          base_amount, vat_rate, vat_amount, total_amount, vat_type, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          report.id,
          'receipt',
          receipt.receipt_id,
          receipt.receipt_date,
          '1630',
          'Ingående moms',
          convertToOre(parseFloat(receipt.base_amount)),
          vatRate,
          convertToOre(parseFloat(receipt.vat_amount)),
          convertToOre(parseFloat(receipt.total_amount)),
          'incoming',
          receipt.description,
        ]
      );
    }

    await query('COMMIT');

    return convertVATReportFromDB(report);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

/**
 * Update VAT report
 */
export const updateVATReport = async (
  reportId: string,
  companyId: string,
  userId: string,
  updates: UpdateVATReportInput
): Promise<VATReport | null> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount}`);
    values.push(updates.status);
    paramCount++;

    // If approving, set approval fields
    if (updates.status === VATReportStatus.APPROVED) {
      fields.push(`approved_by = $${paramCount}`);
      values.push(updates.approved_by || userId);
      paramCount++;

      fields.push(`approved_at = CURRENT_TIMESTAMP`);
    }
  }

  if (updates.notes !== undefined) {
    fields.push(`notes = $${paramCount}`);
    values.push(updates.notes);
    paramCount++;
  }

  if (fields.length === 0) {
    return getVATReportById(reportId, companyId);
  }

  values.push(reportId, companyId);
  const result = await query(
    `UPDATE vat_reports SET ${fields.join(', ')}
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] ? convertVATReportFromDB(result.rows[0]) : null;
};

/**
 * Delete VAT report (only drafts can be deleted)
 */
export const deleteVATReport = async (
  reportId: string,
  companyId: string
): Promise<boolean> => {
  await query('BEGIN');

  try {
    // Check if report is draft
    const report = await getVATReportById(reportId, companyId);
    if (!report) {
      throw new Error('VAT report not found');
    }
    if (report.status !== VATReportStatus.DRAFT) {
      throw new Error('Only draft reports can be deleted');
    }

    // Delete report lines (cascade should handle this, but explicit is safer)
    await query('DELETE FROM vat_report_lines WHERE vat_report_id = $1', [reportId]);

    // Delete report
    const result = await query(
      'DELETE FROM vat_reports WHERE id = $1 AND company_id = $2',
      [reportId, companyId]
    );

    await query('COMMIT');
    return result.rowCount > 0;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert SEK to öre (cents) for database storage
 */
function convertToOre(sek: number): number {
  return Math.round(sek * 100);
}

/**
 * Convert öre to SEK for API responses
 */
function convertToSEK(ore: number): number {
  return ore / 100;
}

/**
 * Convert VAT report from database format (öre) to API format (SEK)
 */
function convertVATReportFromDB(dbReport: any): VATReport {
  return {
    ...dbReport,
    outgoing_vat_25: convertToSEK(dbReport.outgoing_vat_25),
    outgoing_vat_12: convertToSEK(dbReport.outgoing_vat_12),
    outgoing_vat_6: convertToSEK(dbReport.outgoing_vat_6),
    outgoing_vat_0: convertToSEK(dbReport.outgoing_vat_0),
    incoming_vat: convertToSEK(dbReport.incoming_vat),
    total_outgoing_vat: convertToSEK(dbReport.total_outgoing_vat),
    net_vat_amount: convertToSEK(dbReport.net_vat_amount),
  };
}

/**
 * Convert VAT report line from database format (öre) to API format (SEK)
 */
function convertVATReportLineFromDB(dbLine: any): VATReportLine {
  return {
    ...dbLine,
    base_amount: convertToSEK(dbLine.base_amount),
    vat_amount: convertToSEK(dbLine.vat_amount),
    total_amount: convertToSEK(dbLine.total_amount),
  };
}
