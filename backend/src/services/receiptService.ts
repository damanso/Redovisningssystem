import { query } from '../config/database';
import { Receipt, CreateReceiptDto, UpdateReceiptDto, ReceiptFilters, ReceiptStats } from '../types/receipt.types';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'receipts');

/**
 * Upload receipt file to local storage
 * Returns the local file URL
 */
export const uploadReceiptFile = async (
  file: Express.Multer.File,
  companyId: string
): Promise<string> => {
  // Ensure company directory exists
  const companyDir = path.join(UPLOAD_DIR, companyId);
  await fs.mkdir(companyDir, { recursive: true });

  // Generate unique filename
  const fileExtension = file.originalname.split('.').pop() || 'unknown';
  const fileName = `${uuidv4()}.${fileExtension}`;
  const filePath = path.join(companyDir, fileName);

  // Write file to disk
  await fs.writeFile(filePath, file.buffer);

  // Return relative URL path
  return `/uploads/receipts/${companyId}/${fileName}`;
};

/**
 * Create a new receipt record
 */
export const createReceipt = async (
  companyId: string,
  userId: string,
  data: CreateReceiptDto,
  fileUrl: string,
  fileType: string
): Promise<Receipt> => {
  const total_amount = data.amount + (data.vat_amount || 0);

  const result = await query(
    `INSERT INTO receipts (
      company_id, supplier_id, receipt_date, amount, vat_amount, total_amount,
      category, description, file_url, file_type, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      companyId,
      data.supplier_id || null,
      data.receipt_date,
      data.amount,
      data.vat_amount || null,
      total_amount,
      data.category || null,
      data.description || null,
      fileUrl,
      fileType,
      userId
    ]
  );

  return result.rows[0];
};

/**
 * Get all receipts for a company with optional filters
 */
export const getReceipts = async (
  companyId: string,
  filters?: ReceiptFilters,
  limit: number = 50,
  offset: number = 0
): Promise<Receipt[]> => {
  let queryText = `
    SELECT r.*, s.name as supplier_name
    FROM receipts r
    LEFT JOIN suppliers s ON r.supplier_id = s.id
    WHERE r.company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.supplier_id) {
    queryText += ` AND r.supplier_id = $${paramCount}`;
    params.push(filters.supplier_id);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND r.status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  if (filters?.start_date) {
    queryText += ` AND r.receipt_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND r.receipt_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  if (filters?.category) {
    queryText += ` AND r.category = $${paramCount}`;
    params.push(filters.category);
    paramCount++;
  }

  queryText += ` ORDER BY r.receipt_date DESC, r.created_at DESC`;
  queryText += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
  params.push(limit, offset);

  const result = await query(queryText, params);
  return result.rows;
};

/**
 * Get a single receipt by ID
 */
export const getReceiptById = async (
  receiptId: string,
  companyId: string
): Promise<Receipt | null> => {
  const result = await query(
    `SELECT r.*, s.name as supplier_name
     FROM receipts r
     LEFT JOIN suppliers s ON r.supplier_id = s.id
     WHERE r.id = $1 AND r.company_id = $2`,
    [receiptId, companyId]
  );

  return result.rows[0] || null;
};

/**
 * Update a receipt
 */
export const updateReceipt = async (
  receiptId: string,
  companyId: string,
  updates: UpdateReceiptDto
): Promise<Receipt> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  // Only update fields that are provided
  if (updates.supplier_id !== undefined) {
    fields.push(`supplier_id = $${paramCount}`);
    values.push(updates.supplier_id);
    paramCount++;
  }

  if (updates.receipt_date !== undefined) {
    fields.push(`receipt_date = $${paramCount}`);
    values.push(updates.receipt_date);
    paramCount++;
  }

  if (updates.amount !== undefined) {
    fields.push(`amount = $${paramCount}`);
    values.push(updates.amount);
    paramCount++;
  }

  if (updates.vat_amount !== undefined) {
    fields.push(`vat_amount = $${paramCount}`);
    values.push(updates.vat_amount);
    paramCount++;
  }

  // Recalculate total if amount or vat changed
  if (updates.amount !== undefined || updates.vat_amount !== undefined) {
    // Get current values
    const current = await getReceiptById(receiptId, companyId);
    if (!current) {
      throw new Error('Receipt not found');
    }

    const newAmount = updates.amount ?? current.amount;
    const newVat = updates.vat_amount ?? current.vat_amount ?? 0;
    const newTotal = newAmount + newVat;

    fields.push(`total_amount = $${paramCount}`);
    values.push(newTotal);
    paramCount++;
  }

  if (updates.category !== undefined) {
    fields.push(`category = $${paramCount}`);
    values.push(updates.category);
    paramCount++;
  }

  if (updates.description !== undefined) {
    fields.push(`description = $${paramCount}`);
    values.push(updates.description);
    paramCount++;
  }

  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount}`);
    values.push(updates.status);
    paramCount++;
  }

  if (updates.ocr_data !== undefined) {
    fields.push(`ocr_data = $${paramCount}`);
    values.push(JSON.stringify(updates.ocr_data));
    paramCount++;
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(receiptId, companyId);

  const result = await query(
    `UPDATE receipts
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Receipt not found');
  }

  return result.rows[0];
};

/**
 * Delete a receipt (soft delete by updating status)
 */
export const deleteReceipt = async (
  receiptId: string,
  companyId: string
): Promise<void> => {
  // First check if receipt can be deleted (not booked)
  const receipt = await getReceiptById(receiptId, companyId);
  if (!receipt) {
    throw new Error('Receipt not found');
  }

  if (receipt.status === 'booked') {
    throw new Error('Cannot delete booked receipts');
  }

  // Delete the file
  if (receipt.file_url) {
    const filePath = path.join(process.cwd(), receipt.file_url);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Failed to delete file:', error);
      // Continue with database deletion even if file deletion fails
    }
  }

  // Delete from database
  await query(
    'DELETE FROM receipts WHERE id = $1 AND company_id = $2',
    [receiptId, companyId]
  );
};

/**
 * Get receipt statistics for a company
 */
export const getReceiptStats = async (
  companyId: string,
  filters?: ReceiptFilters
): Promise<ReceiptStats> => {
  let queryText = `
    SELECT
      COUNT(*)::int as total_receipts,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending_receipts,
      COUNT(*) FILTER (WHERE status = 'processed')::int as processed_receipts,
      COUNT(*) FILTER (WHERE status = 'booked')::int as booked_receipts,
      COALESCE(SUM(total_amount), 0)::numeric as total_amount,
      COALESCE(SUM(vat_amount), 0)::numeric as total_vat
    FROM receipts
    WHERE company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.start_date) {
    queryText += ` AND receipt_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND receipt_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  if (filters?.category) {
    queryText += ` AND category = $${paramCount}`;
    params.push(filters.category);
    paramCount++;
  }

  const result = await query(queryText, params);
  return result.rows[0];
};
