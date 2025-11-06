import { Request, Response } from 'express';
import * as budgetService from '../services/budgetService';

/**
 * Budget Controller
 * Handles HTTP requests for budget management
 */

// ============================================
// BUDGET OPERATIONS
// ============================================

export const getAllBudgets = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const budgets = await budgetService.getAllBudgets(companyId);
    res.json(budgets);
  } catch (error: any) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
};

export const getBudgetById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const budget = await budgetService.getBudgetById(id, companyId);
    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(budget);
  } catch (error: any) {
    console.error('Error fetching budget:', error);
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
};

export const createBudget = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({ error: 'Company ID and User ID are required' });
    }

    const budget = await budgetService.createBudget(companyId, userId, req.body);
    res.status(201).json(budget);
  } catch (error: any) {
    console.error('Error creating budget:', error);
    res.status(500).json({ error: 'Failed to create budget' });
  }
};

export const updateBudget = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const budget = await budgetService.updateBudget(id, companyId, req.body);
    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(budget);
  } catch (error: any) {
    console.error('Error updating budget:', error);
    res.status(500).json({ error: 'Failed to update budget' });
  }
};

export const deleteBudget = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const deleted = await budgetService.deleteBudget(id, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
};

// ============================================
// BUDGET LINE OPERATIONS
// ============================================

export const getBudgetLines = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const lines = await budgetService.getBudgetLines(budgetId, companyId);
    res.json(lines);
  } catch (error: any) {
    console.error('Error fetching budget lines:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch budget lines' });
  }
};

export const createBudgetLine = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const line = await budgetService.createBudgetLine(budgetId, companyId, req.body);
    res.status(201).json(line);
  } catch (error: any) {
    console.error('Error creating budget line:', error);
    res.status(500).json({ error: error.message || 'Failed to create budget line' });
  }
};

export const updateBudgetLine = async (req: Request, res: Response) => {
  try {
    const { budgetId, lineId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const line = await budgetService.updateBudgetLine(lineId, budgetId, companyId, req.body);
    if (!line) {
      return res.status(404).json({ error: 'Budget line not found' });
    }

    res.json(line);
  } catch (error: any) {
    console.error('Error updating budget line:', error);
    res.status(500).json({ error: error.message || 'Failed to update budget line' });
  }
};

export const deleteBudgetLine = async (req: Request, res: Response) => {
  try {
    const { budgetId, lineId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const deleted = await budgetService.deleteBudgetLine(lineId, budgetId, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Budget line not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting budget line:', error);
    res.status(500).json({ error: error.message || 'Failed to delete budget line' });
  }
};

// ============================================
// BUDGET ANALYSIS
// ============================================

export const getBudgetVsActual = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const { start_date, end_date } = req.query;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const analysis = await budgetService.getBudgetVsActual(
      budgetId,
      companyId,
      start_date as string,
      end_date as string
    );
    res.json(analysis);
  } catch (error: any) {
    console.error('Error fetching budget vs actual:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch budget vs actual' });
  }
};

export const getBudgetSummary = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const summary = await budgetService.getBudgetSummary(budgetId, companyId);
    res.json(summary);
  } catch (error: any) {
    console.error('Error fetching budget summary:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch budget summary' });
  }
};

// ============================================
// BUDGET REVISIONS
// ============================================

export const createBudgetRevision = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const { reason, changes } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({ error: 'Company ID and User ID are required' });
    }

    const revision = await budgetService.createBudgetRevision(
      budgetId,
      companyId,
      userId,
      reason,
      changes
    );
    res.status(201).json(revision);
  } catch (error: any) {
    console.error('Error creating budget revision:', error);
    res.status(500).json({ error: error.message || 'Failed to create budget revision' });
  }
};

export const getBudgetRevisions = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const revisions = await budgetService.getBudgetRevisions(budgetId, companyId);
    res.json(revisions);
  } catch (error: any) {
    console.error('Error fetching budget revisions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch budget revisions' });
  }
};

// ============================================
// BULK OPERATIONS
// ============================================

export const createBudgetWithLines = async (req: Request, res: Response) => {
  try {
    const { budget, lines } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({ error: 'Company ID and User ID are required' });
    }

    const result = await budgetService.createBudgetWithLines(
      companyId,
      userId,
      budget,
      lines
    );
    res.status(201).json(result);
  } catch (error: any) {
    console.error('Error creating budget with lines:', error);
    res.status(500).json({ error: 'Failed to create budget with lines' });
  }
};

export const copyBudget = async (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const { name, start_date, end_date } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({ error: 'Company ID and User ID are required' });
    }

    const result = await budgetService.copyBudget(
      budgetId,
      companyId,
      userId,
      name,
      start_date,
      end_date
    );
    res.status(201).json(result);
  } catch (error: any) {
    console.error('Error copying budget:', error);
    res.status(500).json({ error: error.message || 'Failed to copy budget' });
  }
};
