import { Response } from 'express';
import { AuthRequest } from '../middleware/authenticate';
import * as dashboardService from '../services/dashboardService';

/**
 * Get dashboard statistics
 * GET /api/v1/dashboard/stats
 */
export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const stats = await dashboardService.getDashboardStats(company_id as string);

    res.json(stats);
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get quick actions summary
 * GET /api/v1/dashboard/quick-actions
 */
export const getQuickActions = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const actions = await dashboardService.getQuickActions(company_id as string);

    res.json(actions);
  } catch (error) {
    console.error('Get quick actions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
