import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export interface Customer {
  id: string;
  company_id: string;
  name: string;
  org_number?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country: string;
  payment_terms: number;
  discount_percentage?: number;
  currency: string;
  vat_number?: string;
  notes?: string;
  tags?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerDto {
  company_id: string;
  name: string;
  org_number?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country?: string;
  payment_terms?: number;
  discount_percentage?: number;
  currency?: string;
  vat_number?: string;
  notes?: string;
  tags?: string[];
}

export const getCustomers = async (companyId: string, filters?: {
  search?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}) => {
  const params = new URLSearchParams({ company_id: companyId });
  
  if (filters?.search) params.append('search', filters.search);
  if (filters?.is_active !== undefined) params.append('is_active', filters.is_active.toString());
  if (filters?.limit) params.append('limit', filters.limit.toString());
  if (filters?.offset) params.append('offset', filters.offset.toString());
  
  const response = await axios.get(`${API_URL}/customers?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCustomerById = async (id: string, companyId: string) => {
  const response = await axios.get(`${API_URL}/customers/${id}?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createCustomer = async (data: CreateCustomerDto) => {
  const response = await axios.post(`${API_URL}/customers`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateCustomer = async (id: string, companyId: string, data: Partial<CreateCustomerDto>) => {
  const response = await axios.put(`${API_URL}/customers/${id}`, { company_id: companyId, ...data }, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const deleteCustomer = async (id: string, companyId: string) => {
  const response = await axios.delete(`${API_URL}/customers/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
  return response.data;
};
