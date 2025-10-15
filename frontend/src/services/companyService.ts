import axios from 'axios';
import { Company, CreateCompanyDto, UpdateCompanyDto } from '../types/company.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const createCompany = async (data: CreateCompanyDto): Promise<Company> => {
  const response = await axios.post(`${API_URL}/companies`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getUserCompanies = async (): Promise<Company[]> => {
  const response = await axios.get(`${API_URL}/companies`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const getCompanyById = async (companyId: string): Promise<Company> => {
  const response = await axios.get(`${API_URL}/companies/${companyId}`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const updateCompany = async (
  companyId: string,
  data: UpdateCompanyDto
): Promise<Company> => {
  const response = await axios.put(`${API_URL}/companies/${companyId}`, data, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const deactivateCompany = async (companyId: string): Promise<void> => {
  await axios.delete(`${API_URL}/companies/${companyId}`, {
    headers: getAuthHeader(),
  });
};

export const getCompanyUsers = async (companyId: string) => {
  const response = await axios.get(`${API_URL}/companies/${companyId}/users`, {
    headers: getAuthHeader(),
  });
  return response.data;
};

export const addUserToCompany = async (
  companyId: string,
  userId: string,
  role: string
) => {
  const response = await axios.post(
    `${API_URL}/companies/${companyId}/users`,
    { user_id: userId, role },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const removeUserFromCompany = async (
  companyId: string,
  userId: string
): Promise<void> => {
  await axios.delete(`${API_URL}/companies/${companyId}/users/${userId}`, {
    headers: getAuthHeader(),
  });
};

export const updateUserRole = async (
  companyId: string,
  userId: string,
  role: string
) => {
  const response = await axios.put(
    `${API_URL}/companies/${companyId}/users/${userId}/role`,
    { role },
    { headers: getAuthHeader() }
  );
  return response.data;
};
