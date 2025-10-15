import express from 'express';
import * as auditController from '../controllers/auditController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get audit logs with filters
router.get('/', auditController.getAuditLogs);

// Get specific audit log
router.get('/:id', auditController.getAuditLogById);

// Get entity history
router.get('/entity/:entityType/:entityId', auditController.getEntityHistory);

// Get user's own activity
router.get('/activity/me', auditController.getUserActivity);

// Get company activity
router.get('/company/:companyId', auditController.getCompanyActivity);

// Get audit statistics
router.get('/stats/summary', auditController.getAuditStats);

export default router;
