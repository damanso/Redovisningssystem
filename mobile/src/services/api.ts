import axios, {AxiosInstance, AxiosRequestConfig, AxiosError} from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  ApiResponse,
  PaginatedResponse,
  User,
  Customer,
  Invoice,
  Receipt,
  DashboardStats,
  LoginForm,
  RegisterForm,
  CustomerForm,
  InvoiceForm,
} from '../types';

const API_URL = 'http://localhost:3000/api'; // Change this to your backend URL
const API_TIMEOUT = 30000;

class ApiService {
  private client: AxiosInstance;
  private token: string | null = null;
  private isOnline: boolean = true;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
    this.monitorNetworkStatus();
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      async config => {
        const token = await this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      error => {
        return Promise.reject(error);
      },
    );

    // Response interceptor
    this.client.interceptors.response.use(
      response => response.data,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Token expired or invalid
          await this.clearToken();
          // Redirect to login screen
        }
        return Promise.reject(this.handleError(error));
      },
    );
  }

  private async monitorNetworkStatus() {
    NetInfo.addEventListener(state => {
      this.isOnline = state.isConnected ?? false;
    });
  }

  private async getToken(): Promise<string | null> {
    if (!this.token) {
      this.token = await AsyncStorage.getItem('auth_token');
    }
    return this.token;
  }

  private async setToken(token: string): Promise<void> {
    this.token = token;
    await AsyncStorage.setItem('auth_token', token);
  }

  private async clearToken(): Promise<void> {
    this.token = null;
    await AsyncStorage.removeItem('auth_token');
  }

  private handleError(error: AxiosError): Error {
    if (!this.isOnline) {
      return new Error('No internet connection. Please check your network.');
    }

    if (error.response) {
      const message =
        (error.response.data as any)?.message ||
        error.response.statusText ||
        'An error occurred';
      return new Error(message);
    } else if (error.request) {
      return new Error('No response from server. Please try again.');
    } else {
      return new Error(error.message || 'An unexpected error occurred');
    }
  }

  // Authentication
  async login(data: LoginForm): Promise<ApiResponse<{user: User; token: string}>> {
    const response = await this.client.post('/auth/login', data);
    if (response.token) {
      await this.setToken(response.token);
    }
    return response;
  }

  async register(data: RegisterForm): Promise<ApiResponse<{user: User; token: string}>> {
    const response = await this.client.post('/auth/register', data);
    if (response.token) {
      await this.setToken(response.token);
    }
    return response;
  }

  async logout(): Promise<void> {
    await this.clearToken();
  }

  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.client.get('/auth/me');
  }

  // Customers
  async getCustomers(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<ApiResponse<PaginatedResponse<Customer>>> {
    return this.client.get('/customers', {
      params: {page, pageSize},
    });
  }

  async getCustomer(id: string): Promise<ApiResponse<Customer>> {
    return this.client.get(`/customers/${id}`);
  }

  async createCustomer(data: CustomerForm): Promise<ApiResponse<Customer>> {
    return this.client.post('/customers', data);
  }

  async updateCustomer(id: string, data: Partial<CustomerForm>): Promise<ApiResponse<Customer>> {
    return this.client.put(`/customers/${id}`, data);
  }

  async deleteCustomer(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`/customers/${id}`);
  }

  async searchCustomers(query: string): Promise<ApiResponse<Customer[]>> {
    return this.client.get('/customers/search', {
      params: {q: query},
    });
  }

  // Invoices
  async getInvoices(
    page: number = 1,
    pageSize: number = 20,
    status?: string,
  ): Promise<ApiResponse<PaginatedResponse<Invoice>>> {
    return this.client.get('/invoices', {
      params: {page, pageSize, status},
    });
  }

  async getInvoice(id: string): Promise<ApiResponse<Invoice>> {
    return this.client.get(`/invoices/${id}`);
  }

  async createInvoice(data: InvoiceForm): Promise<ApiResponse<Invoice>> {
    return this.client.post('/invoices', data);
  }

  async updateInvoice(id: string, data: Partial<InvoiceForm>): Promise<ApiResponse<Invoice>> {
    return this.client.put(`/invoices/${id}`, data);
  }

  async deleteInvoice(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`/invoices/${id}`);
  }

  async sendInvoice(id: string): Promise<ApiResponse<Invoice>> {
    return this.client.post(`/invoices/${id}/send`);
  }

  async markInvoiceAsPaid(id: string): Promise<ApiResponse<Invoice>> {
    return this.client.post(`/invoices/${id}/paid`);
  }

  async generateInvoicePDF(id: string): Promise<Blob> {
    const response = await this.client.get(`/invoices/${id}/pdf`, {
      responseType: 'blob',
    });
    return response;
  }

  // Receipts
  async getReceipts(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<ApiResponse<PaginatedResponse<Receipt>>> {
    return this.client.get('/receipts', {
      params: {page, pageSize},
    });
  }

  async getReceipt(id: string): Promise<ApiResponse<Receipt>> {
    return this.client.get(`/receipts/${id}`);
  }

  async uploadReceipt(formData: FormData): Promise<ApiResponse<Receipt>> {
    return this.client.post('/receipts', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async updateReceipt(id: string, data: Partial<Receipt>): Promise<ApiResponse<Receipt>> {
    return this.client.put(`/receipts/${id}`, data);
  }

  async deleteReceipt(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`/receipts/${id}`);
  }

  async processReceiptOCR(id: string): Promise<ApiResponse<Receipt>> {
    return this.client.post(`/receipts/${id}/ocr`);
  }

  // Dashboard
  async getDashboardStats(): Promise<ApiResponse<DashboardStats>> {
    return this.client.get('/dashboard/stats');
  }

  // Network status
  getNetworkStatus(): boolean {
    return this.isOnline;
  }
}

export default new ApiService();
