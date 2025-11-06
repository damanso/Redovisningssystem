import express from 'express';
import * as salaryWithdrawalController from '../controllers/salaryWithdrawalController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Create salary withdrawal request
router.post('/', salaryWithdrawalController.createWithdrawal);

// Get all salary withdrawals
router.get('/', salaryWithdrawalController.getWithdrawals);

// Get withdrawals for current user
router.get('/my-withdrawals', salaryWithdrawalController.getWithdrawalsByUser);

// Get withdrawal by ID
router.get('/:id', salaryWithdrawalController.getWithdrawalById);

// Approve salary withdrawal
router.post('/:id/approve', salaryWithdrawalController.approveWithdrawal);

// Reject salary withdrawal
router.post('/:id/reject', salaryWithdrawalController.rejectWithdrawal);

// Mark withdrawal as paid
router.post('/:id/mark-paid', salaryWithdrawalController.markWithdrawalAsPaid);

// Cancel salary withdrawal
router.post('/:id/cancel', salaryWithdrawalController.cancelWithdrawal);

// Delete salary withdrawal
router.delete('/:id', salaryWithdrawalController.deleteWithdrawal);

export default router;
