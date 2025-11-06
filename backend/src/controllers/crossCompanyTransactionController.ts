/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transaction Controller
 */

import { Request, Response } from 'express';
import * as crossCompanyTransactionService from '../services/crossCompanyTransactionService';
import {
  CreateCrossCompanyTransactionDto,
  UpdateCrossCompanyTransactionDto,
  TransactionStatus
} from '../types/crossCompanyTransaction.types';

/**
 * Create a new cross-company transaction
 * POST /api/v1/cross-company-transactions
 */
export const createCrossCompanyTransaction = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data: CreateCrossCompanyTransactionDto = req.body;

    // Validation
    if (!data.from_company_id || !data.to_company_id || !data.transaction_type || !data.description || !data.amount || !data.transaction_date) {
      return res.status(400).json({
        error: 'from_company_id, to_company_id, transaction_type, description, amount, and transaction_date are required'
      });
    }

    if (data.from_company_id === data.to_company_id) {
      return res.status(400).json({ error: 'from_company_id and to_company_id must be different' });
    }

    const transaction = await crossCompanyTransactionService.createCrossCompanyTransaction(userId, data);
    res.status(201).json(transaction);
  } catch (error: any) {
    console.error('Error creating cross-company transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to create transaction' });
  }
};

/**
 * Get all cross-company transactions
 * GET /api/v1/cross-company-transactions
 */
export const getCrossCompanyTransactions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filters = {
      company_id: req.query.company_id as string | undefined,
      status: req.query.status as TransactionStatus | undefined,
      from_date: req.query.from_date ? new Date(req.query.from_date as string) : undefined,
      to_date: req.query.to_date ? new Date(req.query.to_date as string) : undefined
    };

    const transactions = await crossCompanyTransactionService.getCrossCompanyTransactions(userId, filters);
    res.json(transactions);
  } catch (error: any) {
    console.error('Error fetching cross-company transactions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transactions' });
  }
};

/**
 * Get a specific cross-company transaction by ID
 * GET /api/v1/cross-company-transactions/:id
 */
export const getCrossCompanyTransactionById = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = req.params.id;
    const transaction = await crossCompanyTransactionService.getCrossCompanyTransactionById(transactionId, userId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error: any) {
    console.error('Error fetching cross-company transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transaction' });
  }
};

/**
 * Update a cross-company transaction
 * PUT /api/v1/cross-company-transactions/:id
 */
export const updateCrossCompanyTransaction = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = req.params.id;
    const data: UpdateCrossCompanyTransactionDto = req.body;

    const transaction = await crossCompanyTransactionService.updateCrossCompanyTransaction(transactionId, userId, data);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found or no changes made' });
    }

    res.json(transaction);
  } catch (error: any) {
    console.error('Error updating cross-company transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to update transaction' });
  }
};

/**
 * Reconcile a cross-company transaction
 * POST /api/v1/cross-company-transactions/:id/reconcile
 */
export const reconcileTransaction = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = req.params.id;
    const transaction = await crossCompanyTransactionService.reconcileTransaction(transactionId, userId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error: any) {
    console.error('Error reconciling transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to reconcile transaction' });
  }
};

/**
 * Delete a cross-company transaction
 * DELETE /api/v1/cross-company-transactions/:id
 */
export const deleteCrossCompanyTransaction = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = req.params.id;
    const success = await crossCompanyTransactionService.deleteCrossCompanyTransaction(transactionId, userId);

    if (!success) {
      return res.status(404).json({ error: 'Transaction not found or cannot be deleted (already reconciled)' });
    }

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to delete transaction' });
  }
};

/**
 * Get transaction summary for a company
 * GET /api/v1/cross-company-transactions/summary/:companyId
 */
export const getCompanyTransactionSummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const companyId = req.params.companyId;

    const dateRange = req.query.from_date && req.query.to_date
      ? {
          from: new Date(req.query.from_date as string),
          to: new Date(req.query.to_date as string)
        }
      : undefined;

    const summary = await crossCompanyTransactionService.getCompanyTransactionSummary(companyId, userId, dateRange);
    res.json(summary);
  } catch (error: any) {
    console.error('Error fetching transaction summary:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transaction summary' });
  }
};
