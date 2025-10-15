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

// Update invoice (draft only)
router.put('/:id', invoiceController.updateInvoice);

// Mark invoice as sent
router.post('/:id/send', invoiceController.markInvoiceAsSent);

// Mark invoice as paid
router.post('/:id/mark-paid', invoiceController.markInvoiceAsPaid);

// Cancel invoice
router.post('/:id/cancel', invoiceController.cancelInvoice);

// Delete invoice (draft only)
router.delete('/:id', invoiceController.deleteInvoice);

export default router;
