/**
 * Payslip Routes
 */

import { Router } from 'express';
import { PayslipController } from '../controllers/payslipController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Payslip CRUD
router.post('/', PayslipController.createPayslip);
router.get('/:id', PayslipController.getPayslip);
router.get('/:id/details', PayslipController.getPayslipWithDetails);
router.put('/:id', PayslipController.updatePayslip);

// Payslip actions
router.post('/:id/approve', PayslipController.approvePayslip);
router.get('/:id/pdf', PayslipController.generatePdf);
router.post('/:id/send', PayslipController.sendPayslipEmail);

// Bulk operations
router.get('/period/:periodId', PayslipController.getPayslipsForPeriod);
router.get('/employee/:employeeId', PayslipController.getPayslipsForEmployee);
router.post('/period/:periodId/send-all', PayslipController.sendAllPayslipsForPeriod);

export default router;
