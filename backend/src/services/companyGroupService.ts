/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Service
 */

import pool from '../config/database';
import {
  CompanyGroup,
  CompanyGroupWithCompanies,
  CreateCompanyGroupDto,
  UpdateCompanyGroupDto,
  CompanyGroupMember
} from '../types/companyGroup.types';

/**
 * Create a new company group
 */
export const createCompanyGroup = async (
  userId: string,
  data: CreateCompanyGroupDto
): Promise<CompanyGroup> => {
  const query = `
    INSERT INTO company_groups (name, description, color, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;

  const values = [data.name, data.description || null, data.color || null, userId];

  const result = await pool.query(query, values);
  return result.rows[0];
};

/**
 * Get all company groups created by or accessible to a user
 */
export const getCompanyGroupsByUser = async (
  userId: string
): Promise<CompanyGroupWithCompanies[]> => {
  const query = `
    SELECT
      cg.id,
      cg.name,
      cg.description,
      cg.color,
      cg.created_by,
      cg.created_at,
      cg.updated_at,
      COALESCE(COUNT(cgm.company_id), 0)::int as company_count,
      COALESCE(
        json_agg(
          json_build_object(
            'company_id', cgm.company_id,
            'company_name', c.name,
            'added_at', cgm.added_at
          ) ORDER BY c.name
        ) FILTER (WHERE cgm.company_id IS NOT NULL),
        '[]'::json
      ) as companies
    FROM company_groups cg
    LEFT JOIN company_group_members cgm ON cg.id = cgm.group_id
    LEFT JOIN companies c ON cgm.company_id = c.id
    LEFT JOIN user_companies uc ON c.id = uc.company_id
    WHERE cg.created_by = $1 OR uc.user_id = $1
    GROUP BY cg.id
    ORDER BY cg.name
  `;

  const result = await pool.query(query, [userId]);
  return result.rows;
};

/**
 * Get a specific company group by ID
 */
export const getCompanyGroupById = async (
  groupId: string,
  userId: string
): Promise<CompanyGroupWithCompanies | null> => {
  const query = `
    SELECT
      cg.id,
      cg.name,
      cg.description,
      cg.color,
      cg.created_by,
      cg.created_at,
      cg.updated_at,
      COALESCE(COUNT(cgm.company_id), 0)::int as company_count,
      COALESCE(
        json_agg(
          json_build_object(
            'company_id', cgm.company_id,
            'company_name', c.name,
            'added_at', cgm.added_at
          ) ORDER BY c.name
        ) FILTER (WHERE cgm.company_id IS NOT NULL),
        '[]'::json
      ) as companies
    FROM company_groups cg
    LEFT JOIN company_group_members cgm ON cg.id = cgm.group_id
    LEFT JOIN companies c ON cgm.company_id = c.id
    WHERE cg.id = $1 AND cg.created_by = $2
    GROUP BY cg.id
  `;

  const result = await pool.query(query, [groupId, userId]);
  return result.rows[0] || null;
};

/**
 * Update a company group
 */
export const updateCompanyGroup = async (
  groupId: string,
  userId: string,
  data: UpdateCompanyGroupDto
): Promise<CompanyGroup | null> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${paramCount++}`);
    values.push(data.name);
  }

  if (data.description !== undefined) {
    fields.push(`description = $${paramCount++}`);
    values.push(data.description);
  }

  if (data.color !== undefined) {
    fields.push(`color = $${paramCount++}`);
    values.push(data.color);
  }

  if (fields.length === 0) {
    return null;
  }

  values.push(groupId, userId);

  const query = `
    UPDATE company_groups
    SET ${fields.join(', ')}
    WHERE id = $${paramCount++} AND created_by = $${paramCount++}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
};

/**
 * Delete a company group
 */
export const deleteCompanyGroup = async (
  groupId: string,
  userId: string
): Promise<boolean> => {
  const query = `
    DELETE FROM company_groups
    WHERE id = $1 AND created_by = $2
    RETURNING id
  `;

  const result = await pool.query(query, [groupId, userId]);
  return result.rows.length > 0;
};

/**
 * Add a company to a group
 */
export const addCompanyToGroup = async (
  groupId: string,
  companyId: string,
  userId: string
): Promise<CompanyGroupMember> => {
  // First verify that user owns the group
  const groupCheck = await pool.query(
    'SELECT id FROM company_groups WHERE id = $1 AND created_by = $2',
    [groupId, userId]
  );

  if (groupCheck.rows.length === 0) {
    throw new Error('Group not found or access denied');
  }

  // Verify user has access to the company
  const companyCheck = await pool.query(
    'SELECT company_id FROM user_companies WHERE company_id = $1 AND user_id = $2',
    [companyId, userId]
  );

  if (companyCheck.rows.length === 0) {
    throw new Error('Company not found or access denied');
  }

  // Add company to group
  const query = `
    INSERT INTO company_group_members (group_id, company_id, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (group_id, company_id) DO NOTHING
    RETURNING *
  `;

  const result = await pool.query(query, [groupId, companyId, userId]);
  return result.rows[0];
};

/**
 * Remove a company from a group
 */
export const removeCompanyFromGroup = async (
  groupId: string,
  companyId: string,
  userId: string
): Promise<boolean> => {
  // Verify that user owns the group
  const groupCheck = await pool.query(
    'SELECT id FROM company_groups WHERE id = $1 AND created_by = $2',
    [groupId, userId]
  );

  if (groupCheck.rows.length === 0) {
    throw new Error('Group not found or access denied');
  }

  const query = `
    DELETE FROM company_group_members
    WHERE group_id = $1 AND company_id = $2
    RETURNING *
  `;

  const result = await pool.query(query, [groupId, companyId]);
  return result.rows.length > 0;
};

/**
 * Get all companies in a group
 */
export const getCompaniesInGroup = async (
  groupId: string,
  userId: string
): Promise<any[]> => {
  const query = `
    SELECT
      c.*,
      cgm.added_at,
      uc.role as user_role
    FROM company_group_members cgm
    JOIN companies c ON cgm.company_id = c.id
    JOIN user_companies uc ON c.id = uc.company_id
    JOIN company_groups cg ON cgm.group_id = cg.id
    WHERE cgm.group_id = $1
      AND (cg.created_by = $2 OR uc.user_id = $2)
    ORDER BY c.name
  `;

  const result = await pool.query(query, [groupId, userId]);
  return result.rows;
};
