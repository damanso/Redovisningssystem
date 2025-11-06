/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Routes
 */

import express from 'express';
import * as consolidatedReportController from '../controllers/consolidatedReportController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Report configurations
router.post('/configs', consolidatedReportController.createReportConfig);
router.get('/configs', consolidatedReportController.getReportConfigs);
router.get('/configs/:id', consolidatedReportController.getReportConfigById);
router.put('/configs/:id', consolidatedReportController.updateReportConfig);
router.delete('/configs/:id', consolidatedReportController.deleteReportConfig);

// Report generation
router.post('/generate', consolidatedReportController.generateConsolidatedReport);
router.get('/transactions', consolidatedReportController.getConsolidatedTransactionData);

export default router;
