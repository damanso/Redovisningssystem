import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

// ==================== TYPES ====================

export interface Project {
  id: string;
  company_id: string;
  customer_id?: string;
  customer_name?: string;
  name: string;
  description?: string;
  project_number?: string;
  status: 'active' | 'inactive' | 'completed' | 'cancelled';
  start_date?: string;
  end_date?: string;
  estimated_hours?: number;
  budget_amount?: number;
  hourly_rate?: number;
  fixed_price: boolean;
  is_billable: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectDto {
  company_id: string;
  customer_id?: string;
  name: string;
  description?: string;
  project_number?: string;
  status?: 'active' | 'inactive' | 'completed' | 'cancelled';
  start_date?: string;
  end_date?: string;
  estimated_hours?: number;
  budget_amount?: number;
  hourly_rate?: number;
  fixed_price?: boolean;
  is_billable?: boolean;
}

export interface TimeEntry {
  id: string;
  project_id: string;
  project_name?: string;
  user_id: string;
  user_email?: string;
  company_id: string;
  description?: string;
  entry_date: string;
  hours: number;
  hourly_rate?: number;
  is_billable: boolean;
  is_invoiced: boolean;
  invoice_id?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTimeEntryDto {
  company_id: string;
  project_id: string;
  description?: string;
  entry_date: string;
  hours: number;
  hourly_rate?: number;
  is_billable?: boolean;
  notes?: string;
}

export interface ProjectSummary {
  total_hours: number;
  billable_hours: number;
  total_revenue: number;
  invoiced_amount: number;
  uninvoiced_amount: number;
}

// ==================== PROJECT API CALLS ====================

export const getProjects = async (companyId: string, filters?: {
  search?: string;
  status?: string;
  customer_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}) => {
  const params = new URLSearchParams({ company_id: companyId });

  if (filters?.search) params.append('search', filters.search);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.customer_id) params.append('customer_id', filters.customer_id);
  if (filters?.is_active !== undefined) params.append('is_active', filters.is_active.toString());
  if (filters?.limit) params.append('limit', filters.limit.toString());
  if (filters?.offset) params.append('offset', filters.offset.toString());

  const response = await axios.get(`${API_URL}/projects?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getProjectById = async (id: string, companyId: string) => {
  const response = await axios.get(`${API_URL}/projects/${id}?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createProject = async (data: CreateProjectDto) => {
  const response = await axios.post(`${API_URL}/projects`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateProject = async (id: string, companyId: string, data: Partial<CreateProjectDto>) => {
  const response = await axios.put(`${API_URL}/projects/${id}`, { company_id: companyId, ...data }, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const deleteProject = async (id: string, companyId: string) => {
  const response = await axios.delete(`${API_URL}/projects/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
  return response.data;
};

export const deactivateProject = async (id: string, companyId: string) => {
  const response = await axios.post(`${API_URL}/projects/${id}/deactivate`,
    { company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getProjectSummary = async (id: string, companyId: string): Promise<ProjectSummary> => {
  const response = await axios.get(`${API_URL}/projects/${id}/summary?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

// ==================== TIME ENTRY API CALLS ====================

export const getTimeEntries = async (companyId: string, filters?: {
  project_id?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
  is_billable?: boolean;
  is_invoiced?: boolean;
  limit?: number;
  offset?: number;
}) => {
  const params = new URLSearchParams({ company_id: companyId });

  if (filters?.project_id) params.append('project_id', filters.project_id);
  if (filters?.user_id) params.append('user_id', filters.user_id);
  if (filters?.start_date) params.append('start_date', filters.start_date);
  if (filters?.end_date) params.append('end_date', filters.end_date);
  if (filters?.is_billable !== undefined) params.append('is_billable', filters.is_billable.toString());
  if (filters?.is_invoiced !== undefined) params.append('is_invoiced', filters.is_invoiced.toString());
  if (filters?.limit) params.append('limit', filters.limit.toString());
  if (filters?.offset) params.append('offset', filters.offset.toString());

  const response = await axios.get(`${API_URL}/projects/time-entries?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getTimeEntryById = async (id: string, companyId: string) => {
  const response = await axios.get(`${API_URL}/projects/time-entries/${id}?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createTimeEntry = async (data: CreateTimeEntryDto) => {
  const response = await axios.post(`${API_URL}/projects/time-entries`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateTimeEntry = async (id: string, companyId: string, data: Partial<CreateTimeEntryDto>) => {
  const response = await axios.put(`${API_URL}/projects/time-entries/${id}`, { company_id: companyId, ...data }, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const deleteTimeEntry = async (id: string, companyId: string) => {
  const response = await axios.delete(`${API_URL}/projects/time-entries/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
  return response.data;
};

export const markTimeEntriesAsInvoiced = async (
  companyId: string,
  timeEntryIds: string[],
  invoiceId: string
) => {
  const response = await axios.post(
    `${API_URL}/projects/time-entries/mark-invoiced`,
    {
      company_id: companyId,
      time_entry_ids: timeEntryIds,
      invoice_id: invoiceId
    },
    { headers: getAuthHeader() }
  );
  return response.data;
};
