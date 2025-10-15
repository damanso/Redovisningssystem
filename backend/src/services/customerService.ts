import { query } from '../config/database.js';
import {
  Customer,
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerContact,
  CustomerNote,
  CustomerFilters,
  CustomerListResponse,
  CreateCustomerContactDto,
  CreateCustomerNoteDto
} from '../types/customer.types.js';
import * as auditService from './auditService.js';

// Customer CRUD operations
export const createCustomer = async (
  companyId: string,
  userId: string,
  data: CreateCustomerDto
): Promise<Customer> => {
  const result = await query(
    `INSERT INTO customers (
      company_id, name, org_number, contact_person, email, phone, mobile,
      website, address_street, address_postal_code, address_city, address_country,
      payment_terms, discount_percentage, currency, vat_number, notes, tags, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      userId
    ]
  );

  const customer = result.rows[0];

  // Log action
  await auditService.logAction(userId, 'customer.create', 'customer', {
    companyId,
    entityId: customer.id,
  });

  return customer;
};

export const getCustomers = async (
  companyId: string,
  filters?: CustomerFilters
): Promise<CustomerListResponse> => {
  let queryText = `
    SELECT * FROM customers
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
    customers: result.rows,
    total
  };
};

export const getCustomerById = async (
  customerId: string,
  companyId: string
): Promise<Customer | null> => {
  const result = await query(
    'SELECT * FROM customers WHERE id = $1 AND company_id = $2',
    [customerId, companyId]
  );

  return result.rows[0] || null;
};

export const updateCustomer = async (
  customerId: string,
  companyId: string,
  userId: string,
  updates: UpdateCustomerDto
): Promise<Customer> => {
  // Get current customer for audit
  const before = await getCustomerById(customerId, companyId);

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

  values.push(customerId, companyId);

  const result = await query(
    `UPDATE customers
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Customer not found');
  }

  const customer = result.rows[0];

  // Log action with changes
  await auditService.logAction(userId, 'customer.update', 'customer', {
    companyId,
    entityId: customer.id,
    changes: {
      before,
      after: customer
    }
  });

  return customer;
};

export const deleteCustomer = async (
  customerId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  await query(
    'UPDATE customers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND company_id = $2',
    [customerId, companyId]
  );

  // Log action
  await auditService.logAction(userId, 'customer.delete', 'customer', {
    companyId,
    entityId: customerId,
  });
};

// Customer Contacts
export const addCustomerContact = async (
  data: CreateCustomerContactDto
): Promise<CustomerContact> => {
  const result = await query(
    `INSERT INTO customer_contacts (customer_id, name, title, email, phone, mobile, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.customer_id,
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

export const getCustomerContacts = async (customerId: string): Promise<CustomerContact[]> => {
  const result = await query(
    'SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_primary DESC, name ASC',
    [customerId]
  );

  return result.rows;
};

export const deleteCustomerContact = async (contactId: string): Promise<void> => {
  await query('DELETE FROM customer_contacts WHERE id = $1', [contactId]);
};

// Customer Notes
export const addCustomerNote = async (
  customerId: string,
  userId: string,
  note: string
): Promise<CustomerNote> => {
  const result = await query(
    `INSERT INTO customer_notes (customer_id, user_id, note)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [customerId, userId, note]
  );

  return result.rows[0];
};

export const getCustomerNotes = async (customerId: string): Promise<CustomerNote[]> => {
  const result = await query(
    `SELECT cn.*, u.name as user_name, u.email as user_email
     FROM customer_notes cn
     LEFT JOIN users u ON cn.user_id = u.id
     WHERE cn.customer_id = $1
     ORDER BY cn.created_at DESC`,
    [customerId]
  );

  return result.rows;
};

export const deleteCustomerNote = async (noteId: string): Promise<void> => {
  await query('DELETE FROM customer_notes WHERE id = $1', [noteId]);
};

// Statistics
export const getCustomerStats = async (companyId: string): Promise<any> => {
  const result = await query(
    `SELECT
      COUNT(*) as total_customers,
      COUNT(CASE WHEN is_active = true THEN 1 END) as active_customers,
      COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_customers,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30days
     FROM customers
     WHERE company_id = $1`,
    [companyId]
  );

  return result.rows[0];
};
