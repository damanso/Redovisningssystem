import express from 'express';
import * as googleDriveController from '../controllers/googleDriveController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// OAuth flow
router.post('/auth', googleDriveController.getAuthUrl);
router.get('/callback', googleDriveController.handleCallback);
router.post('/callback', googleDriveController.handleCallback);

// Connection management
router.get('/status/:companyId', googleDriveController.getConnectionStatus);
router.post('/disconnect/:companyId', googleDriveController.disconnect);

// Document sync
router.post('/sync/invoice/:invoiceId', googleDriveController.syncInvoice);
router.post('/sync/receipt/:receiptId', googleDriveController.syncReceipt);

// Sync status
router.get('/sync/status/:documentType/:documentId', googleDriveController.getSyncStatus);
router.get('/sync/documents/:companyId', googleDriveController.getSyncedDocuments);

export default router;
