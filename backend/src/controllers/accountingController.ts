import { Response } from 'express';
import { AuthRequest } from '../middleware/authenticate';
import * as accountingService from '../services/accountingService';
import { CreateJournalEntryDto, JournalEntryFilters } from '../types/accounting.types';
import { logAction } from '../services/auditService';

/**
 * Get BAS chart of accounts
 * GET /api/v1/accounting/accounts
 */
export const getBASAccounts = async (req: AuthRequest, res: Response) => {
  try {
    const { account_type, search } = req.query;

    const accounts = await accountingService.getBASAccounts({
      account_type: account_type as string,
      search: search as string
    });

    res.json(accounts);
  } catch (error) {
    console.error('Get BAS accounts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create a journal entry
 * POST /api/v1/accounting/journal-entries
 */
export const createJournalEntry = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...data } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const entryData: CreateJournalEntryDto = {
      entry_date: data.entry_date,
      description: data.description,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      lines: data.lines
    };

    const entry = await accountingService.createJournalEntry(
      company_id,
      userId,
      entryData
    );

    // Log activity
    await logAction({
      userId,
      companyId: company_id,
      action: 'accounting.create_entry',
      resourceType: 'journal_entry',
      resourceId: entry.id,
      details: { description: entry.description },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Create journal entry error:', error);
    if (error instanceof Error && error.message.includes('balanced')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get journal entries with filters
 * GET /api/v1/accounting/journal-entries
 */
export const getJournalEntries = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, start_date, end_date, account_number, reference_type } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const filters: JournalEntryFilters = {
      start_date: start_date as string,
      end_date: end_date as string,
      account_number: account_number ? parseInt(account_number as string) : undefined,
      reference_type: reference_type as string
    };

    const entries = await accountingService.getJournalEntries(
      company_id as string,
      filters
    );

    res.json(entries);
  } catch (error) {
    console.error('Get journal entries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get a single journal entry
 * GET /api/v1/accounting/journal-entries/:id
 */
export const getJournalEntryById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const entry = await accountingService.getJournalEntryById(id, company_id as string);

    res.json(entry);
  } catch (error) {
    console.error('Get journal entry error:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Book an invoice
 * POST /api/v1/accounting/book-invoice/:id
 */
export const bookInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const entry = await accountingService.bookInvoice(id, company_id, userId);

    // Log activity
    await logAction({
      userId,
      companyId: company_id,
      action: 'accounting.book_invoice',
      resourceType: 'invoice',
      resourceId: id,
      details: { journal_entry_id: entry.id },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Book invoice error:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Book invoice payment
 * POST /api/v1/accounting/book-invoice-payment/:id
 */
export const bookInvoicePayment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, payment_date, amount } = req.body;
    const userId = req.user?.userId;

    if (!userId || !company_id || !payment_date || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const entry = await accountingService.bookInvoicePayment(
      id,
      company_id,
      userId,
      payment_date,
      parseFloat(amount)
    );

    // Log activity
    await logAction({
      userId,
      companyId: company_id,
      action: 'accounting.book_payment',
      resourceType: 'invoice',
      resourceId: id,
      details: { amount, journal_entry_id: entry.id },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Book invoice payment error:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Book a receipt
 * POST /api/v1/accounting/book-receipt/:id
 */
export const bookReceipt = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const entry = await accountingService.bookReceipt(id, company_id, userId);

    // Log activity
    await logAction({
      userId,
      companyId: company_id,
      action: 'accounting.book_receipt',
      resourceType: 'receipt',
      resourceId: id,
      details: { journal_entry_id: entry.id },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Book receipt error:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get trial balance
 * GET /api/v1/accounting/trial-balance
 */
export const getTrialBalance = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, start_date, end_date } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const trialBalance = await accountingService.getTrialBalance(
      company_id as string,
      start_date as string,
      end_date as string
    );

    res.json(trialBalance);
  } catch (error) {
    console.error('Get trial balance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
