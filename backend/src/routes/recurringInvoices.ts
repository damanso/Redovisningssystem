import express from 'express';
import * as recurringInvoiceController from '../controllers/recurringInvoiceController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Statistics
router.get('/stats', recurringInvoiceController.getRecurringInvoiceStats);

// CRUD operations
router.post('/', recurringInvoiceController.createRecurringInvoice);
router.get('/', recurringInvoiceController.getRecurringInvoices);
router.get('/:id', recurringInvoiceController.getRecurringInvoiceById);
router.put('/:id', recurringInvoiceController.updateRecurringInvoice);
router.delete('/:id', recurringInvoiceController.deleteRecurringInvoice);

// Actions
router.post('/:id/generate', recurringInvoiceController.generateInvoice);
router.post('/:id/pause', recurringInvoiceController.pauseRecurringInvoice);
router.post('/:id/resume', recurringInvoiceController.resumeRecurringInvoice);
router.post('/:id/cancel', recurringInvoiceController.cancelRecurringInvoice);

// History
router.get('/:id/history', recurringInvoiceController.getRecurringInvoiceHistory);

export default router;
