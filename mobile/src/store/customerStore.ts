import {create} from 'zustand';
import {Customer, CustomerForm} from '../types';
import apiService from '../services/api';
import storageService from '../services/storage';

interface CustomerState {
  customers: Customer[];
  selectedCustomer: Customer | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchCustomers: (forceRefresh?: boolean) => Promise<void>;
  fetchCustomer: (id: string) => Promise<void>;
  createCustomer: (data: CustomerForm) => Promise<void>;
  updateCustomer: (id: string, data: Partial<CustomerForm>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  searchCustomers: (query: string) => Promise<void>;
  clearError: () => void;
  clearSelectedCustomer: () => void;
}

export const useCustomerStore = create<CustomerState>((set, get) => ({
  customers: [],
  selectedCustomer: null,
  isLoading: false,
  error: null,

  fetchCustomers: async (forceRefresh = false) => {
    set({isLoading: true, error: null});
    try {
      // Try to get from cache first
      if (!forceRefresh) {
        const cachedCustomers = await storageService.getCustomers();
        if (cachedCustomers.length > 0) {
          set({customers: cachedCustomers, isLoading: false});
          return;
        }
      }

      // Fetch from API
      const response = await apiService.getCustomers();
      if (response.success && response.data) {
        const customers = response.data.data;
        set({customers, isLoading: false});
        await storageService.saveCustomers(customers);
      }
    } catch (error: any) {
      // Fall back to cached data on error
      const cachedCustomers = await storageService.getCustomers();
      set({
        customers: cachedCustomers,
        error: error.message || 'Failed to fetch customers',
        isLoading: false,
      });
    }
  },

  fetchCustomer: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      // Try cache first
      const cachedCustomer = await storageService.getCustomer(id);
      if (cachedCustomer) {
        set({selectedCustomer: cachedCustomer, isLoading: false});
        return;
      }

      // Fetch from API
      const response = await apiService.getCustomer(id);
      if (response.success) {
        set({selectedCustomer: response.data, isLoading: false});
        await storageService.saveCustomer(response.data);
      }
    } catch (error: any) {
      set({
        error: error.message || 'Failed to fetch customer',
        isLoading: false,
      });
    }
  },

  createCustomer: async (data: CustomerForm) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.createCustomer(data);
      if (response.success) {
        const newCustomer = response.data;
        set(state => ({
          customers: [...state.customers, newCustomer],
          isLoading: false,
        }));
        await storageService.saveCustomer(newCustomer);
      }
    } catch (error: any) {
      // Save to pending sync if offline
      if (!apiService.getNetworkStatus()) {
        const tempCustomer: Customer = {
          ...data,
          id: `temp_${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storageService.saveCustomer(tempCustomer);
        await storageService.addPendingSyncItem({
          id: tempCustomer.id,
          type: 'customer',
          action: 'create',
          data,
        });
        set(state => ({
          customers: [...state.customers, tempCustomer],
          isLoading: false,
        }));
      } else {
        set({
          error: error.message || 'Failed to create customer',
          isLoading: false,
        });
        throw error;
      }
    }
  },

  updateCustomer: async (id: string, data: Partial<CustomerForm>) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.updateCustomer(id, data);
      if (response.success) {
        const updatedCustomer = response.data;
        set(state => ({
          customers: state.customers.map(c => (c.id === id ? updatedCustomer : c)),
          selectedCustomer:
            state.selectedCustomer?.id === id ? updatedCustomer : state.selectedCustomer,
          isLoading: false,
        }));
        await storageService.saveCustomer(updatedCustomer);
      }
    } catch (error: any) {
      // Save to pending sync if offline
      if (!apiService.getNetworkStatus()) {
        await storageService.addPendingSyncItem({
          id,
          type: 'customer',
          action: 'update',
          data,
        });
        set({isLoading: false});
      } else {
        set({
          error: error.message || 'Failed to update customer',
          isLoading: false,
        });
        throw error;
      }
    }
  },

  deleteCustomer: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      await apiService.deleteCustomer(id);
      set(state => ({
        customers: state.customers.filter(c => c.id !== id),
        isLoading: false,
      }));
      await storageService.deleteCustomer(id);
    } catch (error: any) {
      set({
        error: error.message || 'Failed to delete customer',
        isLoading: false,
      });
      throw error;
    }
  },

  searchCustomers: async (query: string) => {
    set({isLoading: true, error: null});
    try {
      // Search in cache first
      const cachedResults = await storageService.searchCustomers(query);
      set({customers: cachedResults, isLoading: false});

      // Then try API
      if (apiService.getNetworkStatus()) {
        const response = await apiService.searchCustomers(query);
        if (response.success) {
          set({customers: response.data});
        }
      }
    } catch (error: any) {
      set({
        error: error.message || 'Failed to search customers',
        isLoading: false,
      });
    }
  },

  clearError: () => set({error: null}),
  clearSelectedCustomer: () => set({selectedCustomer: null}),
}));
