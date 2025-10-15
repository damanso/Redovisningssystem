import { query } from '../config/database.js';
import {
  AuditLog,
  CreateAuditLogDto,
  AuditLogFilter,
  AuditAction,
  EntityType
} from '../types/audit.types.js';

export const createAuditLog = async (data: CreateAuditLogDto): Promise<AuditLog> => {
  try {
    const result = await query(
      `INSERT INTO audit_logs (
        user_id, company_id, action, entity_type, entity_id,
        changes, ip_address, user_agent, status, error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        data.user_id,
        data.company_id || null,
        data.action,
        data.entity_type,
        data.entity_id || null,
        data.changes ? JSON.stringify(data.changes) : null,
        data.ip_address || null,
        data.user_agent || null,
        data.status,
        data.error_message || null,
      ]
    );

    return result.rows[0];
  } catch (error) {
    // Don't throw error - audit logging should not break the main operation
    console.error('Audit log creation error:', error);
    throw error;
  }
};

export const logAction = async (
  userId: string,
  action: AuditAction,
  entityType: EntityType,
  options: {
    companyId?: string;
    entityId?: string;
    changes?: any;
    ipAddress?: string;
    userAgent?: string;
    status?: 'success' | 'failure';
    errorMessage?: string;
  } = {}
): Promise<void> => {
  try {
    await createAuditLog({
      user_id: userId,
      company_id: options.companyId,
      action,
      entity_type: entityType,
      entity_id: options.entityId,
      changes: options.changes,
      ip_address: options.ipAddress,
      user_agent: options.userAgent,
      status: options.status || 'success',
      error_message: options.errorMessage,
    });
  } catch (error) {
    console.error('Audit logging failed:', error);
    // Don't throw - logging failure should not break main operation
  }
};

export const getAuditLogs = async (filter: AuditLogFilter): Promise<AuditLog[]> => {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (filter.user_id) {
    conditions.push(`user_id = $${paramCount}`);
    values.push(filter.user_id);
    paramCount++;
  }

  if (filter.company_id) {
    conditions.push(`company_id = $${paramCount}`);
    values.push(filter.company_id);
    paramCount++;
  }

  if (filter.action) {
    conditions.push(`action = $${paramCount}`);
    values.push(filter.action);
    paramCount++;
  }

  if (filter.entity_type) {
    conditions.push(`entity_type = $${paramCount}`);
    values.push(filter.entity_type);
    paramCount++;
  }

  if (filter.entity_id) {
    conditions.push(`entity_id = $${paramCount}`);
    values.push(filter.entity_id);
    paramCount++;
  }

  if (filter.status) {
    conditions.push(`status = $${paramCount}`);
    values.push(filter.status);
    paramCount++;
  }

  if (filter.start_date) {
    conditions.push(`created_at >= $${paramCount}`);
    values.push(filter.start_date);
    paramCount++;
  }

  if (filter.end_date) {
    conditions.push(`created_at <= $${paramCount}`);
    values.push(filter.end_date);
    paramCount++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit || 100;
  const offset = filter.offset || 0;

  const result = await query(
    `SELECT al.*, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...values, limit, offset]
  );

  return result.rows;
};

export const getAuditLogById = async (logId: string): Promise<AuditLog | null> => {
  const result = await query(
    `SELECT al.*, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.id = $1`,
    [logId]
  );

  return result.rows[0] || null;
};

export const getEntityHistory = async (
  entityType: EntityType,
  entityId: string
): Promise<AuditLog[]> => {
  const result = await query(
    `SELECT al.*, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.entity_type = $1 AND al.entity_id = $2
     ORDER BY al.created_at DESC`,
    [entityType, entityId]
  );

  return result.rows;
};

export const getUserActivity = async (
  userId: string,
  limit: number = 50
): Promise<AuditLog[]> => {
  const result = await query(
    `SELECT al.*, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.user_id = $1
     ORDER BY al.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
};

export const getCompanyActivity = async (
  companyId: string,
  limit: number = 100
): Promise<AuditLog[]> => {
  const result = await query(
    `SELECT al.*, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.company_id = $1
     ORDER BY al.created_at DESC
     LIMIT $2`,
    [companyId, limit]
  );

  return result.rows;
};

export const getAuditStats = async (companyId?: string): Promise<any> => {
  const whereClause = companyId ? 'WHERE company_id = $1' : '';
  const params = companyId ? [companyId] : [];

  const result = await query(
    `SELECT
      COUNT(*) as total_logs,
      COUNT(DISTINCT user_id) as unique_users,
      COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_actions,
      COUNT(CASE WHEN status = 'failure' THEN 1 END) as failed_actions,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7days,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as last_30days
     FROM audit_logs
     ${whereClause}`,
    params
  );

  return result.rows[0];
};
