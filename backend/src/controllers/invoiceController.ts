import { Response } from 'express';
import * as invoiceService from '../services/invoiceService.js';
import { CreateInvoiceDto, UpdateInvoiceDto, MarkAsPaidDto } from '../types/invoice.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

export const createInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const data: CreateInvoiceDto = req.body;
    const invoice = await invoiceService.createInvoice(company_id, userId, data);

    res.status(201).json(invoice);
  } catch (error: any) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, customer_id, status, search, start_date, end_date, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await invoiceService.getInvoices(company_id as string, {
      customer_id: customer_id as string,
      status: status as string,
      search: search as string,
      start_date: start_date as string,
      end_date: end_date as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getInvoiceById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const invoice = await invoiceService.getInvoiceById(id, company_id as string);

    res.json(invoice);
  } catch (error: any) {
    if (error.message === 'Invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, ...updates } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const invoice = await invoiceService.updateInvoice(
      id,
      company_id,
      userId,
      updates as UpdateInvoiceDto
    );

    res.json(invoice);
  } catch (error: any) {
    if (error.message === 'Invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Only draft invoices can be updated') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const markInvoiceAsSent = async (req: AuthRequest, res: Response) => {
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

    const invoice = await invoiceService.markInvoiceAsSent(id, company_id, userId);

    res.json(invoice);
  } catch (error: any) {
    if (error.message === 'Invoice not found or cannot be sent') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Mark invoice as sent error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const markInvoiceAsPaid = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, paid_amount, paid_date }: MarkAsPaidDto & { company_id: string } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    if (!paid_amount || !paid_date) {
      return res.status(400).json({ error: 'paid_amount and paid_date are required' });
    }

    const invoice = await invoiceService.markInvoiceAsPaid(
      id,
      company_id,
      userId,
      paid_amount,
      new Date(paid_date)
    );

    res.json(invoice);
  } catch (error: any) {
    if (error.message === 'Invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Mark invoice as paid error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const cancelInvoice = async (req: AuthRequest, res: Response) => {
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

    const invoice = await invoiceService.cancelInvoice(id, company_id, userId);

    res.json(invoice);
  } catch (error: any) {
    if (error.message === 'Invoice not found or cannot be cancelled') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Cancel invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteInvoice = async (req: AuthRequest, res: Response) => {
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

    await invoiceService.deleteInvoice(id, company_id, userId);

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error: any) {
    if (error.message === 'Invoice not found or cannot be deleted') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Delete invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getInvoiceStats = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const stats = await invoiceService.getInvoiceStats(company_id as string);

    res.json(stats);
  } catch (error: any) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
