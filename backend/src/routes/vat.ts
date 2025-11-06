/**
 * VAT Reports API Routes
 * Endpoints for managing VAT reports, tax periods, and Skatteverket submissions
 */

import express from 'express';
import { authenticate } from '../middleware/auth';
import { validateCompanyAccess } from '../middleware/validateCompanyAccess';
import {
  getTaxPeriods,
  getTaxPeriodById,
  createTaxPeriod,
  updateTaxPeriod,
  getVATReports,
  getVATReportById,
  getVATReportWithLines,
  generateVATReport,
  updateVATReport,
  deleteVATReport,
  calculateVATSummary,
} from '../services/vatService';
import {
  submitVATReportToSkatteverket,
  exportVATReportForManualSubmission,
  getSubmissionsByReport,
} from '../services/skatteverketClient';
import {
  VATReportStatus,
  TaxPeriodType,
  TaxPeriodStatus,
} from '../types/vat.types';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ============================================================================
// TAX PERIOD ROUTES
// ============================================================================

/**
 * GET /api/v1/vat/tax-periods
 * Get all tax periods for a company
 */
router.get('/tax-periods', validateCompanyAccess, async (req, res) => {
  try {
    const { company_id, period_type, period_year, status } = req.query;

    const periods = await getTaxPeriods({
      company_id: company_id as string,
      period_type: period_type as TaxPeriodType,
      period_year: period_year ? parseInt(period_year as string) : undefined,
      status: status as TaxPeriodStatus,
    });

    res.json(periods);
  } catch (error: any) {
    console.error('Error fetching tax periods:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/vat/tax-periods/:id
 * Get a specific tax period
 */
router.get('/tax-periods/:id', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    const period = await getTaxPeriodById(id, company_id as string);
    if (!period) {
      return res.status(404).json({ error: 'Tax period not found' });
    }

    res.json(period);
  } catch (error: any) {
    console.error('Error fetching tax period:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/vat/tax-periods
 * Create a new tax period
 */
router.post('/tax-periods', validateCompanyAccess, async (req, res) => {
  try {
    const period = await createTaxPeriod(req.body);
    res.status(201).json(period);
  } catch (error: any) {
    console.error('Error creating tax period:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/vat/tax-periods/:id
 * Update a tax period
 */
router.patch('/tax-periods/:id', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    const period = await updateTaxPeriod(id, company_id as string, req.body);
    if (!period) {
      return res.status(404).json({ error: 'Tax period not found' });
    }

    res.json(period);
  } catch (error: any) {
    console.error('Error updating tax period:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// VAT REPORT ROUTES
// ============================================================================

/**
 * GET /api/v1/vat/reports
 * Get all VAT reports for a company
 */
router.get('/reports', validateCompanyAccess, async (req, res) => {
  try {
    const {
      company_id,
      tax_period_id,
      status,
      period_start,
      period_end,
    } = req.query;

    const reports = await getVATReports({
      company_id: company_id as string,
      tax_period_id: tax_period_id as string,
      status: status as VATReportStatus,
      period_start: period_start as string,
      period_end: period_end as string,
    });

    res.json(reports);
  } catch (error: any) {
    console.error('Error fetching VAT reports:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/vat/reports/:id
 * Get a specific VAT report with all details
 */
router.get('/reports/:id', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    const report = await getVATReportWithLines(id, company_id as string);
    if (!report) {
      return res.status(404).json({ error: 'VAT report not found' });
    }

    res.json(report);
  } catch (error: any) {
    console.error('Error fetching VAT report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/vat/reports/generate
 * Generate a new VAT report for a period
 */
router.post('/reports/generate', validateCompanyAccess, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { company_id, period_start, period_end, tax_period_id } = req.body;

    if (!company_id || !period_start || !period_end) {
      return res.status(400).json({
        error: 'Missing required fields: company_id, period_start, period_end',
      });
    }

    const report = await generateVATReport(userId, {
      company_id,
      period_start,
      period_end,
      tax_period_id,
    });

    res.status(201).json(report);
  } catch (error: any) {
    console.error('Error generating VAT report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/vat/reports/:id
 * Update a VAT report (e.g., approve, add notes)
 */
router.patch('/reports/:id', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const report = await updateVATReport(
      id,
      company_id as string,
      userId,
      req.body
    );

    if (!report) {
      return res.status(404).json({ error: 'VAT report not found' });
    }

    res.json(report);
  } catch (error: any) {
    console.error('Error updating VAT report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/vat/reports/:id
 * Delete a VAT report (only drafts)
 */
router.delete('/reports/:id', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    const deleted = await deleteVATReport(id, company_id as string);
    if (!deleted) {
      return res.status(404).json({ error: 'VAT report not found or cannot be deleted' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting VAT report:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// VAT CALCULATION ROUTES
// ============================================================================

/**
 * GET /api/v1/vat/summary
 * Get VAT summary for a period without creating a report
 */
router.get('/summary', validateCompanyAccess, async (req, res) => {
  try {
    const { company_id, period_start, period_end } = req.query;

    if (!company_id || !period_start || !period_end) {
      return res.status(400).json({
        error: 'Missing required parameters: company_id, period_start, period_end',
      });
    }

    const summary = await calculateVATSummary(
      company_id as string,
      period_start as string,
      period_end as string
    );

    res.json(summary);
  } catch (error: any) {
    console.error('Error calculating VAT summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SKATTEVERKET SUBMISSION ROUTES
// ============================================================================

/**
 * POST /api/v1/vat/reports/:id/submit
 * Submit a VAT report to Skatteverket
 */
router.post('/reports/:id/submit', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id, organization_number } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!organization_number) {
      return res.status(400).json({
        error: 'Missing required field: organization_number',
      });
    }

    // Get the report
    const report = await getVATReportById(id, company_id as string);
    if (!report) {
      return res.status(404).json({ error: 'VAT report not found' });
    }

    // Check if report is approved
    if (report.status !== VATReportStatus.APPROVED) {
      return res.status(400).json({
        error: 'VAT report must be approved before submission',
      });
    }

    // Submit to Skatteverket
    const submission = await submitVATReportToSkatteverket(
      report,
      company_id as string,
      userId,
      { organizationNumber: organization_number }
    );

    res.status(201).json(submission);
  } catch (error: any) {
    console.error('Error submitting VAT report to Skatteverket:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/vat/reports/:id/submissions
 * Get all submissions for a VAT report
 */
router.get('/reports/:id/submissions', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;

    const submissions = await getSubmissionsByReport(id);
    res.json(submissions);
  } catch (error: any) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/vat/reports/:id/export
 * Export VAT report for manual submission
 */
router.get('/reports/:id/export', validateCompanyAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id, format = 'json' } = req.query;

    const report = await getVATReportById(id, company_id as string);
    if (!report) {
      return res.status(404).json({ error: 'VAT report not found' });
    }

    const { content, filename } = await exportVATReportForManualSubmission(
      report,
      format as 'json' | 'xml'
    );

    const contentType =
      format === 'xml' ? 'application/xml' : 'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error: any) {
    console.error('Error exporting VAT report:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
