import { query } from '../config/database.js';
import { Company, CreateCompanyDto, UpdateCompanyDto, UserCompany, AddUserToCompanyDto } from '../types/company.types.js';

export const createCompany = async (data: CreateCompanyDto, creatorUserId: string): Promise<Company> => {
  // Start transaction
  const client = await query('BEGIN', []);

  try {
    // Insert company
    const companyResult = await query(
      `INSERT INTO companies (
        name, org_number, address, postal_code, city, country,
        phone, email, website, vat_number, fiscal_year_start,
        accounting_method, currency
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        data.name,
        data.org_number,
        data.address || null,
        data.postal_code || null,
        data.city || null,
        data.country || 'Sweden',
        data.phone || null,
        data.email || null,
        data.website || null,
        data.vat_number || null,
        data.fiscal_year_start || '01-01',
        data.accounting_method || 'accrual',
        data.currency || 'SEK',
      ]
    );

    const company = companyResult.rows[0];

    // Add creator as owner
    await query(
      `INSERT INTO user_companies (user_id, company_id, role)
       VALUES ($1, $2, $3)`,
      [creatorUserId, company.id, 'owner']
    );

    await query('COMMIT', []);
    return company;
  } catch (error) {
    await query('ROLLBACK', []);
    throw error;
  }
};

export const getCompanyById = async (companyId: string): Promise<Company | null> => {
  const result = await query(
    `SELECT * FROM companies WHERE id = $1`,
    [companyId]
  );

  return result.rows[0] || null;
};

export const getCompaniesByUserId = async (userId: string): Promise<Company[]> => {
  const result = await query(
    `SELECT c.*, uc.role as user_role
     FROM companies c
     INNER JOIN user_companies uc ON c.id = uc.company_id
     WHERE uc.user_id = $1 AND c.is_active = true
     ORDER BY c.name ASC`,
    [userId]
  );

  return result.rows;
};

export const updateCompany = async (
  companyId: string,
  updates: UpdateCompanyDto
): Promise<Company> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  const allowedFields = [
    'name', 'address', 'postal_code', 'city', 'country',
    'phone', 'email', 'website', 'vat_number', 'fiscal_year_start',
    'accounting_method', 'currency', 'logo_url'
  ];

  for (const field of allowedFields) {
    if (updates[field as keyof UpdateCompanyDto] !== undefined) {
      fields.push(`${field} = $${paramCount}`);
      values.push(updates[field as keyof UpdateCompanyDto]);
      paramCount++;
    }
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(companyId);

  const result = await query(
    `UPDATE companies
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Company not found');
  }

  return result.rows[0];
};

export const deactivateCompany = async (companyId: string): Promise<void> => {
  await query(
    'UPDATE companies SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [companyId]
  );
};

export const activateCompany = async (companyId: string): Promise<void> => {
  await query(
    'UPDATE companies SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [companyId]
  );
};

export const deleteCompany = async (companyId: string): Promise<void> => {
  // Soft delete
  await deactivateCompany(companyId);
};

// User-Company relationship functions
export const addUserToCompany = async (
  companyId: string,
  data: AddUserToCompanyDto
): Promise<UserCompany> => {
  const result = await query(
    `INSERT INTO user_companies (user_id, company_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, company_id)
     DO UPDATE SET role = $3
     RETURNING *`,
    [data.user_id, companyId, data.role]
  );

  return result.rows[0];
};

export const removeUserFromCompany = async (
  companyId: string,
  userId: string
): Promise<void> => {
  await query(
    'DELETE FROM user_companies WHERE company_id = $1 AND user_id = $2',
    [companyId, userId]
  );
};

export const updateUserCompanyRole = async (
  companyId: string,
  userId: string,
  role: string
): Promise<UserCompany> => {
  const result = await query(
    `UPDATE user_companies
     SET role = $1
     WHERE company_id = $2 AND user_id = $3
     RETURNING *`,
    [role, companyId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User-Company relationship not found');
  }

  return result.rows[0];
};

export const getCompanyUsers = async (companyId: string): Promise<any[]> => {
  const result = await query(
    `SELECT u.id, u.email, u.name, u.phone, u.avatar_url, u.role as user_role,
            uc.role as company_role, uc.created_at as joined_at
     FROM users u
     INNER JOIN user_companies uc ON u.id = uc.user_id
     WHERE uc.company_id = $1
     ORDER BY uc.created_at ASC`,
    [companyId]
  );

  return result.rows;
};

export const getUserCompanyRole = async (
  userId: string,
  companyId: string
): Promise<string | null> => {
  const result = await query(
    'SELECT role FROM user_companies WHERE user_id = $1 AND company_id = $2',
    [userId, companyId]
  );

  return result.rows[0]?.role || null;
};
