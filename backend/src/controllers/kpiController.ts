import { Request, Response } from 'express';
import * as kpiService from '../services/kpiService';

/**
 * KPI Controller
 * Handles HTTP requests for KPI tracking and calculation
 */

// ============================================
// KPI DEFINITION OPERATIONS
// ============================================

export const getAllKPIDefinitions = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const kpis = await kpiService.getAllKPIDefinitions(companyId);
    res.json(kpis);
  } catch (error: any) {
    console.error('Error fetching KPI definitions:', error);
    res.status(500).json({ error: 'Failed to fetch KPI definitions' });
  }
};

export const getKPIDefinitionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const kpi = await kpiService.getKPIDefinitionById(id, companyId);
    if (!kpi) {
      return res.status(404).json({ error: 'KPI definition not found' });
    }

    res.json(kpi);
  } catch (error: any) {
    console.error('Error fetching KPI definition:', error);
    res.status(500).json({ error: 'Failed to fetch KPI definition' });
  }
};

export const createKPIDefinition = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const kpi = await kpiService.createKPIDefinition(companyId, req.body);
    res.status(201).json(kpi);
  } catch (error: any) {
    console.error('Error creating KPI definition:', error);
    res.status(500).json({ error: 'Failed to create KPI definition' });
  }
};

export const updateKPIDefinition = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const kpi = await kpiService.updateKPIDefinition(id, companyId, req.body);
    if (!kpi) {
      return res.status(404).json({ error: 'KPI definition not found' });
    }

    res.json(kpi);
  } catch (error: any) {
    console.error('Error updating KPI definition:', error);
    res.status(500).json({ error: 'Failed to update KPI definition' });
  }
};

export const deleteKPIDefinition = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const deleted = await kpiService.deleteKPIDefinition(id, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'KPI definition not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting KPI definition:', error);
    res.status(500).json({ error: 'Failed to delete KPI definition' });
  }
};

// ============================================
// KPI VALUE OPERATIONS
// ============================================

export const getKPIValues = async (req: Request, res: Response) => {
  try {
    const { kpiId } = req.params;
    const { start_date, end_date } = req.query;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const values = await kpiService.getKPIValues(
      kpiId,
      companyId,
      start_date as string,
      end_date as string
    );
    res.json(values);
  } catch (error: any) {
    console.error('Error fetching KPI values:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch KPI values' });
  }
};

export const createKPIValue = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const value = await kpiService.createKPIValue(companyId, req.body);
    res.status(201).json(value);
  } catch (error: any) {
    console.error('Error creating KPI value:', error);
    res.status(500).json({ error: error.message || 'Failed to create KPI value' });
  }
};

// ============================================
// KPI CALCULATION
// ============================================

export const calculateKPI = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { start_date, end_date } = req.query;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const value = await kpiService.calculateKPI(
      code,
      companyId,
      start_date as string,
      end_date as string
    );
    res.json({ code, value, start_date, end_date });
  } catch (error: any) {
    console.error('Error calculating KPI:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate KPI' });
  }
};

export const calculateAndSaveKPI = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { start_date, end_date } = req.body;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const value = await kpiService.calculateAndSaveKPI(
      code,
      companyId,
      start_date,
      end_date
    );
    res.status(201).json(value);
  } catch (error: any) {
    console.error('Error calculating and saving KPI:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate and save KPI' });
  }
};

export const calculateAllKPIs = async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.body;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const values = await kpiService.calculateAllKPIs(companyId, start_date, end_date);
    res.status(201).json(values);
  } catch (error: any) {
    console.error('Error calculating all KPIs:', error);
    res.status(500).json({ error: 'Failed to calculate all KPIs' });
  }
};

// ============================================
// KPI DASHBOARD & REPORTING
// ============================================

export const getKPIDashboard = async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const dashboard = await kpiService.getKPIDashboard(
      companyId,
      start_date as string,
      end_date as string
    );
    res.json(dashboard);
  } catch (error: any) {
    console.error('Error fetching KPI dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch KPI dashboard' });
  }
};

export const getKPITrend = async (req: Request, res: Response) => {
  try {
    const { kpiId } = req.params;
    const { periods } = req.query;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const trend = await kpiService.getKPITrend(
      kpiId,
      companyId,
      periods ? parseInt(periods as string) : 12
    );
    res.json(trend);
  } catch (error: any) {
    console.error('Error fetching KPI trend:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch KPI trend' });
  }
};

// ============================================
// KPI TARGETS
// ============================================

export const createKPITarget = async (req: Request, res: Response) => {
  try {
    const { kpiId } = req.params;
    const { period_start, period_end, target_value, notes } = req.body;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const target = await kpiService.createKPITarget(
      kpiId,
      companyId,
      period_start,
      period_end,
      target_value,
      notes
    );
    res.status(201).json(target);
  } catch (error: any) {
    console.error('Error creating KPI target:', error);
    res.status(500).json({ error: error.message || 'Failed to create KPI target' });
  }
};

export const getKPITargets = async (req: Request, res: Response) => {
  try {
    const { kpiId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const targets = await kpiService.getKPITargets(kpiId, companyId);
    res.json(targets);
  } catch (error: any) {
    console.error('Error fetching KPI targets:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch KPI targets' });
  }
};
