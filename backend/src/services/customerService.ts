import { query } from '../config/database';
import { 
  Customer, 
  CreateCustomerDto, 
  UpdateCustomerDto,
  CustomerContact,
  CustomerNote 
} from '../types/customer.types';

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
  
  return result.rows[0];
};

export const getCustomers = async (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ customers: Customer[]; total: number }> => {
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
  
  const countResult = await query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);
  
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
  updates: UpdateCustomerDto
): Promise<Customer> => {
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
  
  const fieldsString = fields.join(', ');
  const result = await query(
    `UPDATE customers 
     SET ${fieldsString}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );
  
  if (result.rows.length === 0) {
    throw new Error('Customer not found');
  }
  
  return result.rows[0];
};

export const deleteCustomer = async (
  customerId: string,
  companyId: string
): Promise<void> => {
  await query(
    'UPDATE customers SET is_active = false WHERE id = $1 AND company_id = $2',
    [customerId, companyId]
  );
};

export const addCustomerContact = async (data: {
  customer_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary?: boolean;
}): Promise<CustomerContact> => {
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
    `SELECT cn.*, u.name as user_name
     FROM customer_notes cn
     LEFT JOIN users u ON cn.user_id = u.id
     WHERE cn.customer_id = $1
     ORDER BY cn.created_at DESC`,
    [customerId]
  );
  
  return result.rows;
};
