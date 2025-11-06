import { Response } from 'express';
import { SalaryWithdrawalService } from '../services/salaryWithdrawalService.js';
import { AuthRequest } from '../middleware/authenticate.js';
import { pool } from '../config/database.js';
import {
  CreateSalaryWithdrawalDto,
  ApproveSalaryWithdrawalDto,
  RejectSalaryWithdrawalDto
} from '../types/bank.types.js';

const salaryWithdrawalService = new SalaryWithdrawalService(pool);

/**
 * Create salary withdrawal request
 */
export const createWithdrawal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...data } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: CreateSalaryWithdrawalDto = data;
    const withdrawal = await salaryWithdrawalService.createWithdrawal(company_id, userId, dto);

    res.status(201).json(withdrawal);
  } catch (error: any) {
    console.error('Create withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get all salary withdrawals
 */
export const getWithdrawals = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, status } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const withdrawals = await salaryWithdrawalService.getWithdrawals(
      company_id as string,
      status as string
    );

    res.json(withdrawals);
  } catch (error: any) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get withdrawal by ID
 */
export const getWithdrawalById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const withdrawal = await salaryWithdrawalService.getWithdrawalById(company_id as string, id);

    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    res.json(withdrawal);
  } catch (error: any) {
    console.error('Get withdrawal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get withdrawals by user
 */
export const getWithdrawalsByUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const withdrawals = await salaryWithdrawalService.getWithdrawalsByUser(
      company_id as string,
      userId
    );

    res.json(withdrawals);
  } catch (error: any) {
    console.error('Get withdrawals by user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Approve salary withdrawal
 */
export const approveWithdrawal = async (req: AuthRequest, res: Response) => {
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

    const dto: ApproveSalaryWithdrawalDto = data;
    const withdrawal = await salaryWithdrawalService.approveWithdrawal(
      company_id,
      id,
      userId,
      dto
    );

    res.json(withdrawal);
  } catch (error: any) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Reject salary withdrawal
 */
export const rejectWithdrawal = async (req: AuthRequest, res: Response) => {
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

    const dto: RejectSalaryWithdrawalDto = data;
    const withdrawal = await salaryWithdrawalService.rejectWithdrawal(
      company_id,
      id,
      userId,
      dto
    );

    res.json(withdrawal);
  } catch (error: any) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Mark withdrawal as paid
 */
export const markWithdrawalAsPaid = async (req: AuthRequest, res: Response) => {
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

    const withdrawal = await salaryWithdrawalService.markAsPaid(
      company_id,
      id,
      transaction_id,
      payment_date
    );

    res.json(withdrawal);
  } catch (error: any) {
    console.error('Mark withdrawal as paid error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Cancel salary withdrawal
 */
export const cancelWithdrawal = async (req: AuthRequest, res: Response) => {
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

    const withdrawal = await salaryWithdrawalService.cancelWithdrawal(company_id, id, userId);

    res.json(withdrawal);
  } catch (error: any) {
    console.error('Cancel withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Delete salary withdrawal
 */
export const deleteWithdrawal = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await salaryWithdrawalService.deleteWithdrawal(company_id as string, id);

    res.json({ message: 'Withdrawal deleted' });
  } catch (error: any) {
    console.error('Delete withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
