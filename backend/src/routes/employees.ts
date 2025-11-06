/**
 * Employee Routes
 */

import { Router } from 'express';
import { EmployeeController } from '../controllers/employeeController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Employee CRUD
router.post('/', EmployeeController.createEmployee);
router.get('/', EmployeeController.getEmployees);
router.get('/statistics/:companyId', EmployeeController.getEmployeeStatistics);
router.get('/:id', EmployeeController.getEmployeeById);
router.get('/:id/full', EmployeeController.getEmployeeWithConfiguration);
router.put('/:id', EmployeeController.updateEmployee);
router.delete('/:id', EmployeeController.deleteEmployee);

// Salary Configuration
router.get('/:id/salary-configuration', EmployeeController.getSalaryConfiguration);
router.put('/:id/salary-configuration', EmployeeController.updateSalaryConfiguration);

export default router;
