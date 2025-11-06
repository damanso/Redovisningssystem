/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transactions Routes
 */

import express from 'express';
import * as crossCompanyTransactionController from '../controllers/crossCompanyTransactionController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Transaction CRUD
router.post('/', crossCompanyTransactionController.createCrossCompanyTransaction);
router.get('/', crossCompanyTransactionController.getCrossCompanyTransactions);
router.get('/summary/:companyId', crossCompanyTransactionController.getCompanyTransactionSummary);
router.get('/:id', crossCompanyTransactionController.getCrossCompanyTransactionById);
router.put('/:id', crossCompanyTransactionController.updateCrossCompanyTransaction);
router.delete('/:id', crossCompanyTransactionController.deleteCrossCompanyTransaction);

// Reconciliation
router.post('/:id/reconcile', crossCompanyTransactionController.reconcileTransaction);

export default router;
