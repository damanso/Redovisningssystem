/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Routes
 */

import express from 'express';
import * as companyGroupController from '../controllers/companyGroupController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Company Group CRUD
router.post('/', companyGroupController.createCompanyGroup);
router.get('/', companyGroupController.getCompanyGroups);
router.get('/:id', companyGroupController.getCompanyGroupById);
router.put('/:id', companyGroupController.updateCompanyGroup);
router.delete('/:id', companyGroupController.deleteCompanyGroup);

// Company-Group membership
router.get('/:id/companies', companyGroupController.getCompaniesInGroup);
router.post('/:id/companies', companyGroupController.addCompanyToGroup);
router.delete('/:id/companies/:companyId', companyGroupController.removeCompanyFromGroup);

export default router;
