import {create} from 'zustand';
import {Invoice, InvoiceForm} from '../types';
import apiService from '../services/api';
import storageService from '../services/storage';
import notificationService from '../services/notifications';

interface InvoiceState {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchInvoices: (forceRefresh?: boolean, status?: string) => Promise<void>;
  fetchInvoice: (id: string) => Promise<void>;
  createInvoice: (data: InvoiceForm) => Promise<void>;
  updateInvoice: (id: string, data: Partial<InvoiceForm>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  sendInvoice: (id: string) => Promise<void>;
  markAsPaid: (id: string) => Promise<void>;
  clearError: () => void;
  clearSelectedInvoice: () => void;
}

export const useInvoiceStore = create<InvoiceState>((set, get) => ({
  invoices: [],
  selectedInvoice: null,
  isLoading: false,
  error: null,

  fetchInvoices: async (forceRefresh = false, status?: string) => {
    set({isLoading: true, error: null});
    try {
      // Try to get from cache first
      if (!forceRefresh) {
        const cachedInvoices = await storageService.getInvoices();
        if (cachedInvoices.length > 0) {
          let filtered = cachedInvoices;
          if (status) {
            filtered = cachedInvoices.filter(inv => inv.status === status);
          }
          set({invoices: filtered, isLoading: false});
          return;
        }
      }

      // Fetch from API
      const response = await apiService.getInvoices(1, 100, status);
      if (response.success && response.data) {
        const invoices = response.data.data;
        set({invoices, isLoading: false});
        await storageService.saveInvoices(invoices);
      }
    } catch (error: any) {
      // Fall back to cached data on error
      const cachedInvoices = await storageService.getInvoices();
      set({
        invoices: cachedInvoices,
        error: error.message || 'Failed to fetch invoices',
        isLoading: false,
      });
    }
  },

  fetchInvoice: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      // Try cache first
      const cachedInvoice = await storageService.getInvoice(id);
      if (cachedInvoice) {
        set({selectedInvoice: cachedInvoice, isLoading: false});
        return;
      }

      // Fetch from API
      const response = await apiService.getInvoice(id);
      if (response.success) {
        set({selectedInvoice: response.data, isLoading: false});
        await storageService.saveInvoice(response.data);
      }
    } catch (error: any) {
      set({
        error: error.message || 'Failed to fetch invoice',
        isLoading: false,
      });
    }
  },

  createInvoice: async (data: InvoiceForm) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.createInvoice(data);
      if (response.success) {
        const newInvoice = response.data;
        set(state => ({
          invoices: [newInvoice, ...state.invoices],
          isLoading: false,
        }));
        await storageService.saveInvoice(newInvoice);
        notificationService.notifyInvoiceCreated(newInvoice.invoiceNumber);
      }
    } catch (error: any) {
      // Save to pending sync if offline
      if (!apiService.getNetworkStatus()) {
        const tempInvoice: Invoice = {
          ...data,
          id: `temp_${Date.now()}`,
          invoiceNumber: `TEMP-${Date.now()}`,
          status: 'draft',
          subtotal: data.items.reduce((sum, item) => sum + item.total, 0),
          vatAmount: data.items.reduce((sum, item) => sum + (item.total * item.vatRate) / 100, 0),
          totalAmount:
            data.items.reduce((sum, item) => sum + item.total, 0) +
            data.items.reduce((sum, item) => sum + (item.total * item.vatRate) / 100, 0),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storageService.saveInvoice(tempInvoice);
        await storageService.addPendingSyncItem({
          id: tempInvoice.id,
          type: 'invoice',
          action: 'create',
          data,
        });
        set(state => ({
          invoices: [tempInvoice, ...state.invoices],
          isLoading: false,
        }));
      } else {
        set({
          error: error.message || 'Failed to create invoice',
          isLoading: false,
        });
        throw error;
      }
    }
  },

  updateInvoice: async (id: string, data: Partial<InvoiceForm>) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.updateInvoice(id, data);
      if (response.success) {
        const updatedInvoice = response.data;
        set(state => ({
          invoices: state.invoices.map(inv => (inv.id === id ? updatedInvoice : inv)),
          selectedInvoice:
            state.selectedInvoice?.id === id ? updatedInvoice : state.selectedInvoice,
          isLoading: false,
        }));
        await storageService.saveInvoice(updatedInvoice);
      }
    } catch (error: any) {
      // Save to pending sync if offline
      if (!apiService.getNetworkStatus()) {
        await storageService.addPendingSyncItem({
          id,
          type: 'invoice',
          action: 'update',
          data,
        });
        set({isLoading: false});
      } else {
        set({
          error: error.message || 'Failed to update invoice',
          isLoading: false,
        });
        throw error;
      }
    }
  },

  deleteInvoice: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      await apiService.deleteInvoice(id);
      set(state => ({
        invoices: state.invoices.filter(inv => inv.id !== id),
        isLoading: false,
      }));
      await storageService.deleteInvoice(id);
    } catch (error: any) {
      set({
        error: error.message || 'Failed to delete invoice',
        isLoading: false,
      });
      throw error;
    }
  },

  sendInvoice: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.sendInvoice(id);
      if (response.success) {
        const updatedInvoice = response.data;
        set(state => ({
          invoices: state.invoices.map(inv => (inv.id === id ? updatedInvoice : inv)),
          selectedInvoice:
            state.selectedInvoice?.id === id ? updatedInvoice : state.selectedInvoice,
          isLoading: false,
        }));
        await storageService.saveInvoice(updatedInvoice);
        notificationService.notifyInvoiceSent(updatedInvoice.invoiceNumber);
      }
    } catch (error: any) {
      set({
        error: error.message || 'Failed to send invoice',
        isLoading: false,
      });
      throw error;
    }
  },

  markAsPaid: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.markInvoiceAsPaid(id);
      if (response.success) {
        const updatedInvoice = response.data;
        set(state => ({
          invoices: state.invoices.map(inv => (inv.id === id ? updatedInvoice : inv)),
          selectedInvoice:
            state.selectedInvoice?.id === id ? updatedInvoice : state.selectedInvoice,
          isLoading: false,
        }));
        await storageService.saveInvoice(updatedInvoice);
        notificationService.notifyPaymentReceived(
          updatedInvoice.invoiceNumber,
          updatedInvoice.totalAmount,
        );
      }
    } catch (error: any) {
      set({
        error: error.message || 'Failed to mark invoice as paid',
        isLoading: false,
      });
      throw error;
    }
  },

  clearError: () => set({error: null}),
  clearSelectedInvoice: () => set({selectedInvoice: null}),
}));
