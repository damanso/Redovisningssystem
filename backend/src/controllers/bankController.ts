/**
 * Bank Controller
 * Handles HTTP requests for bank integration
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/authenticate.js';
import * as bankService from '../services/bankService.js';
import {
  CreateBankConnectionRequest,
  SyncBankAccountRequest,
  MatchTransactionRequest,
  ReconcileTransactionRequest,
  MatchingCriteria,
} from '../types/bank.types.js';

/**
 * Create a new bank connection
 * POST /api/banks/connections
 */
export const createBankConnection = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const data: CreateBankConnectionRequest = req.body;

    if (!data.company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await bankService.createBankConnection(userId, data);
    res.status(201).json(result);
  } catch (error: any) {
    console.error('Create bank connection error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get all bank connections for a company
 * GET /api/banks/connections?company_id=xxx
 */
export const getBankConnections = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const connections = await bankService.getBankConnections(company_id as string);
    res.json(connections);
  } catch (error: any) {
    console.error('Get bank connections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get bank connection by ID
 * GET /api/banks/connections/:id?company_id=xxx
 */
export const getBankConnectionById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const connection = await bankService.getBankConnectionById(id, company_id as string);
    res.json(connection);
  } catch (error: any) {
    if (error.message === 'Bank connection not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Get bank connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete/revoke bank connection
 * DELETE /api/banks/connections/:id?company_id=xxx
 */
export const deleteBankConnection = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await bankService.deleteBankConnection(id, company_id as string, userId);
    res.status(204).send();
  } catch (error: any) {
    console.error('Delete bank connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get bank accounts for a connection
 * GET /api/banks/connections/:connectionId/accounts?company_id=xxx
 */
export const getBankAccounts = async (req: AuthRequest, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const accounts = await bankService.getBankAccounts(connectionId, company_id as string);
    res.json(accounts);
  } catch (error: any) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get bank account by ID
 * GET /api/banks/accounts/:id?company_id=xxx
 */
export const getBankAccountById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const account = await bankService.getBankAccountById(id, company_id as string);
    res.json(account);
  } catch (error: any) {
    if (error.message === 'Bank account not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Get bank account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Sync bank account transactions
 * POST /api/banks/accounts/:id/sync?company_id=xxx
 */
export const syncBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const options: SyncBankAccountRequest = {
      from_date: req.body.from_date ? new Date(req.body.from_date) : undefined,
      to_date: req.body.to_date ? new Date(req.body.to_date) : undefined,
      force_full_sync: req.body.force_full_sync || false,
    };

    const result = await bankService.syncBankAccount(id, company_id as string, userId, options);
    res.json(result);
  } catch (error: any) {
    console.error('Sync bank account error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get transactions for a bank account
 * GET /api/banks/accounts/:id/transactions?company_id=xxx&status=xxx&from_date=xxx&to_date=xxx
 */
export const getBankTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, status, from_date, to_date, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const filters = {
      status: status as string | undefined,
      from_date: from_date ? new Date(from_date as string) : undefined,
      to_date: to_date ? new Date(to_date as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    };

    const result = await bankService.getBankTransactions(id, company_id as string, filters);
    res.json(result);
  } catch (error: any) {
    console.error('Get bank transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Find matching candidates for a transaction
 * GET /api/banks/transactions/:id/match-candidates?company_id=xxx
 */
export const findMatchingCandidates = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const criteria: MatchingCriteria = {
      amount_tolerance: req.query.amount_tolerance ? parseFloat(req.query.amount_tolerance as string) : undefined,
      date_range_days: req.query.date_range_days ? parseInt(req.query.date_range_days as string) : undefined,
      min_confidence_score: req.query.min_confidence_score
        ? parseFloat(req.query.min_confidence_score as string)
        : undefined,
    };

    const candidates = await bankService.findMatchingCandidates(id, company_id as string, criteria);
    res.json(candidates);
  } catch (error: any) {
    console.error('Find matching candidates error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Match transaction to invoice or receipt
 * POST /api/banks/transactions/:id/match?company_id=xxx
 */
export const matchTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const matchRequest: MatchTransactionRequest = req.body;

    if (!matchRequest.match_type || !matchRequest.match_id || matchRequest.matched_amount === undefined) {
      return res.status(400).json({
        error: 'match_type, match_id, and matched_amount are required',
      });
    }

    const result = await bankService.matchTransaction(id, company_id as string, userId, matchRequest);
    res.json(result);
  } catch (error: any) {
    console.error('Match transaction error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Reconcile transaction (create journal entry)
 * POST /api/banks/transactions/:id/reconcile?company_id=xxx
 */
export const reconcileTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const request: ReconcileTransactionRequest = req.body;

    const result = await bankService.reconcileTransaction(id, company_id as string, userId, request);
    res.json(result);
  } catch (error: any) {
    console.error('Reconcile transaction error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get reconciliation summary for a company
 * GET /api/banks/reconciliation/summary?company_id=xxx
 */
export const getReconciliationSummary = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const summary = await bankService.getReconciliationSummary(company_id as string);
    res.json(summary);
  } catch (error: any) {
    console.error('Get reconciliation summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
