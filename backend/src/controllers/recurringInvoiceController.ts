import { Request, Response } from 'express';
import * as recurringInvoiceService from '../services/recurringInvoiceService.js';
import { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto, RecurringInvoiceFilters } from '../types/recurringInvoice.types.js';

// Create recurring invoice
export const createRecurringInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data: CreateRecurringInvoiceDto = req.body;

    // Validate required fields
    if (!data.customer_id || !data.template_name || !data.frequency || !data.start_date || !data.lines || data.lines.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const recurring = await recurringInvoiceService.createRecurringInvoice(companyId, userId, data);

    res.status(201).json(recurring);
  } catch (error: any) {
    console.error('Error creating recurring invoice:', error);
    res.status(500).json({ error: error.message || 'Failed to create recurring invoice' });
  }
};

// Get all recurring invoices with filters
export const getRecurringInvoices = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filters: RecurringInvoiceFilters = {
      customer_id: req.query.customer_id as string,
      status: req.query.status as any,
      search: req.query.search as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined
    };

    const result = await recurringInvoiceService.getRecurringInvoices(companyId, filters);

    res.json(result);
  } catch (error: any) {
    console.error('Error fetching recurring invoices:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch recurring invoices' });
  }
};

// Get recurring invoice by ID
export const getRecurringInvoiceById = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const recurring = await recurringInvoiceService.getRecurringInvoiceById(id, companyId);

    res.json(recurring);
  } catch (error: any) {
    console.error('Error fetching recurring invoice:', error);
    if (error.message === 'Recurring invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to fetch recurring invoice' });
  }
};

// Update recurring invoice
export const updateRecurringInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data: UpdateRecurringInvoiceDto = req.body;

    const recurring = await recurringInvoiceService.updateRecurringInvoice(id, companyId, userId, data);

    res.json(recurring);
  } catch (error: any) {
    console.error('Error updating recurring invoice:', error);
    if (error.message === 'Recurring invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to update recurring invoice' });
  }
};

// Generate invoice from recurring template
export const generateInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = req.body;

    const result = await recurringInvoiceService.generateInvoiceFromRecurring(id, companyId, userId, data);

    res.status(201).json(result);
  } catch (error: any) {
    console.error('Error generating invoice from recurring:', error);
    if (error.message === 'Recurring invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Recurring invoice is not active' || error.message === 'Recurring invoice has reached its limit') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to generate invoice' });
  }
};

// Pause recurring invoice
export const pauseRecurringInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const recurring = await recurringInvoiceService.pauseRecurringInvoice(id, companyId, userId);

    res.json(recurring);
  } catch (error: any) {
    console.error('Error pausing recurring invoice:', error);
    if (error.message === 'Recurring invoice not found or cannot be paused') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to pause recurring invoice' });
  }
};

// Resume recurring invoice
export const resumeRecurringInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const recurring = await recurringInvoiceService.resumeRecurringInvoice(id, companyId, userId);

    res.json(recurring);
  } catch (error: any) {
    console.error('Error resuming recurring invoice:', error);
    if (error.message === 'Recurring invoice not found or cannot be resumed') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to resume recurring invoice' });
  }
};

// Cancel recurring invoice
export const cancelRecurringInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const recurring = await recurringInvoiceService.cancelRecurringInvoice(id, companyId, userId);

    res.json(recurring);
  } catch (error: any) {
    console.error('Error cancelling recurring invoice:', error);
    if (error.message === 'Recurring invoice not found or cannot be cancelled') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to cancel recurring invoice' });
  }
};

// Delete recurring invoice
export const deleteRecurringInvoice = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await recurringInvoiceService.deleteRecurringInvoice(id, companyId, userId);

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting recurring invoice:', error);
    if (error.message === 'Recurring invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to delete recurring invoice' });
  }
};

// Get recurring invoice history
export const getRecurringInvoiceHistory = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const history = await recurringInvoiceService.getRecurringInvoiceHistory(id, companyId);

    res.json(history);
  } catch (error: any) {
    console.error('Error fetching recurring invoice history:', error);
    if (error.message === 'Recurring invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to fetch history' });
  }
};

// Get recurring invoice statistics
export const getRecurringInvoiceStats = async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const stats = await recurringInvoiceService.getRecurringInvoiceStats(companyId);

    res.json(stats);
  } catch (error: any) {
    console.error('Error fetching recurring invoice stats:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
  }
};
