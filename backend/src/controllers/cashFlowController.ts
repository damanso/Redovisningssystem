import { Request, Response } from 'express';
import * as cashFlowService from '../services/cashFlowService';

/**
 * Cash Flow Controller
 * Handles HTTP requests for cash flow forecasting
 */

// ============================================
// FORECAST OPERATIONS
// ============================================

export const getAllForecasts = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const forecasts = await cashFlowService.getAllForecasts(companyId);
    res.json(forecasts);
  } catch (error: any) {
    console.error('Error fetching forecasts:', error);
    res.status(500).json({ error: 'Failed to fetch forecasts' });
  }
};

export const getForecastById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const forecast = await cashFlowService.getForecastById(id, companyId);
    if (!forecast) {
      return res.status(404).json({ error: 'Forecast not found' });
    }

    res.json(forecast);
  } catch (error: any) {
    console.error('Error fetching forecast:', error);
    res.status(500).json({ error: 'Failed to fetch forecast' });
  }
};

export const createForecast = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({ error: 'Company ID and User ID are required' });
    }

    const forecast = await cashFlowService.createForecast(companyId, userId, req.body);
    res.status(201).json(forecast);
  } catch (error: any) {
    console.error('Error creating forecast:', error);
    res.status(500).json({ error: 'Failed to create forecast' });
  }
};

export const updateForecast = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const forecast = await cashFlowService.updateForecast(id, companyId, req.body);
    if (!forecast) {
      return res.status(404).json({ error: 'Forecast not found' });
    }

    res.json(forecast);
  } catch (error: any) {
    console.error('Error updating forecast:', error);
    res.status(500).json({ error: 'Failed to update forecast' });
  }
};

export const deleteForecast = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const deleted = await cashFlowService.deleteForecast(id, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Forecast not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting forecast:', error);
    res.status(500).json({ error: 'Failed to delete forecast' });
  }
};

// ============================================
// FORECAST LINE OPERATIONS
// ============================================

export const getForecastLines = async (req: Request, res: Response) => {
  try {
    const { forecastId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const lines = await cashFlowService.getForecastLines(forecastId, companyId);
    res.json(lines);
  } catch (error: any) {
    console.error('Error fetching forecast lines:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch forecast lines' });
  }
};

export const createForecastLine = async (req: Request, res: Response) => {
  try {
    const { forecastId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const line = await cashFlowService.createForecastLine(forecastId, companyId, req.body);
    res.status(201).json(line);
  } catch (error: any) {
    console.error('Error creating forecast line:', error);
    res.status(500).json({ error: error.message || 'Failed to create forecast line' });
  }
};

export const deleteForecastLine = async (req: Request, res: Response) => {
  try {
    const { forecastId, lineId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const deleted = await cashFlowService.deleteForecastLine(lineId, forecastId, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Forecast line not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting forecast line:', error);
    res.status(500).json({ error: error.message || 'Failed to delete forecast line' });
  }
};

// ============================================
// FORECAST GENERATION
// ============================================

export const regenerateForecast = async (req: Request, res: Response) => {
  try {
    const { forecastId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    await cashFlowService.regenerateForecast(forecastId, companyId);
    res.json({ message: 'Forecast regenerated successfully' });
  } catch (error: any) {
    console.error('Error regenerating forecast:', error);
    res.status(500).json({ error: error.message || 'Failed to regenerate forecast' });
  }
};

// ============================================
// PAYMENT PATTERNS
// ============================================

export const calculatePaymentPatterns = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    await cashFlowService.calculatePaymentPatterns(companyId);
    res.json({ message: 'Payment patterns calculated successfully' });
  } catch (error: any) {
    console.error('Error calculating payment patterns:', error);
    res.status(500).json({ error: 'Failed to calculate payment patterns' });
  }
};

export const getPaymentPatterns = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const patterns = await cashFlowService.getPaymentPatterns(companyId);
    res.json(patterns);
  } catch (error: any) {
    console.error('Error fetching payment patterns:', error);
    res.status(500).json({ error: 'Failed to fetch payment patterns' });
  }
};

// ============================================
// CASH FLOW PROJECTIONS
// ============================================

export const getForecastProjection = async (req: Request, res: Response) => {
  try {
    const { forecastId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const projection = await cashFlowService.getForecastProjection(forecastId, companyId);
    res.json(projection);
  } catch (error: any) {
    console.error('Error fetching forecast projection:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch forecast projection' });
  }
};

export const getForecastSummary = async (req: Request, res: Response) => {
  try {
    const { forecastId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const summary = await cashFlowService.getForecastSummary(forecastId, companyId);
    res.json(summary);
  } catch (error: any) {
    console.error('Error fetching forecast summary:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch forecast summary' });
  }
};

// ============================================
// SCENARIOS
// ============================================

export const createScenario = async (req: Request, res: Response) => {
  try {
    const { name, description, base_forecast_id, assumptions } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({ error: 'Company ID and User ID are required' });
    }

    const scenario = await cashFlowService.createScenario(
      companyId,
      userId,
      name,
      description,
      base_forecast_id,
      assumptions
    );
    res.status(201).json(scenario);
  } catch (error: any) {
    console.error('Error creating scenario:', error);
    res.status(500).json({ error: error.message || 'Failed to create scenario' });
  }
};

export const getScenarios = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const scenarios = await cashFlowService.getScenarios(companyId);
    res.json(scenarios);
  } catch (error: any) {
    console.error('Error fetching scenarios:', error);
    res.status(500).json({ error: 'Failed to fetch scenarios' });
  }
};

export const compareScenarios = async (req: Request, res: Response) => {
  try {
    const { forecast_ids } = req.body;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    if (!Array.isArray(forecast_ids) || forecast_ids.length === 0) {
      return res.status(400).json({ error: 'Forecast IDs array is required' });
    }

    const comparison = await cashFlowService.compareScenarios(companyId, forecast_ids);
    res.json(comparison);
  } catch (error: any) {
    console.error('Error comparing scenarios:', error);
    res.status(500).json({ error: 'Failed to compare scenarios' });
  }
};

// ============================================
// QUICK PROJECTIONS
// ============================================

export const getQuickProjection = async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const projection = await cashFlowService.getQuickProjection(
      companyId,
      days ? parseInt(days as string) : 30
    );
    res.json(projection);
  } catch (error: any) {
    console.error('Error fetching quick projection:', error);
    res.status(500).json({ error: 'Failed to fetch quick projection' });
  }
};
