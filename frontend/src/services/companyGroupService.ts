/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Service (Frontend)
 */

import axios from 'axios';
import {
  CompanyGroup,
  CompanyGroupWithCompanies,
  CreateCompanyGroupDto,
  UpdateCompanyGroupDto,
  AddCompanyToGroupDto
} from '../types/companyGroup.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const createCompanyGroup = async (data: CreateCompanyGroupDto): Promise<CompanyGroup> => {
  const response = await axios.post(`${API_URL}/company-groups`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getCompanyGroups = async (): Promise<CompanyGroupWithCompanies[]> => {
  const response = await axios.get(`${API_URL}/company-groups`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getCompanyGroupById = async (groupId: string): Promise<CompanyGroupWithCompanies> => {
  const response = await axios.get(`${API_URL}/company-groups/${groupId}`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const updateCompanyGroup = async (
  groupId: string,
  data: UpdateCompanyGroupDto
): Promise<CompanyGroup> => {
  const response = await axios.put(`${API_URL}/company-groups/${groupId}`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const deleteCompanyGroup = async (groupId: string): Promise<void> => {
  await axios.delete(`${API_URL}/company-groups/${groupId}`, {
    headers: getAuthHeader(),
  });
};

export const addCompanyToGroup = async (
  groupId: string,
  companyId: string
): Promise<void> => {
  await axios.post(
    `${API_URL}/company-groups/${groupId}/companies`,
    { company_id: companyId },
    { headers: getAuthHeader() }
  );
};

export const removeCompanyFromGroup = async (
  groupId: string,
  companyId: string
): Promise<void> => {
  await axios.delete(`${API_URL}/company-groups/${groupId}/companies/${companyId}`, {
    headers: getAuthHeader(),
  });
};

export const getCompaniesInGroup = async (groupId: string): Promise<any[]> => {
  const response = await axios.get(`${API_URL}/company-groups/${groupId}/companies`, {
    headers: getAuthHeader(),
  });
  return response.data;
};
