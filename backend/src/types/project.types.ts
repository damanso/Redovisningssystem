export interface Project {
  id: string;
  company_id: string;
  customer_id?: string;
  name: string;
  description?: string;
  project_number?: string;
  status: 'active' | 'inactive' | 'completed' | 'cancelled';
  start_date?: Date;
  end_date?: Date;
  estimated_hours?: number;
  budget_amount?: number;
  hourly_rate?: number;
  fixed_price: boolean;
  is_billable: boolean;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectDto {
  customer_id?: string;
  name: string;
  description?: string;
  project_number?: string;
  status?: 'active' | 'inactive' | 'completed' | 'cancelled';
  start_date?: Date | string;
  end_date?: Date | string;
  estimated_hours?: number;
  budget_amount?: number;
  hourly_rate?: number;
  fixed_price?: boolean;
  is_billable?: boolean;
}

export interface UpdateProjectDto extends Partial<CreateProjectDto> {}

export interface TimeEntry {
  id: string;
  project_id: string;
  user_id: string;
  company_id: string;
  description?: string;
  entry_date: Date;
  hours: number;
  hourly_rate?: number;
  is_billable: boolean;
  is_invoiced: boolean;
  invoice_id?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTimeEntryDto {
  project_id: string;
  description?: string;
  entry_date: Date | string;
  hours: number;
  hourly_rate?: number;
  is_billable?: boolean;
  notes?: string;
}

export interface UpdateTimeEntryDto extends Partial<CreateTimeEntryDto> {}

export interface ProjectInvoice {
  id: string;
  project_id: string;
  invoice_id: string;
  total_hours?: number;
  total_amount?: number;
  invoice_date: Date;
  created_by: string;
  created_at: Date;
}

export interface CreateProjectInvoiceDto {
  project_id: string;
  invoice_id: string;
  total_hours?: number;
  total_amount?: number;
  invoice_date: Date | string;
}

export interface ProjectFilters {
  search?: string;
  status?: string;
  customer_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface TimeEntryFilters {
  project_id?: string;
  user_id?: string;
  start_date?: Date | string;
  end_date?: Date | string;
  is_billable?: boolean;
  is_invoiced?: boolean;
  limit?: number;
  offset?: number;
}
