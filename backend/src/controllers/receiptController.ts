import { Response } from 'express';
import { AuthRequest } from '../middleware/authenticate';
import * as receiptService from '../services/receiptService';
import { CreateReceiptDto, UpdateReceiptDto, ReceiptFilters } from '../types/receipt.types';
import { logAction } from '../services/auditService';
import { extractReceiptData } from '../services/aiService';

/**
 * Upload and create a new receipt
 * POST /api/v1/receipts/upload
 */
export const uploadReceipt = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Upload file to local storage
    const fileUrl = await receiptService.uploadReceiptFile(req.file, company_id);

    // Create receipt record
    const data: CreateReceiptDto = {
      supplier_id: req.body.supplier_id || undefined,
      receipt_date: req.body.receipt_date || new Date().toISOString().split('T')[0],
      amount: parseFloat(req.body.amount) || 0,
      vat_amount: req.body.vat_amount ? parseFloat(req.body.vat_amount) : undefined,
      category: req.body.category || undefined,
      description: req.body.description || undefined
    };

    const receipt = await receiptService.createReceipt(
      company_id,
      userId,
      data,
      fileUrl,
      req.file.mimetype
    );

    // Log activity
    await logAction(
      userId,
      'receipt.create',
      'receipt',
      {
        companyId: company_id,
        entityId: receipt.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    );

    res.status(201).json(receipt);
  } catch (error) {
    console.error('Upload receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all receipts for a company
 * GET /api/v1/receipts
 */
export const getReceipts = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, supplier_id, status, start_date, end_date, category, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const filters: ReceiptFilters = {
      supplier_id: supplier_id as string,
      status: status as string,
      start_date: start_date as string,
      end_date: end_date as string,
      category: category as string
    };

    const receipts = await receiptService.getReceipts(
      company_id as string,
      filters,
      limit ? parseInt(limit as string) : 50,
      offset ? parseInt(offset as string) : 0
    );

    res.json(receipts);
  } catch (error) {
    console.error('Get receipts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get a single receipt by ID
 * GET /api/v1/receipts/:id
 */
export const getReceiptById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const receipt = await receiptService.getReceiptById(id, company_id as string);

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    res.json(receipt);
  } catch (error) {
    console.error('Get receipt by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update a receipt
 * PUT /api/v1/receipts/:id
 */
export const updateReceipt = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;
    const userId = req.user?.userId;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    // Check if receipt exists
    const existingReceipt = await receiptService.getReceiptById(id, company_id);
    if (!existingReceipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Don't allow updating booked receipts
    if (existingReceipt.status === 'booked' && updates.status !== 'booked') {
      return res.status(400).json({ error: 'Cannot modify booked receipts' });
    }

    const updateData: UpdateReceiptDto = {};

    if (updates.supplier_id !== undefined) updateData.supplier_id = updates.supplier_id;
    if (updates.receipt_date !== undefined) updateData.receipt_date = updates.receipt_date;
    if (updates.amount !== undefined) updateData.amount = parseFloat(updates.amount);
    if (updates.vat_amount !== undefined) updateData.vat_amount = parseFloat(updates.vat_amount);
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.ocr_data !== undefined) updateData.ocr_data = updates.ocr_data;

    const receipt = await receiptService.updateReceipt(id, company_id, updateData);

    // Log activity
    if (userId) {
      await logAction(
        userId,
        'receipt.update',
        'receipt',
        {
          companyId: company_id,
          entityId: receipt.id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      );
    }

    res.json(receipt);
  } catch (error) {
    console.error('Update receipt error:', error);
    if (error instanceof Error && error.message === 'Receipt not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete a receipt
 * DELETE /api/v1/receipts/:id
 */
export const deleteReceipt = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await receiptService.deleteReceipt(id, company_id);

    // Log activity
    if (userId) {
      await logAction(
        userId,
        'receipt.delete',
        'receipt',
        {
          companyId: company_id,
          entityId: id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      );
    }

    res.json({ message: 'Receipt deleted successfully' });
  } catch (error) {
    console.error('Delete receipt error:', error);
    if (error instanceof Error) {
      if (error.message === 'Receipt not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message === 'Cannot delete booked receipts') {
        return res.status(400).json({ error: error.message });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get receipt statistics
 * GET /api/v1/receipts/stats
 */
export const getReceiptStats = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, start_date, end_date, category } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const filters: ReceiptFilters = {
      start_date: start_date as string,
      end_date: end_date as string,
      category: category as string
    };

    const stats = await receiptService.getReceiptStats(company_id as string, filters);

    res.json(stats);
  } catch (error) {
    console.error('Get receipt stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Process receipt OCR using AI
 * POST /api/v1/receipts/:id/process-ocr
 */
export const processReceiptOCR = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    const userId = req.user?.userId;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    // Get receipt
    const receipt = await receiptService.getReceiptById(id, company_id as string);
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Check if file is an image
    if (!receipt.file_type.startsWith('image/')) {
      return res.status(400).json({ error: 'OCR only works with images' });
    }

    // Extract data using AI
    const ocrData = await extractReceiptData(receipt.file_url);

    // Prepare updates
    const updates: UpdateReceiptDto = {
      ocr_data: ocrData,
      status: 'processed'
    };

    // Update fields from OCR data if confidence is high enough
    if (ocrData.confidence >= 70) {
      if (ocrData.receipt_date) {
        updates.receipt_date = ocrData.receipt_date;
      }

      if (ocrData.amount) {
        updates.amount = ocrData.amount;
      }

      if (ocrData.vat_amount) {
        updates.vat_amount = ocrData.vat_amount;
      }

      if (ocrData.category) {
        updates.category = ocrData.category;
      }
    }

    // Update receipt with OCR data
    const updatedReceipt = await receiptService.updateReceipt(id, company_id as string, updates);

    // Log activity
    if (userId) {
      await logAction(
        userId,
        'receipt.update',
        'receipt',
        {
          companyId: company_id as string,
          entityId: id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      );
    }

    res.json({
      receipt: updatedReceipt,
      ocr_data: ocrData
    });
  } catch (error) {
    console.error('Process OCR error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
