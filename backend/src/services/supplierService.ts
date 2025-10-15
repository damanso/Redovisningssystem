import { query } from '../config/database.js';
import {
  Supplier,
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierContact,
  SupplierNote,
  SupplierFilters,
  SupplierListResponse,
  CreateSupplierContactDto,
  CreateSupplierNoteDto
} from '../types/supplier.types.js';
import * as auditService from './auditService.js';

// Supplier CRUD operations
export const createSupplier = async (
  companyId: string,
  userId: string,
  data: CreateSupplierDto
): Promise<Supplier> => {
  const result = await query(
    `INSERT INTO suppliers (
      company_id, name, org_number, contact_person, email, phone, mobile,
      website, address_street, address_postal_code, address_city, address_country,
      payment_terms, discount_percentage, currency, vat_number, notes, tags, category, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *`,
    [
      companyId,
      data.name,
      data.org_number || null,
      data.contact_person || null,
      data.email || null,
      data.phone || null,
      data.mobile || null,
      data.website || null,
      data.address_street || null,
      data.address_postal_code || null,
      data.address_city || null,
      data.address_country || 'Sweden',
      data.payment_terms || 30,
      data.discount_percentage || 0,
      data.currency || 'SEK',
      data.vat_number || null,
      data.notes || null,
      data.tags || null,
      data.category || null,
      userId
    ]
  );

  const supplier = result.rows[0];

  // Log action
  await auditService.logAction(userId, 'supplier.create', 'supplier', {
    companyId,
    entityId: supplier.id,
  });

  return supplier;
};

export const getSuppliers = async (
  companyId: string,
  filters?: SupplierFilters
): Promise<SupplierListResponse> => {
  let queryText = `
    SELECT * FROM suppliers
    WHERE company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.is_active !== undefined) {
    queryText += ` AND is_active = $${paramCount}`;
    params.push(filters.is_active);
    paramCount++;
  }

  if (filters?.search) {
    queryText += ` AND (
      name ILIKE $${paramCount} OR
      email ILIKE $${paramCount} OR
      org_number ILIKE $${paramCount}
    )`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  if (filters?.tags && filters.tags.length > 0) {
    queryText += ` AND tags && $${paramCount}`;
    params.push(filters.tags);
    paramCount++;
  }

  if (filters?.category) {
    queryText += ` AND category = $${paramCount}`;
    params.push(filters.category);
    paramCount++;
  }

  // Get total count
  const countResult = await query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);

  // Add ordering and pagination
  queryText += ` ORDER BY name ASC`;

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
  }

  const result = await query(queryText, params);

  return {
    suppliers: result.rows,
    total
  };
};

export const getSupplierById = async (
  supplierId: string,
  companyId: string
): Promise<Supplier | null> => {
  const result = await query(
    'SELECT * FROM suppliers WHERE id = $1 AND company_id = $2',
    [supplierId, companyId]
  );

  return result.rows[0] || null;
};

export const updateSupplier = async (
  supplierId: string,
  companyId: string,
  userId: string,
  updates: UpdateSupplierDto
): Promise<Supplier> => {
  // Get current supplier for audit
  const before = await getSupplierById(supplierId, companyId);

  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(supplierId, companyId);

  const result = await query(
    `UPDATE suppliers
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Supplier not found');
  }

  const supplier = result.rows[0];

  // Log action with changes
  await auditService.logAction(userId, 'supplier.update', 'supplier', {
    companyId,
    entityId: supplier.id,
    changes: {
      before,
      after: supplier
    }
  });

  return supplier;
};

export const deleteSupplier = async (
  supplierId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  await query(
    'UPDATE suppliers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND company_id = $2',
    [supplierId, companyId]
  );

  // Log action
  await auditService.logAction(userId, 'supplier.delete', 'supplier', {
    companyId,
    entityId: supplierId,
  });
};

// Supplier Contacts
export const addSupplierContact = async (
  data: CreateSupplierContactDto
): Promise<SupplierContact> => {
  const result = await query(
    `INSERT INTO supplier_contacts (supplier_id, name, title, email, phone, mobile, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.supplier_id,
      data.name,
      data.title || null,
      data.email || null,
      data.phone || null,
      data.mobile || null,
      data.is_primary || false
    ]
  );

  return result.rows[0];
};

export const getSupplierContacts = async (supplierId: string): Promise<SupplierContact[]> => {
  const result = await query(
    'SELECT * FROM supplier_contacts WHERE supplier_id = $1 ORDER BY is_primary DESC, name ASC',
    [supplierId]
  );

  return result.rows;
};

export const deleteSupplierContact = async (contactId: string): Promise<void> => {
  await query('DELETE FROM supplier_contacts WHERE id = $1', [contactId]);
};

// Supplier Notes
export const addSupplierNote = async (
  supplierId: string,
  userId: string,
  note: string
): Promise<SupplierNote> => {
  const result = await query(
    `INSERT INTO supplier_notes (supplier_id, user_id, note)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [supplierId, userId, note]
  );

  return result.rows[0];
};

export const getSupplierNotes = async (supplierId: string): Promise<SupplierNote[]> => {
  const result = await query(
    `SELECT cn.*, u.name as user_name, u.email as user_email
     FROM supplier_notes cn
     LEFT JOIN users u ON cn.user_id = u.id
     WHERE cn.supplier_id = $1
     ORDER BY cn.created_at DESC`,
    [supplierId]
  );

  return result.rows;
};

export const deleteSupplierNote = async (noteId: string): Promise<void> => {
  await query('DELETE FROM supplier_notes WHERE id = $1', [noteId]);
};

// Statistics
export const getSupplierStats = async (companyId: string): Promise<any> => {
  const result = await query(
    `SELECT
      COUNT(*) as total_suppliers,
      COUNT(CASE WHEN is_active = true THEN 1 END) as active_suppliers,
      COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_suppliers,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30days
     FROM suppliers
     WHERE company_id = $1`,
    [companyId]
  );

  return result.rows[0];
};
