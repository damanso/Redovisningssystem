import express from 'express';
import * as cashFlowController from '../controllers/cashFlowController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get cash flow summary
router.get('/summary', cashFlowController.getCashFlowSummary);

// Calculate available funds (with simulation)
router.post('/calculate-available', cashFlowController.calculateAvailableFunds);

// Get cash flow settings
router.get('/settings', cashFlowController.getSettings);

// Update cash flow settings
router.put('/settings', cashFlowController.updateSettings);

// ==================== Planned Expenses ====================

// Get all planned expenses
router.get('/planned-expenses', cashFlowController.getPlannedExpenses);

// Create planned expense
router.post('/planned-expenses', cashFlowController.createPlannedExpense);

// Update planned expense
router.put('/planned-expenses/:id', cashFlowController.updatePlannedExpense);

// Delete planned expense
router.delete('/planned-expenses/:id', cashFlowController.deletePlannedExpense);

// Mark planned expense as paid
router.post('/planned-expenses/:id/mark-paid', cashFlowController.markPlannedExpenseAsPaid);

export default router;
