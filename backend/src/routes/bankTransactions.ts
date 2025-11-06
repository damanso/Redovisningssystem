import express from 'express';
import * as bankTransactionController from '../controllers/bankTransactionController.js';
import { authenticate } from '../middleware/authenticate.js';
import { bankFileUpload, handleBankFileUploadError } from '../middleware/bankFileUpload.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Upload transaction file (CSV/Excel)
router.post(
  '/upload',
  bankFileUpload.single('file'),
  handleBankFileUploadError,
  bankTransactionController.uploadTransactionFile
);

// Create manual transaction
router.post('/', bankTransactionController.createTransaction);

// Get all transactions
router.get('/', bankTransactionController.getTransactions);

// Get transaction by ID
router.get('/:id', bankTransactionController.getTransactionById);

// Link transaction to invoice
router.post('/:id/link-invoice', bankTransactionController.linkToInvoice);

// Link transaction to receipt
router.post('/:id/link-receipt', bankTransactionController.linkToReceipt);

// Ignore transaction
router.post('/:id/ignore', bankTransactionController.ignoreTransaction);

// Delete transaction
router.delete('/:id', bankTransactionController.deleteTransaction);

export default router;
