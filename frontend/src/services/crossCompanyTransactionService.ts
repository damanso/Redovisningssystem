/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transaction Service (Frontend)
 */

import axios from 'axios';
import {
  CrossCompanyTransaction,
  CrossCompanyTransactionWithDetails,
  CreateCrossCompanyTransactionDto,
  UpdateCrossCompanyTransactionDto,
  TransactionStatus,
  TransactionSummary
} from '../types/crossCompanyTransaction.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const createCrossCompanyTransaction = async (
  data: CreateCrossCompanyTransactionDto
): Promise<CrossCompanyTransaction> => {
  const response = await axios.post(`${API_URL}/cross-company-transactions`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getCrossCompanyTransactions = async (filters?: {
  company_id?: string;
  status?: TransactionStatus;
  from_date?: string;
  to_date?: string;
}): Promise<CrossCompanyTransactionWithDetails[]> => {
  const params = new URLSearchParams();
  if (filters?.company_id) params.append('company_id', filters.company_id);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.from_date) params.append('from_date', filters.from_date);
  if (filters?.to_date) params.append('to_date', filters.to_date);

  const response = await axios.get(`${API_URL}/cross-company-transactions?${params.toString()}`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getCrossCompanyTransactionById = async (
  transactionId: string
): Promise<CrossCompanyTransactionWithDetails> => {
  const response = await axios.get(`${API_URL}/cross-company-transactions/${transactionId}`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const updateCrossCompanyTransaction = async (
  transactionId: string,
  data: UpdateCrossCompanyTransactionDto
): Promise<CrossCompanyTransaction> => {
  const response = await axios.put(
    `${API_URL}/cross-company-transactions/${transactionId}`,
    data,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const reconcileTransaction = async (
  transactionId: string
): Promise<CrossCompanyTransaction> => {
  const response = await axios.post(
    `${API_URL}/cross-company-transactions/${transactionId}/reconcile`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const deleteCrossCompanyTransaction = async (transactionId: string): Promise<void> => {
  await axios.delete(`${API_URL}/cross-company-transactions/${transactionId}`, {
    headers: getAuthHeader(),
  });
};

export const getCompanyTransactionSummary = async (
  companyId: string,
  dateRange?: { from_date?: string; to_date?: string }
): Promise<TransactionSummary> => {
  const params = new URLSearchParams();
  if (dateRange?.from_date) params.append('from_date', dateRange.from_date);
  if (dateRange?.to_date) params.append('to_date', dateRange.to_date);

  const response = await axios.get(
    `${API_URL}/cross-company-transactions/summary/${companyId}?${params.toString()}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};
