import { Request, Response } from 'express';
import googleDriveService from '../services/googleDriveService.js';
import pool from '../config/database.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Get Google Drive authorization URL
 */
export const getAuthUrl = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.body;
    const userId = (req as any).user?.userId;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    // Verify user has access to this company
    const companyCheck = await pool.query(
      `SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    const authUrl = await googleDriveService.getAuthorizationUrl(companyId);

    res.json({ authUrl });
  } catch (error: any) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
};

/**
 * Handle OAuth callback
 */
export const handleCallback = async (req: Request, res: Response) => {
  try {
    const { code, state: companyId } = req.query;
    const userId = (req as any).user?.userId;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    // Verify user has access to this company
    const companyCheck = await pool.query(
      `SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    await googleDriveService.handleOAuthCallback(code, companyId, userId);

    res.json({ message: 'Google Drive connected successfully' });
  } catch (error: any) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).json({ error: 'Failed to connect Google Drive' });
  }
};

/**
 * Check connection status
 */
export const getConnectionStatus = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const userId = (req as any).user?.userId;

    // Verify user has access to this company
    const companyCheck = await pool.query(
      `SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    const isConnected = await googleDriveService.isConnected(companyId);
    const stats = isConnected ? await googleDriveService.getSyncStats(companyId) : null;

    res.json({
      connected: isConnected,
      stats: stats || [],
    });
  } catch (error: any) {
    console.error('Error checking connection status:', error);
    res.status(500).json({ error: 'Failed to check connection status' });
  }
};

/**
 * Disconnect Google Drive
 */
export const disconnect = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const userId = (req as any).user?.userId;

    // Verify user has access to this company
    const companyCheck = await pool.query(
      `SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    await googleDriveService.disconnect(companyId);

    res.json({ message: 'Google Drive disconnected successfully' });
  } catch (error: any) {
    console.error('Error disconnecting Google Drive:', error);
    res.status(500).json({ error: 'Failed to disconnect Google Drive' });
  }
};

/**
 * Sync invoice to Google Drive
 */
export const syncInvoice = async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    const userId = (req as any).user?.userId;

    // Get invoice details
    const invoiceQuery = `
      SELECT i.id, i.company_id, i.invoice_number, i.pdf_url
      FROM invoices i
      JOIN user_companies uc ON i.company_id = uc.company_id
      WHERE i.id = $1 AND uc.user_id = $2
    `;

    const invoiceResult = await pool.query(invoiceQuery, [invoiceId, userId]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found or access denied' });
    }

    const invoice = invoiceResult.rows[0];

    // Check if company has Google Drive connected
    const isConnected = await googleDriveService.isConnected(invoice.company_id);

    if (!isConnected) {
      return res.status(400).json({ error: 'Google Drive not connected for this company' });
    }

    // Generate PDF if not exists (reuse existing PDF generation logic)
    let pdfPath = invoice.pdf_url;

    if (!pdfPath || pdfPath.startsWith('/uploads/')) {
      // PDF is stored locally, use it
      pdfPath = path.join(process.cwd(), pdfPath);
    } else {
      return res.status(400).json({ error: 'Invoice PDF not available' });
    }

    // Check if file exists
    try {
      await fs.access(pdfPath);
    } catch {
      return res.status(400).json({ error: 'Invoice PDF file not found' });
    }

    // Sync to Google Drive
    const result = await googleDriveService.syncInvoice(
      invoiceId,
      invoice.company_id,
      userId,
      pdfPath,
      invoice.invoice_number
    );

    if (result.success) {
      res.json({
        message: 'Invoice synced to Google Drive successfully',
        driveFileId: result.driveFileId,
        driveFileName: result.driveFileName,
        webViewLink: result.webViewLink,
      });
    } else {
      res.status(500).json({ error: result.error || 'Failed to sync invoice' });
    }
  } catch (error: any) {
    console.error('Error syncing invoice:', error);
    res.status(500).json({ error: 'Failed to sync invoice to Google Drive' });
  }
};

/**
 * Sync receipt to Google Drive
 */
export const syncReceipt = async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;
    const userId = (req as any).user?.userId;

    // Get receipt details
    const receiptQuery = `
      SELECT r.id, r.company_id, r.file_url, r.file_type
      FROM receipts r
      JOIN user_companies uc ON r.company_id = uc.company_id
      WHERE r.id = $1 AND uc.user_id = $2
    `;

    const receiptResult = await pool.query(receiptQuery, [receiptId, userId]);

    if (receiptResult.rows.length === 0) {
      return res.status(404).json({ error: 'Receipt not found or access denied' });
    }

    const receipt = receiptResult.rows[0];

    // Check if company has Google Drive connected
    const isConnected = await googleDriveService.isConnected(receipt.company_id);

    if (!isConnected) {
      return res.status(400).json({ error: 'Google Drive not connected for this company' });
    }

    // Get file path
    let filePath = receipt.file_url;

    if (filePath.startsWith('/uploads/')) {
      filePath = path.join(process.cwd(), filePath);
    } else {
      return res.status(400).json({ error: 'Receipt file not available' });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(400).json({ error: 'Receipt file not found' });
    }

    // Extract filename from path
    const fileName = path.basename(filePath);

    // Sync to Google Drive
    const result = await googleDriveService.syncReceipt(
      receiptId,
      receipt.company_id,
      userId,
      filePath,
      fileName,
      receipt.file_type
    );

    if (result.success) {
      res.json({
        message: 'Receipt synced to Google Drive successfully',
        driveFileId: result.driveFileId,
        driveFileName: result.driveFileName,
        webViewLink: result.webViewLink,
      });
    } else {
      res.status(500).json({ error: result.error || 'Failed to sync receipt' });
    }
  } catch (error: any) {
    console.error('Error syncing receipt:', error);
    res.status(500).json({ error: 'Failed to sync receipt to Google Drive' });
  }
};

/**
 * Get sync status for a document
 */
export const getSyncStatus = async (req: Request, res: Response) => {
  try {
    const { documentType, documentId } = req.params;
    const userId = (req as any).user?.userId;

    // Verify access based on document type
    let accessQuery = '';

    if (documentType === 'invoice') {
      accessQuery = `
        SELECT i.company_id
        FROM invoices i
        JOIN user_companies uc ON i.company_id = uc.company_id
        WHERE i.id = $1 AND uc.user_id = $2
      `;
    } else if (documentType === 'receipt') {
      accessQuery = `
        SELECT r.company_id
        FROM receipts r
        JOIN user_companies uc ON r.company_id = uc.company_id
        WHERE r.id = $1 AND uc.user_id = $2
      `;
    } else {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const accessCheck = await pool.query(accessQuery, [documentId, userId]);

    if (accessCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }

    const syncStatus = await googleDriveService.getSyncStatus(documentType, documentId);

    res.json({ syncStatus });
  } catch (error: any) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
};

/**
 * Get all synced documents for a company
 */
export const getSyncedDocuments = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const userId = (req as any).user?.userId;

    // Verify user has access to this company
    const companyCheck = await pool.query(
      `SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    const query = `
      SELECT
        gds.id,
        gds.document_type,
        gds.document_id,
        gds.drive_file_name,
        gds.web_view_link,
        gds.last_synced_at,
        gds.sync_status,
        CASE
          WHEN gds.document_type = 'invoice' THEN i.invoice_number
          WHEN gds.document_type = 'receipt' THEN r.description
        END as document_name
      FROM google_drive_sync gds
      LEFT JOIN invoices i ON gds.document_type = 'invoice' AND gds.document_id = i.id
      LEFT JOIN receipts r ON gds.document_type = 'receipt' AND gds.document_id = r.id
      WHERE gds.company_id = $1 AND gds.sync_status = 'synced'
      ORDER BY gds.last_synced_at DESC
    `;

    const result = await pool.query(query, [companyId]);

    res.json({ documents: result.rows });
  } catch (error: any) {
    console.error('Error getting synced documents:', error);
    res.status(500).json({ error: 'Failed to get synced documents' });
  }
};
