/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Service (Frontend)
 */

import axios from 'axios';
import {
  ConsolidatedReportConfig,
  CreateConsolidatedReportConfigDto,
  UpdateConsolidatedReportConfigDto,
  ConsolidatedReportData
} from '../types/consolidatedReport.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const createReportConfig = async (
  data: CreateConsolidatedReportConfigDto
): Promise<ConsolidatedReportConfig> => {
  const response = await axios.post(`${API_URL}/consolidated-reports/configs`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getReportConfigs = async (): Promise<ConsolidatedReportConfig[]> => {
  const response = await axios.get(`${API_URL}/consolidated-reports/configs`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getReportConfigById = async (
  configId: string
): Promise<ConsolidatedReportConfig> => {
  const response = await axios.get(`${API_URL}/consolidated-reports/configs/${configId}`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const updateReportConfig = async (
  configId: string,
  data: UpdateConsolidatedReportConfigDto
): Promise<ConsolidatedReportConfig> => {
  const response = await axios.put(
    `${API_URL}/consolidated-reports/configs/${configId}`,
    data,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const deleteReportConfig = async (configId: string): Promise<void> => {
  await axios.delete(`${API_URL}/consolidated-reports/configs/${configId}`, {
    headers: getAuthHeader(),
  });
};

export const generateConsolidatedReport = async (data: {
  company_ids?: string[];
  group_ids?: string[];
  report_type: string;
  date_range_start?: string;
  date_range_end?: string;
  currency?: string;
}): Promise<ConsolidatedReportData> => {
  const response = await axios.post(`${API_URL}/consolidated-reports/generate`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getConsolidatedTransactionData = async (
  companyIds: string[],
  dateRange?: { date_range_start?: string; date_range_end?: string }
): Promise<any> => {
  const params = new URLSearchParams();
  params.append('company_ids', companyIds.join(','));
  if (dateRange?.date_range_start) params.append('date_range_start', dateRange.date_range_start);
  if (dateRange?.date_range_end) params.append('date_range_end', dateRange.date_range_end);

  const response = await axios.get(
    `${API_URL}/consolidated-reports/transactions?${params.toString()}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};
