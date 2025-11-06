/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Controller
 */

import { Request, Response } from 'express';
import * as consolidatedReportService from '../services/consolidatedReportService';
import {
  CreateConsolidatedReportConfigDto,
  UpdateConsolidatedReportConfigDto
} from '../types/consolidatedReport.types';

/**
 * Create a new consolidated report configuration
 * POST /api/v1/consolidated-reports/configs
 */
export const createReportConfig = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data: CreateConsolidatedReportConfigDto = req.body;

    // Validation
    if (!data.name || !data.company_ids || data.company_ids.length === 0 || !data.report_type) {
      return res.status(400).json({
        error: 'name, company_ids (non-empty array), and report_type are required'
      });
    }

    const config = await consolidatedReportService.createReportConfig(userId, data);
    res.status(201).json(config);
  } catch (error: any) {
    console.error('Error creating report config:', error);
    res.status(500).json({ error: error.message || 'Failed to create report config' });
  }
};

/**
 * Get all report configurations for current user
 * GET /api/v1/consolidated-reports/configs
 */
export const getReportConfigs = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const configs = await consolidatedReportService.getReportConfigs(userId);
    res.json(configs);
  } catch (error: any) {
    console.error('Error fetching report configs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch report configs' });
  }
};

/**
 * Get a specific report configuration by ID
 * GET /api/v1/consolidated-reports/configs/:id
 */
export const getReportConfigById = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const configId = req.params.id;
    const config = await consolidatedReportService.getReportConfigById(configId, userId);

    if (!config) {
      return res.status(404).json({ error: 'Report config not found' });
    }

    res.json(config);
  } catch (error: any) {
    console.error('Error fetching report config:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch report config' });
  }
};

/**
 * Update a report configuration
 * PUT /api/v1/consolidated-reports/configs/:id
 */
export const updateReportConfig = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const configId = req.params.id;
    const data: UpdateConsolidatedReportConfigDto = req.body;

    const config = await consolidatedReportService.updateReportConfig(configId, userId, data);

    if (!config) {
      return res.status(404).json({ error: 'Report config not found or no changes made' });
    }

    res.json(config);
  } catch (error: any) {
    console.error('Error updating report config:', error);
    res.status(500).json({ error: error.message || 'Failed to update report config' });
  }
};

/**
 * Delete a report configuration
 * DELETE /api/v1/consolidated-reports/configs/:id
 */
export const deleteReportConfig = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const configId = req.params.id;
    const success = await consolidatedReportService.deleteReportConfig(configId, userId);

    if (!success) {
      return res.status(404).json({ error: 'Report config not found' });
    }

    res.json({ message: 'Report config deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting report config:', error);
    res.status(500).json({ error: error.message || 'Failed to delete report config' });
  }
};

/**
 * Generate a consolidated report
 * POST /api/v1/consolidated-reports/generate
 */
export const generateConsolidatedReport = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      company_ids,
      group_ids,
      report_type,
      date_range_start,
      date_range_end,
      currency = 'SEK'
    } = req.body;

    // Validation
    if ((!company_ids || company_ids.length === 0) && (!group_ids || group_ids.length === 0)) {
      return res.status(400).json({
        error: 'Either company_ids or group_ids must be provided'
      });
    }

    if (!report_type) {
      return res.status(400).json({ error: 'report_type is required' });
    }

    // Get companies from groups if group_ids provided
    let allCompanyIds = company_ids || [];
    if (group_ids && group_ids.length > 0) {
      const groupCompanyIds = await consolidatedReportService.getCompaniesFromGroups(userId, group_ids);
      allCompanyIds = [...new Set([...allCompanyIds, ...groupCompanyIds])];
    }

    if (allCompanyIds.length === 0) {
      return res.status(400).json({ error: 'No companies found to generate report' });
    }

    const reportData = await consolidatedReportService.generateConsolidatedReport(
      userId,
      allCompanyIds,
      report_type,
      date_range_start ? new Date(date_range_start) : new Date(new Date().getFullYear(), 0, 1),
      date_range_end ? new Date(date_range_end) : new Date(),
      currency
    );

    res.json(reportData);
  } catch (error: any) {
    console.error('Error generating consolidated report:', error);
    res.status(500).json({ error: error.message || 'Failed to generate report' });
  }
};

/**
 * Get consolidated transaction data
 * GET /api/v1/consolidated-reports/transactions
 */
export const getConsolidatedTransactionData = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { company_ids, date_range_start, date_range_end } = req.query;

    if (!company_ids) {
      return res.status(400).json({ error: 'company_ids is required' });
    }

    const companyIdsArray = (company_ids as string).split(',');

    const transactionData = await consolidatedReportService.getConsolidatedTransactionData(
      userId,
      companyIdsArray,
      date_range_start ? new Date(date_range_start as string) : new Date(new Date().getFullYear(), 0, 1),
      date_range_end ? new Date(date_range_end as string) : new Date()
    );

    res.json(transactionData);
  } catch (error: any) {
    console.error('Error fetching consolidated transaction data:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transaction data' });
  }
};
