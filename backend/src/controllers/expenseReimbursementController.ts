import { Response } from 'express';
import { ExpenseReimbursementService } from '../services/expenseReimbursementService.js';
import { AuthRequest } from '../middleware/authenticate.js';
import { pool } from '../config/database.js';
import {
  CreateExpenseReimbursementDto,
  ApproveExpenseReimbursementDto,
  RejectExpenseReimbursementDto
} from '../types/bank.types.js';

const expenseReimbursementService = new ExpenseReimbursementService(pool);

/**
 * Create expense reimbursement claim
 */
export const createReimbursement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...data } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: CreateExpenseReimbursementDto = data;
    const reimbursement = await expenseReimbursementService.createReimbursement(company_id, userId, dto);

    res.status(201).json(reimbursement);
  } catch (error: any) {
    console.error('Create reimbursement error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get all expense reimbursements
 */
export const getReimbursements = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, status } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const reimbursements = await expenseReimbursementService.getReimbursements(
      company_id as string,
      status as string
    );

    res.json(reimbursements);
  } catch (error: any) {
    console.error('Get reimbursements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get reimbursement by ID
 */
export const getReimbursementById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const reimbursement = await expenseReimbursementService.getReimbursementById(
      company_id as string,
      id
    );

    if (!reimbursement) {
      return res.status(404).json({ error: 'Reimbursement not found' });
    }

    res.json(reimbursement);
  } catch (error: any) {
    console.error('Get reimbursement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get reimbursements by user
 */
export const getReimbursementsByUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const reimbursements = await expenseReimbursementService.getReimbursementsByUser(
      company_id as string,
      userId
    );

    res.json(reimbursements);
  } catch (error: any) {
    console.error('Get reimbursements by user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Approve expense reimbursement
 */
export const approveReimbursement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, ...data } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: ApproveExpenseReimbursementDto = data;
    const reimbursement = await expenseReimbursementService.approveReimbursement(
      company_id,
      id,
      userId,
      dto
    );

    res.json(reimbursement);
  } catch (error: any) {
    console.error('Approve reimbursement error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Reject expense reimbursement
 */
export const rejectReimbursement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, ...data } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: RejectExpenseReimbursementDto = data;
    const reimbursement = await expenseReimbursementService.rejectReimbursement(
      company_id,
      id,
      userId,
      dto
    );

    res.json(reimbursement);
  } catch (error: any) {
    console.error('Reject reimbursement error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Mark reimbursement as paid
 */
export const markReimbursementAsPaid = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, transaction_id, payment_date } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    if (!transaction_id) {
      return res.status(400).json({ error: 'transaction_id is required' });
    }

    if (!payment_date) {
      return res.status(400).json({ error: 'payment_date is required' });
    }

    const reimbursement = await expenseReimbursementService.markAsPaid(
      company_id,
      id,
      transaction_id,
      payment_date
    );

    res.json(reimbursement);
  } catch (error: any) {
    console.error('Mark reimbursement as paid error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Cancel expense reimbursement
 */
export const cancelReimbursement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const reimbursement = await expenseReimbursementService.cancelReimbursement(
      company_id,
      id,
      userId
    );

    res.json(reimbursement);
  } catch (error: any) {
    console.error('Cancel reimbursement error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Delete expense reimbursement
 */
export const deleteReimbursement = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await expenseReimbursementService.deleteReimbursement(company_id as string, id);

    res.json({ message: 'Reimbursement deleted' });
  } catch (error: any) {
    console.error('Delete reimbursement error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get reimbursements by category
 */
export const getReimbursementsByCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, start_date, end_date } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await expenseReimbursementService.getReimbursementsByCategory(
      company_id as string,
      start_date as string,
      end_date as string
    );

    res.json(result);
  } catch (error: any) {
    console.error('Get reimbursements by category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
