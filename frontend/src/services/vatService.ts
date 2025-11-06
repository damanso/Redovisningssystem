import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

// ============================================================================
// TYPES
// ============================================================================

export enum VATReportStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  SUBMITTED = 'submitted',
  REJECTED = 'rejected',
  ARCHIVED = 'archived',
}

export enum TaxPeriodType {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  ANNUAL = 'annual',
}

export enum TaxPeriodStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  SUBMITTED = 'submitted',
}

export enum SubmissionStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  FAILED = 'failed',
}

export interface TaxPeriod {
  id: string;
  company_id: string;
  period_type: TaxPeriodType;
  period_year: number;
  period_number: number;
  start_date: string;
  end_date: string;
  status: TaxPeriodStatus;
  due_date?: string;
  created_at: string;
  updated_at: string;
}

export interface VATReportLine {
  id: string;
  vat_report_id: string;
  transaction_type: 'invoice' | 'receipt' | 'journal_entry' | 'adjustment';
  transaction_id?: string;
  transaction_date: string;
  transaction_number?: string;
  account_number: string;
  account_name?: string;
  base_amount: number;
  vat_rate?: number;
  vat_amount: number;
  total_amount: number;
  vat_type: 'outgoing' | 'incoming';
  description?: string;
  created_at: string;
}

export interface VATReport {
  id: string;
  company_id: string;
  tax_period_id: string;
  report_number?: string;
  report_date: string;
  period_start: string;
  period_end: string;
  outgoing_vat_25: number;
  outgoing_vat_12: number;
  outgoing_vat_6: number;
  outgoing_vat_0: number;
  incoming_vat: number;
  total_outgoing_vat: number;
  net_vat_amount: number;
  status: VATReportStatus;
  approved_by?: string;
  approved_at?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  tax_period?: TaxPeriod;
  lines?: VATReportLine[];
  submissions?: SkatteverketSubmission[];
}

export interface SkatteverketSubmission {
  id: string;
  vat_report_id: string;
  company_id: string;
  submission_date: string;
  submission_method: 'api' | 'manual' | 'file_export';
  api_request_id?: string;
  api_response_status?: string;
  api_response_message?: string;
  api_response_data?: Record<string, any>;
  export_file_path?: string;
  export_format?: string;
  certificate_thumbprint?: string;
  status: SubmissionStatus;
  submitted_by?: string;
  created_at: string;
  updated_at: string;
}

export interface VATSummary {
  period_start: string;
  period_end: string;
  outgoing_vat_25: number;
  outgoing_vat_12: number;
  outgoing_vat_6: number;
  outgoing_vat_0: number;
  total_outgoing_vat: number;
  incoming_vat: number;
  net_vat_amount: number;
  transaction_count: number;
}

export interface CreateTaxPeriodDto {
  company_id: string;
  period_type: TaxPeriodType;
  period_year: number;
  period_number: number;
  start_date: string;
  end_date: string;
  due_date?: string;
}

export interface GenerateVATReportDto {
  company_id: string;
  period_start: string;
  period_end: string;
  tax_period_id?: string;
}

export interface UpdateVATReportDto {
  status?: VATReportStatus;
  notes?: string;
  approved_by?: string;
}

export interface SubmitVATReportDto {
  company_id: string;
  organization_number: string;
}

// ============================================================================
// TAX PERIOD API
// ============================================================================

export const getTaxPeriods = async (
  companyId: string,
  filters?: {
    period_type?: TaxPeriodType;
    period_year?: number;
    status?: TaxPeriodStatus;
  }
) => {
  const params = new URLSearchParams({ company_id: companyId });

  if (filters?.period_type) params.append('period_type', filters.period_type);
  if (filters?.period_year) params.append('period_year', filters.period_year.toString());
  if (filters?.status) params.append('status', filters.status);

  const response = await axios.get(`${API_URL}/vat/tax-periods?${params.toString()}`, {
    headers: getAuthHeader(),
  });
  return response.data as TaxPeriod[];
};

export const getTaxPeriodById = async (id: string, companyId: string) => {
  const response = await axios.get(
    `${API_URL}/vat/tax-periods/${id}?company_id=${companyId}`,
    {
      headers: getAuthHeader(),
    }
  );
  return response.data as TaxPeriod;
};

export const createTaxPeriod = async (data: CreateTaxPeriodDto) => {
  const response = await axios.post(`${API_URL}/vat/tax-periods`, data, {
    headers: getAuthHeader(),
  });
  return response.data as TaxPeriod;
};

export const updateTaxPeriod = async (
  id: string,
  companyId: string,
  data: { status?: TaxPeriodStatus; due_date?: string }
) => {
  const response = await axios.patch(
    `${API_URL}/vat/tax-periods/${id}?company_id=${companyId}`,
    data,
    {
      headers: getAuthHeader(),
    }
  );
  return response.data as TaxPeriod;
};

// ============================================================================
// VAT REPORT API
// ============================================================================

export const getVATReports = async (
  companyId: string,
  filters?: {
    tax_period_id?: string;
    status?: VATReportStatus;
    period_start?: string;
    period_end?: string;
  }
) => {
  const params = new URLSearchParams({ company_id: companyId });

  if (filters?.tax_period_id) params.append('tax_period_id', filters.tax_period_id);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.period_start) params.append('period_start', filters.period_start);
  if (filters?.period_end) params.append('period_end', filters.period_end);

  const response = await axios.get(`${API_URL}/vat/reports?${params.toString()}`, {
    headers: getAuthHeader(),
  });
  return response.data as VATReport[];
};

export const getVATReportById = async (id: string, companyId: string) => {
  const response = await axios.get(`${API_URL}/vat/reports/${id}?company_id=${companyId}`, {
    headers: getAuthHeader(),
  });
  return response.data as VATReport;
};

export const generateVATReport = async (data: GenerateVATReportDto) => {
  const response = await axios.post(`${API_URL}/vat/reports/generate`, data, {
    headers: getAuthHeader(),
  });
  return response.data as VATReport;
};

export const updateVATReport = async (
  id: string,
  companyId: string,
  data: UpdateVATReportDto
) => {
  const response = await axios.patch(
    `${API_URL}/vat/reports/${id}?company_id=${companyId}`,
    data,
    {
      headers: getAuthHeader(),
    }
  );
  return response.data as VATReport;
};

export const deleteVATReport = async (id: string, companyId: string) => {
  const response = await axios.delete(`${API_URL}/vat/reports/${id}?company_id=${companyId}`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

// ============================================================================
// VAT CALCULATION API
// ============================================================================

export const getVATSummary = async (
  companyId: string,
  periodStart: string,
  periodEnd: string
) => {
  const params = new URLSearchParams({
    company_id: companyId,
    period_start: periodStart,
    period_end: periodEnd,
  });

  const response = await axios.get(`${API_URL}/vat/summary?${params.toString()}`, {
    headers: getAuthHeader(),
  });
  return response.data as VATSummary;
};

// ============================================================================
// SKATTEVERKET SUBMISSION API
// ============================================================================

export const submitVATReportToSkatteverket = async (
  id: string,
  data: SubmitVATReportDto
) => {
  const response = await axios.post(`${API_URL}/vat/reports/${id}/submit`, data, {
    headers: getAuthHeader(),
  });
  return response.data as SkatteverketSubmission;
};

export const getSubmissionsByReport = async (reportId: string) => {
  const response = await axios.get(`${API_URL}/vat/reports/${reportId}/submissions`, {
    headers: getAuthHeader(),
  });
  return response.data as SkatteverketSubmission[];
};

export const exportVATReport = async (
  id: string,
  companyId: string,
  format: 'json' | 'xml' = 'json'
) => {
  const response = await axios.get(
    `${API_URL}/vat/reports/${id}/export?company_id=${companyId}&format=${format}`,
    {
      headers: getAuthHeader(),
      responseType: 'blob',
    }
  );

  // Create download link
  const blob = new Blob([response.data], {
    type: format === 'xml' ? 'application/xml' : 'application/json',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vat-report-${id}.${format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);

  return response.data;
};
