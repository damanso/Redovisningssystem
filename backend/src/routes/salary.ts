/**
 * Salary Routes
 */

import { Router } from 'express';
import { SalaryController } from '../controllers/salaryController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Salary Periods
router.post('/periods', SalaryController.createSalaryPeriod);
router.get('/periods', SalaryController.getSalaryPeriods);
router.get('/periods/:id', SalaryController.getSalaryPeriod);
router.put('/periods/:id', SalaryController.updateSalaryPeriod);
router.post('/periods/:id/generate', SalaryController.generatePayslipsForPeriod);

// Vacation
router.get('/vacation/:employeeId', SalaryController.getVacationBalance);
router.get('/vacation/:employeeId/history', SalaryController.getVacationHistory);
router.get('/vacation/:employeeId/termination-compensation', SalaryController.calculateTerminationCompensation);

export default router;
