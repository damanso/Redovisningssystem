import { query } from '../config/database';
import {
  Project,
  CreateProjectDto,
  UpdateProjectDto,
  TimeEntry,
  CreateTimeEntryDto,
  UpdateTimeEntryDto,
  ProjectInvoice,
  CreateProjectInvoiceDto,
  ProjectFilters,
  TimeEntryFilters
} from '../types/project.types';

// ==================== PROJECT OPERATIONS ====================

export const createProject = async (
  companyId: string,
  userId: string,
  data: CreateProjectDto
): Promise<Project> => {
  const result = await query(
    `INSERT INTO projects (
      company_id, customer_id, name, description, project_number, status,
      start_date, end_date, estimated_hours, budget_amount, hourly_rate,
      fixed_price, is_billable, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      companyId,
      data.customer_id || null,
      data.name,
      data.description || null,
      data.project_number || null,
      data.status || 'active',
      data.start_date || null,
      data.end_date || null,
      data.estimated_hours || null,
      data.budget_amount || null,
      data.hourly_rate || null,
      data.fixed_price !== undefined ? data.fixed_price : false,
      data.is_billable !== undefined ? data.is_billable : true,
      userId
    ]
  );

  return result.rows[0];
};

export const getProjects = async (
  companyId: string,
  filters?: ProjectFilters
): Promise<{ projects: Project[]; total: number }> => {
  let queryText = `
    SELECT p.*, c.name as customer_name
    FROM projects p
    LEFT JOIN customers c ON p.customer_id = c.id
    WHERE p.company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.is_active !== undefined) {
    queryText += ` AND p.is_active = $${paramCount}`;
    params.push(filters.is_active);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND p.status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  if (filters?.customer_id) {
    queryText += ` AND p.customer_id = $${paramCount}`;
    params.push(filters.customer_id);
    paramCount++;
  }

  if (filters?.search) {
    queryText += ` AND (
      p.name ILIKE $${paramCount} OR
      p.description ILIKE $${paramCount} OR
      p.project_number ILIKE $${paramCount}
    )`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  // Get total count
  const countQuery = queryText
    .replace(/SELECT p\.\*, c\.name as customer_name/, 'SELECT COUNT(*)')
    .replace(/LEFT JOIN customers c ON p\.customer_id = c\.id/, '');
  const countResult = await query(countQuery, params);
  const total = parseInt(countResult.rows[0].count);

  queryText += ` ORDER BY p.created_at DESC`;

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
    paramCount++;
  }

  const result = await query(queryText, params);

  return {
    projects: result.rows,
    total
  };
};

export const getProjectById = async (
  projectId: string,
  companyId: string
): Promise<Project | null> => {
  const result = await query(
    `SELECT p.*, c.name as customer_name
     FROM projects p
     LEFT JOIN customers c ON p.customer_id = c.id
     WHERE p.id = $1 AND p.company_id = $2`,
    [projectId, companyId]
  );

  return result.rows[0] || null;
};

export const updateProject = async (
  projectId: string,
  companyId: string,
  data: UpdateProjectDto
): Promise<Project | null> => {
  const fields: string[] = [];
  const params: any[] = [];
  let paramCount = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      params.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    return getProjectById(projectId, companyId);
  }

  params.push(projectId);
  params.push(companyId);

  const result = await query(
    `UPDATE projects
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    params
  );

  return result.rows[0] || null;
};

export const deleteProject = async (
  projectId: string,
  companyId: string
): Promise<boolean> => {
  const result = await query(
    'DELETE FROM projects WHERE id = $1 AND company_id = $2',
    [projectId, companyId]
  );

  return result.rowCount !== null && result.rowCount > 0;
};

// Soft delete (set is_active to false)
export const deactivateProject = async (
  projectId: string,
  companyId: string
): Promise<Project | null> => {
  const result = await query(
    `UPDATE projects
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [projectId, companyId]
  );

  return result.rows[0] || null;
};

// ==================== TIME ENTRY OPERATIONS ====================

export const createTimeEntry = async (
  companyId: string,
  userId: string,
  data: CreateTimeEntryDto
): Promise<TimeEntry> => {
  // Verify project exists and belongs to company
  const project = await getProjectById(data.project_id, companyId);
  if (!project) {
    throw new Error('Project not found or access denied');
  }

  // Use project's hourly rate if not specified
  const hourlyRate = data.hourly_rate !== undefined ? data.hourly_rate : project.hourly_rate;

  const result = await query(
    `INSERT INTO time_entries (
      project_id, user_id, company_id, description, entry_date, hours,
      hourly_rate, is_billable, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      data.project_id,
      userId,
      companyId,
      data.description || null,
      data.entry_date,
      data.hours,
      hourlyRate,
      data.is_billable !== undefined ? data.is_billable : true,
      data.notes || null
    ]
  );

  return result.rows[0];
};

export const getTimeEntries = async (
  companyId: string,
  filters?: TimeEntryFilters
): Promise<{ timeEntries: TimeEntry[]; total: number }> => {
  let queryText = `
    SELECT te.*, p.name as project_name, u.email as user_email
    FROM time_entries te
    LEFT JOIN projects p ON te.project_id = p.id
    LEFT JOIN users u ON te.user_id = u.id
    WHERE te.company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.project_id) {
    queryText += ` AND te.project_id = $${paramCount}`;
    params.push(filters.project_id);
    paramCount++;
  }

  if (filters?.user_id) {
    queryText += ` AND te.user_id = $${paramCount}`;
    params.push(filters.user_id);
    paramCount++;
  }

  if (filters?.is_billable !== undefined) {
    queryText += ` AND te.is_billable = $${paramCount}`;
    params.push(filters.is_billable);
    paramCount++;
  }

  if (filters?.is_invoiced !== undefined) {
    queryText += ` AND te.is_invoiced = $${paramCount}`;
    params.push(filters.is_invoiced);
    paramCount++;
  }

  if (filters?.start_date) {
    queryText += ` AND te.entry_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND te.entry_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  // Get total count
  const countQuery = queryText
    .replace(/SELECT te\.\*, p\.name as project_name, u\.email as user_email/, 'SELECT COUNT(*)')
    .replace(/LEFT JOIN projects p ON te\.project_id = p\.id/, '')
    .replace(/LEFT JOIN users u ON te\.user_id = u\.id/, '');
  const countResult = await query(countQuery, params);
  const total = parseInt(countResult.rows[0].count);

  queryText += ` ORDER BY te.entry_date DESC, te.created_at DESC`;

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
    paramCount++;
  }

  const result = await query(queryText, params);

  return {
    timeEntries: result.rows,
    total
  };
};

export const getTimeEntryById = async (
  entryId: string,
  companyId: string
): Promise<TimeEntry | null> => {
  const result = await query(
    `SELECT te.*, p.name as project_name, u.email as user_email
     FROM time_entries te
     LEFT JOIN projects p ON te.project_id = p.id
     LEFT JOIN users u ON te.user_id = u.id
     WHERE te.id = $1 AND te.company_id = $2`,
    [entryId, companyId]
  );

  return result.rows[0] || null;
};

export const updateTimeEntry = async (
  entryId: string,
  companyId: string,
  userId: string,
  data: UpdateTimeEntryDto
): Promise<TimeEntry | null> => {
  // Check if entry is already invoiced
  const existingEntry = await getTimeEntryById(entryId, companyId);
  if (!existingEntry) {
    return null;
  }

  if (existingEntry.is_invoiced) {
    throw new Error('Cannot update time entry that has been invoiced');
  }

  // Check if user owns this entry or has permission
  if (existingEntry.user_id !== userId) {
    throw new Error('Cannot update time entry created by another user');
  }

  const fields: string[] = [];
  const params: any[] = [];
  let paramCount = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      params.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    return existingEntry;
  }

  params.push(entryId);
  params.push(companyId);

  const result = await query(
    `UPDATE time_entries
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    params
  );

  return result.rows[0] || null;
};

export const deleteTimeEntry = async (
  entryId: string,
  companyId: string,
  userId: string
): Promise<boolean> => {
  // Check if entry is already invoiced
  const existingEntry = await getTimeEntryById(entryId, companyId);
  if (!existingEntry) {
    return false;
  }

  if (existingEntry.is_invoiced) {
    throw new Error('Cannot delete time entry that has been invoiced');
  }

  // Check if user owns this entry or has permission
  if (existingEntry.user_id !== userId) {
    throw new Error('Cannot delete time entry created by another user');
  }

  const result = await query(
    'DELETE FROM time_entries WHERE id = $1 AND company_id = $2',
    [entryId, companyId]
  );

  return result.rowCount !== null && result.rowCount > 0;
};

// ==================== PROJECT INVOICE OPERATIONS ====================

export const createProjectInvoice = async (
  companyId: string,
  userId: string,
  data: CreateProjectInvoiceDto
): Promise<ProjectInvoice> => {
  const result = await query(
    `INSERT INTO project_invoices (
      project_id, invoice_id, total_hours, total_amount, invoice_date, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      data.project_id,
      data.invoice_id,
      data.total_hours || null,
      data.total_amount || null,
      data.invoice_date,
      userId
    ]
  );

  return result.rows[0];
};

export const getProjectInvoices = async (
  projectId: string,
  companyId: string
): Promise<ProjectInvoice[]> => {
  // Verify project belongs to company
  const project = await getProjectById(projectId, companyId);
  if (!project) {
    throw new Error('Project not found or access denied');
  }

  const result = await query(
    `SELECT pi.*, i.invoice_number, i.total_amount as invoice_total
     FROM project_invoices pi
     LEFT JOIN invoices i ON pi.invoice_id = i.id
     WHERE pi.project_id = $1
     ORDER BY pi.invoice_date DESC`,
    [projectId]
  );

  return result.rows;
};

// Mark time entries as invoiced
export const markTimeEntriesAsInvoiced = async (
  timeEntryIds: string[],
  invoiceId: string,
  companyId: string
): Promise<void> => {
  if (timeEntryIds.length === 0) {
    return;
  }

  await query(
    `UPDATE time_entries
     SET is_invoiced = true, invoice_id = $1
     WHERE id = ANY($2) AND company_id = $3`,
    [invoiceId, timeEntryIds, companyId]
  );
};

// Get project summary (total hours, revenue, etc.)
export const getProjectSummary = async (
  projectId: string,
  companyId: string
): Promise<{
  total_hours: number;
  billable_hours: number;
  total_revenue: number;
  invoiced_amount: number;
  uninvoiced_amount: number;
}> => {
  const result = await query(
    `SELECT
      COALESCE(SUM(hours), 0) as total_hours,
      COALESCE(SUM(CASE WHEN is_billable THEN hours ELSE 0 END), 0) as billable_hours,
      COALESCE(SUM(CASE WHEN is_billable THEN hours * COALESCE(hourly_rate, 0) ELSE 0 END), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN is_invoiced AND is_billable THEN hours * COALESCE(hourly_rate, 0) ELSE 0 END), 0) as invoiced_amount,
      COALESCE(SUM(CASE WHEN NOT is_invoiced AND is_billable THEN hours * COALESCE(hourly_rate, 0) ELSE 0 END), 0) as uninvoiced_amount
     FROM time_entries
     WHERE project_id = $1 AND company_id = $2`,
    [projectId, companyId]
  );

  return result.rows[0];
};
