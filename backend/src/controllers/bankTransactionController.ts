import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { BankTransactionService } from '../services/bankTransactionService.js';
import { AuthRequest } from '../middleware/authenticate.js';
import { pool } from '../config/database.js';
import {
  CreateBankTransactionDto,
  ImportTransactionsDto,
  BankTransactionFilters
} from '../types/bank.types.js';

const bankTransactionService = new BankTransactionService(pool);

/**
 * Upload and parse transaction file
 */
export const uploadTransactionFile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, file_type, bank_name } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileTypeParam = file_type || 'csv';
    if (!['csv', 'excel'].includes(fileTypeParam)) {
      return res.status(400).json({ error: 'Invalid file_type. Must be "csv" or "excel"' });
    }

    // Parse the file
    const parsedTransactions = await bankTransactionService.parseTransactionFile(
      req.file,
      fileTypeParam as 'csv' | 'excel',
      bank_name
    );

    // Generate batch ID for this import
    const batchId = uuidv4();

    // Convert parsed transactions to DTOs
    const transactions: CreateBankTransactionDto[] = parsedTransactions.map(pt => ({
      transaction_date: pt.transaction_date,
      booking_date: pt.booking_date,
      transaction_id: pt.transaction_id,
      reference_number: pt.reference_number,
      transaction_type: pt.amount >= 0 ? 'credit' : 'debit',
      description: pt.description,
      amount: pt.amount,
      currency: 'SEK',
      balance_after: pt.balance_after,
      import_source: 'file_upload',
      file_name: req.file.originalname
    }));

    // Import transactions
    const result = await bankTransactionService.importTransactions(company_id, userId, {
      transactions,
      import_batch_id: batchId
    });

    res.status(200).json(result);
  } catch (error: any) {
    console.error('Upload transaction file error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get all transactions
 */
export const getTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, start_date, end_date, transaction_type, status, category, search, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const filters: BankTransactionFilters = {
      start_date: start_date as string,
      end_date: end_date as string,
      transaction_type: transaction_type as string,
      status: status as string,
      category: category as string,
      search: search as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    };

    const result = await bankTransactionService.getTransactions(company_id as string, filters);

    res.json(result);
  } catch (error: any) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get transaction by ID
 */
export const getTransactionById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const transaction = await bankTransactionService.getTransactionById(company_id as string, id);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error: any) {
    console.error('Get transaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create manual transaction
 */
export const createTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...data } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const dto: CreateBankTransactionDto = {
      ...data,
      import_source: 'manual'
    };

    const transaction = await bankTransactionService.createTransaction(company_id, userId, dto);

    res.status(201).json(transaction);
  } catch (error: any) {
    console.error('Create transaction error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Link transaction to invoice
 */
export const linkToInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { invoice_id } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ error: 'invoice_id is required' });
    }

    await bankTransactionService.linkToInvoice(id, invoice_id);

    res.json({ message: 'Transaction linked to invoice' });
  } catch (error: any) {
    console.error('Link to invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Link transaction to receipt
 */
export const linkToReceipt = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { receipt_id } = req.body;

    if (!receipt_id) {
      return res.status(400).json({ error: 'receipt_id is required' });
    }

    await bankTransactionService.linkToReceipt(id, receipt_id);

    res.json({ message: 'Transaction linked to receipt' });
  } catch (error: any) {
    console.error('Link to receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Ignore transaction
 */
export const ignoreTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await bankTransactionService.ignoreTransaction(id);

    res.json({ message: 'Transaction ignored' });
  } catch (error: any) {
    console.error('Ignore transaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete transaction
 */
export const deleteTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await bankTransactionService.deleteTransaction(company_id as string, id);

    res.json({ message: 'Transaction deleted' });
  } catch (error: any) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
