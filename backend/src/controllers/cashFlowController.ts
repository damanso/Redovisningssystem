import { Response } from 'express';
import { CashFlowService } from '../services/cashFlowService.js';
import { AuthRequest } from '../middleware/authenticate.js';
import { pool } from '../config/database.js';
import {
  UpdateCashFlowSettingsDto,
  CalculateAvailableFundsDto,
  CreatePlannedExpenseDto,
  UpdatePlannedExpenseDto
} from '../types/bank.types.js';

const cashFlowService = new CashFlowService(pool);

/**
 * Get cash flow summary
 */
export const getCashFlowSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const summary = await cashFlowService.getCashFlowSummary(company_id as string, userId);

    res.json(summary);
  } catch (error: any) {
    console.error('Get cash flow summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Calculate available funds
 */
export const calculateAvailableFunds = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, exclude_salary_amount, exclude_expense_amount, planning_days } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: CalculateAvailableFundsDto = {
      exclude_salary_amount,
      exclude_expense_amount,
      planning_days
    };

    const result = await cashFlowService.calculateAvailableFunds(company_id, userId, dto);

    res.json(result);
  } catch (error: any) {
    console.error('Calculate available funds error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get cash flow settings
 */
export const getSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const settings = await cashFlowService.getSettings(company_id as string, userId);

    res.json(settings);
  } catch (error: any) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update cash flow settings
 */
export const updateSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...updates } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: UpdateCashFlowSettingsDto = updates;
    const settings = await cashFlowService.updateSettings(company_id, userId, dto);

    res.json(settings);
  } catch (error: any) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==================== Planned Expenses ====================

/**
 * Create planned expense
 */
export const createPlannedExpense = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...data } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: CreatePlannedExpenseDto = data;
    const expense = await cashFlowService.createPlannedExpense(company_id, userId, dto);

    res.status(201).json(expense);
  } catch (error: any) {
    console.error('Create planned expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get planned expenses
 */
export const getPlannedExpenses = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, status } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const expenses = await cashFlowService.getPlannedExpensesList(
      company_id as string,
      status as string
    );

    res.json(expenses);
  } catch (error: any) {
    console.error('Get planned expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update planned expense
 */
export const updatePlannedExpense = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: UpdatePlannedExpenseDto = updates;
    const expense = await cashFlowService.updatePlannedExpense(company_id, id, dto);

    res.json(expense);
  } catch (error: any) {
    console.error('Update planned expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete planned expense
 */
export const deletePlannedExpense = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await cashFlowService.deletePlannedExpense(company_id as string, id);

    res.json({ message: 'Planned expense deleted' });
  } catch (error: any) {
    console.error('Delete planned expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Mark planned expense as paid
 */
export const markPlannedExpenseAsPaid = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, transaction_id, paid_date } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    if (!transaction_id) {
      return res.status(400).json({ error: 'transaction_id is required' });
    }

    if (!paid_date) {
      return res.status(400).json({ error: 'paid_date is required' });
    }

    await cashFlowService.markPlannedExpenseAsPaid(company_id, id, transaction_id, paid_date);

    res.json({ message: 'Planned expense marked as paid' });
  } catch (error: any) {
    console.error('Mark planned expense as paid error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
