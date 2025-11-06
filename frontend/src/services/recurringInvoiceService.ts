import axios from 'axios';
import type {
  RecurringInvoice,
  RecurringInvoiceHistory,
  RecurringInvoiceStats,
  CreateRecurringInvoiceDto,
  UpdateRecurringInvoiceDto,
  RecurringStatus
} from '../types/recurringInvoice.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const getRecurringInvoices = async (filters?: {
  customer_id?: string;
  status?: RecurringStatus;
  search?: string;
  limit?: number;
  offset?: number;
}) => {
  const params = new URLSearchParams();

  if (filters?.customer_id) params.append('customer_id', filters.customer_id);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.search) params.append('search', filters.search);
  if (filters?.limit) params.append('limit', filters.limit.toString());
  if (filters?.offset) params.append('offset', filters.offset.toString());

  const response = await axios.get(
    `${API_URL}/recurring-invoices?${params.toString()}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getRecurringInvoiceById = async (id: string) => {
  const response = await axios.get(
    `${API_URL}/recurring-invoices/${id}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const createRecurringInvoice = async (data: CreateRecurringInvoiceDto) => {
  const response = await axios.post(
    `${API_URL}/recurring-invoices`,
    data,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const updateRecurringInvoice = async (id: string, data: UpdateRecurringInvoiceDto) => {
  const response = await axios.put(
    `${API_URL}/recurring-invoices/${id}`,
    data,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const deleteRecurringInvoice = async (id: string) => {
  const response = await axios.delete(
    `${API_URL}/recurring-invoices/${id}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const generateInvoice = async (id: string, data?: { generation_date?: string }) => {
  const response = await axios.post(
    `${API_URL}/recurring-invoices/${id}/generate`,
    data || {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const pauseRecurringInvoice = async (id: string) => {
  const response = await axios.post(
    `${API_URL}/recurring-invoices/${id}/pause`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const resumeRecurringInvoice = async (id: string) => {
  const response = await axios.post(
    `${API_URL}/recurring-invoices/${id}/resume`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const cancelRecurringInvoice = async (id: string) => {
  const response = await axios.post(
    `${API_URL}/recurring-invoices/${id}/cancel`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getRecurringInvoiceHistory = async (id: string): Promise<RecurringInvoiceHistory[]> => {
  const response = await axios.get(
    `${API_URL}/recurring-invoices/${id}/history`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getRecurringInvoiceStats = async (): Promise<RecurringInvoiceStats> => {
  const response = await axios.get(
    `${API_URL}/recurring-invoices/stats`,
    { headers: getAuthHeader() }
  );
  return response.data;
};
