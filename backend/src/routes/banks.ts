/**
 * Bank Routes
 * API routes for bank integration
 */

import express from 'express';
import * as bankController from '../controllers/bankController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Bank connections
router.post('/connections', bankController.createBankConnection);
router.get('/connections', bankController.getBankConnections);
router.get('/connections/:id', bankController.getBankConnectionById);
router.delete('/connections/:id', bankController.deleteBankConnection);

// Bank accounts
router.get('/connections/:connectionId/accounts', bankController.getBankAccounts);
router.get('/accounts/:id', bankController.getBankAccountById);
router.post('/accounts/:id/sync', bankController.syncBankAccount);

// Bank transactions
router.get('/accounts/:id/transactions', bankController.getBankTransactions);
router.get('/transactions/:id/match-candidates', bankController.findMatchingCandidates);
router.post('/transactions/:id/match', bankController.matchTransaction);
router.post('/transactions/:id/reconcile', bankController.reconcileTransaction);

// Reconciliation
router.get('/reconciliation/summary', bankController.getReconciliationSummary);

export default router;
