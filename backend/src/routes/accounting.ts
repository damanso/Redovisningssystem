import express from 'express';
import * as accountingController from '../controllers/accountingController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// BAS Chart of Accounts
router.get('/accounts', accountingController.getBASAccounts);

// Trial Balance
router.get('/trial-balance', accountingController.getTrialBalance);

// Journal Entries
router.get('/journal-entries', accountingController.getJournalEntries);
router.get('/journal-entries/:id', accountingController.getJournalEntryById);
router.post('/journal-entries', accountingController.createJournalEntry);

// Booking operations
router.post('/book-invoice/:id', accountingController.bookInvoice);
router.post('/book-invoice-payment/:id', accountingController.bookInvoicePayment);
router.post('/book-receipt/:id', accountingController.bookReceipt);

export default router;
