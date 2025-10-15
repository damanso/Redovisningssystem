import axios from 'axios';
import { LoginRequest, RegisterRequest, AuthResponse } from '../types/auth.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export const register = async (data: RegisterRequest): Promise<AuthResponse> => {
  const response = await axios.post(`${API_URL}/auth/register`, data);
  if (response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  return response.data;
};

export const login = async (data: LoginRequest): Promise<AuthResponse> => {
  const response = await axios.post(`${API_URL}/auth/login`, data);
  if (response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  return response.data;
};

export const logout = () => {
  localStorage.removeItem('token');
};

export const getToken = (): string | null => {
  return localStorage.getItem('token');
};

export const isAuthenticated = (): boolean => {
  return !!getToken();
};
