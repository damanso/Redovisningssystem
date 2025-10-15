import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const getCurrentUser = async () => {
  const response = await axios.get(`${API_URL}/users/me`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateCurrentUser = async (data: {
  name?: string;
  phone?: string;
  avatar_url?: string;
}) => {
  const response = await axios.put(`${API_URL}/users/me`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const changePassword = async (data: {
  current_password: string;
  new_password: string;
}) => {
  const response = await axios.post(`${API_URL}/users/me/change-password`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getAllUsers = async (companyId?: string) => {
  const params = companyId ? { companyId } : {};
  const response = await axios.get(`${API_URL}/users`, {
    headers: getAuthHeader(),
    params
  });
  return response.data;
};

export const getUserById = async (userId: string) => {
  const response = await axios.get(`${API_URL}/users/${userId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};
