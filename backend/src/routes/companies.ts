import express from 'express';
import * as companyController from '../controllers/companyController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Company CRUD operations
router.post('/', companyController.createCompany);
router.get('/', companyController.getUserCompanies);
router.get('/:id', companyController.getCompanyById);
router.put('/:id', companyController.updateCompany);
router.delete('/:id', companyController.deactivateCompany);

// User-Company relationship operations
router.get('/:id/users', companyController.getCompanyUsers);
router.post('/:id/users', companyController.addUserToCompany);
router.delete('/:id/users/:userId', companyController.removeUserFromCompany);
router.put('/:id/users/:userId/role', companyController.updateUserRole);

export default router;
