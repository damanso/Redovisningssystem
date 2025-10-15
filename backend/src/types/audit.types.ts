export interface AuditLog {
  id: string;
  user_id: string;
  company_id?: string;
  action: AuditAction;
  entity_type: EntityType;
  entity_id?: string;
  changes?: any; // JSON object with before/after values
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failure';
  error_message?: string;
  created_at: Date;
}

export type AuditAction =
  // Auth actions
  | 'auth.login'
  | 'auth.logout'
  | 'auth.register'
  | 'auth.password_change'
  | 'auth.password_reset'
  | 'auth.2fa_enable'
  | 'auth.2fa_disable'
  // User actions
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.activate'
  | 'user.deactivate'
  // Company actions
  | 'company.create'
  | 'company.update'
  | 'company.delete'
  | 'company.activate'
  | 'company.deactivate'
  | 'company.user_add'
  | 'company.user_remove'
  | 'company.user_role_update'
  // Invoice actions
  | 'invoice.create'
  | 'invoice.update'
  | 'invoice.delete'
  | 'invoice.send'
  | 'invoice.mark_paid'
  | 'invoice.mark_unpaid'
  // Customer actions
  | 'customer.create'
  | 'customer.update'
  | 'customer.delete'
  // Receipt actions
  | 'receipt.create'
  | 'receipt.update'
  | 'receipt.delete'
  | 'receipt.approve'
  | 'receipt.reject'
  // Transaction actions
  | 'transaction.create'
  | 'transaction.update'
  | 'transaction.delete'
  // Settings actions
  | 'settings.update'
  // Data export
  | 'export.data'
  | 'export.report';

export type EntityType =
  | 'user'
  | 'company'
  | 'invoice'
  | 'customer'
  | 'receipt'
  | 'transaction'
  | 'settings'
  | 'report';

export interface CreateAuditLogDto {
  user_id: string;
  company_id?: string;
  action: AuditAction;
  entity_type: EntityType;
  entity_id?: string;
  changes?: any;
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failure';
  error_message?: string;
}

export interface AuditLogFilter {
  user_id?: string;
  company_id?: string;
  action?: AuditAction;
  entity_type?: EntityType;
  entity_id?: string;
  status?: 'success' | 'failure';
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}
