import express from 'express';
import * as invoiceController from '../controllers/invoiceController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Create invoice
router.post('/', invoiceController.createInvoice);

// Get all invoices
router.get('/', invoiceController.getInvoices);

// Get invoice statistics
router.get('/stats', invoiceController.getInvoiceStats);

// Get invoice by ID
router.get('/:id', invoiceController.getInvoiceById);

// Generate PDF for invoice
router.get('/:id/pdf', invoiceController.generateInvoicePDF);

// Update invoice (draft only)
router.put('/:id', invoiceController.updateInvoice);

// Send invoice via email (also marks as sent)
router.post('/:id/send', invoiceController.sendInvoice);

// Mark invoice as sent (without email)
router.post('/:id/mark-sent', invoiceController.markInvoiceAsSent);

// Mark invoice as paid
router.post('/:id/mark-paid', invoiceController.markInvoiceAsPaid);

// Cancel invoice
router.post('/:id/cancel', invoiceController.cancelInvoice);

// Delete invoice (draft only)
router.delete('/:id', invoiceController.deleteInvoice);

export default router;
