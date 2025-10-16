import express from 'express';
import * as dashboardController from '../controllers/dashboardController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Dashboard statistics
router.get('/stats', dashboardController.getDashboardStats);

// Quick actions summary
router.get('/quick-actions', dashboardController.getQuickActions);

export default router;
