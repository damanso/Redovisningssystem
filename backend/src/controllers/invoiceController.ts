import { Response } from 'express';
import * as invoiceService from '../services/invoiceService.js';
import * as pdfService from '../services/pdfService.js';
import * as emailService from '../services/emailService.js';
import { CreateInvoiceDto, UpdateInvoiceDto, MarkAsPaidDto } from '../types/invoice.types.js';
import { AuthRequest } from '../middleware/authenticate.js';
import { query } from '../config/database.js';

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

export const generateInvoicePDF = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    // Get complete invoice data
    const invoice = await invoiceService.getInvoiceById(id, company_id as string);

    // Get company data
    const companyRes = await query(
      'SELECT * FROM companies WHERE id = $1',
      [company_id]
    );

    if (companyRes.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const company = companyRes.rows[0];

    // Get customer data
    const customerRes = await query(
      'SELECT * FROM customers WHERE id = $1',
      [invoice.customer_id]
    );

    if (customerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = customerRes.rows[0];

    // Prepare PDF data
    const pdfData = {
      invoice: {
        invoice_number: invoice.invoice_number,
        invoice_date: new Date(invoice.invoice_date).toISOString().split('T')[0],
        due_date: new Date(invoice.due_date).toISOString().split('T')[0],
        ocr_number: invoice.ocr_number || '',
        reference: invoice.reference,
        notes: invoice.notes
      },
      company: {
        name: company.name,
        org_number: company.org_number,
        address: company.address,
        postal_code: company.postal_code,
        city: company.city,
        phone: company.phone,
        email: company.email,
        website: company.website,
        vat_number: company.vat_number,
        bank_account: company.bank_account
      },
      customer: {
        name: customer.name,
        org_number: customer.org_number,
        address: customer.address_street,
        postal_code: customer.address_postal_code,
        city: customer.address_city
      },
      lines: (invoice.lines || []).map((line: any) => ({
        description: line.description,
        quantity: parseFloat(line.quantity),
        unit: line.unit,
        unit_price: parseFloat(line.unit_price),
        vat_rate: parseFloat(line.vat_rate),
        amount: parseFloat(line.amount)
      })),
      totals: {
        subtotal: Number(invoice.subtotal),
        vat_amount: Number(invoice.vat_amount),
        total_amount: Number(invoice.total_amount)
      }
    };

    // Generate PDF
    const pdfResult = await pdfService.generateInvoicePDF(pdfData);

    // Update invoice with PDF URL
    await query(
      'UPDATE invoices SET pdf_url = $1 WHERE id = $2',
      [pdfResult.fileName, id]
    );

    // Send PDF as download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.fileName}"`);
    res.send(pdfResult.buffer);

  } catch (error: any) {
    if (error.message === 'Invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Generate invoice PDF error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Send invoice via email
 * POST /api/v1/invoices/:id/send
 */
export const sendInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, recipient_email, recipient_name } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    if (!recipient_email) {
      return res.status(400).json({ error: 'recipient_email is required' });
    }

    // Get invoice to check it exists and get customer info if no recipient_name provided
    const invoice = await invoiceService.getInvoiceById(id, company_id);

    // Get customer name if not provided
    let recipientName = recipient_name;
    if (!recipientName) {
      const customerRes = await query(
        'SELECT name FROM customers WHERE id = $1',
        [invoice.customer_id]
      );
      recipientName = customerRes.rows[0]?.name || 'Kund';
    }

    // Send email
    await emailService.sendInvoiceEmail(
      id,
      company_id,
      recipient_email,
      recipientName
    );

    // Mark invoice as sent
    await invoiceService.markInvoiceAsSent(id, company_id, userId);

    res.json({
      message: 'Invoice sent successfully',
      sent_to: recipient_email
    });
  } catch (error: any) {
    if (error.message === 'Invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Company not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Send invoice error:', error);
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
};
