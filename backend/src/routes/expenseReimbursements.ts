import express from 'express';
import * as expenseReimbursementController from '../controllers/expenseReimbursementController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Create expense reimbursement claim
router.post('/', expenseReimbursementController.createReimbursement);

// Get all expense reimbursements
router.get('/', expenseReimbursementController.getReimbursements);

// Get reimbursements for current user
router.get('/my-reimbursements', expenseReimbursementController.getReimbursementsByUser);

// Get reimbursements by category
router.get('/by-category', expenseReimbursementController.getReimbursementsByCategory);

// Get reimbursement by ID
router.get('/:id', expenseReimbursementController.getReimbursementById);

// Approve expense reimbursement
router.post('/:id/approve', expenseReimbursementController.approveReimbursement);

// Reject expense reimbursement
router.post('/:id/reject', expenseReimbursementController.rejectReimbursement);

// Mark reimbursement as paid
router.post('/:id/mark-paid', expenseReimbursementController.markReimbursementAsPaid);

// Cancel expense reimbursement
router.post('/:id/cancel', expenseReimbursementController.cancelReimbursement);

// Delete expense reimbursement
router.delete('/:id', expenseReimbursementController.deleteReimbursement);

export default router;
