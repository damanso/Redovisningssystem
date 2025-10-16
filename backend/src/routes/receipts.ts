import express from 'express';
import * as receiptController from '../controllers/receiptController';
import { authenticate } from '../middleware/authenticate';
import { upload, handleUploadError } from '../middleware/upload';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Upload receipt with file
router.post(
  '/upload',
  upload.single('file'),
  handleUploadError,
  receiptController.uploadReceipt
);

// Get statistics (must be before /:id to avoid matching "stats" as an id)
router.get('/stats', receiptController.getReceiptStats);

// Get all receipts
router.get('/', receiptController.getReceipts);

// Process OCR for receipt (must be before /:id to avoid matching "process-ocr" as an id)
router.post('/:id/process-ocr', receiptController.processReceiptOCR);

// Get receipt by ID
router.get('/:id', receiptController.getReceiptById);

// Update receipt
router.put('/:id', receiptController.updateReceipt);

// Delete receipt
router.delete('/:id', receiptController.deleteReceipt);

export default router;
