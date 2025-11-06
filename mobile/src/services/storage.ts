import AsyncStorage from '@react-native-async-storage/async-storage';
import {Customer, Invoice, Receipt, OfflineData} from '../types';

const STORAGE_KEYS = {
  INVOICES: '@invoices',
  CUSTOMERS: '@customers',
  RECEIPTS: '@receipts',
  LAST_SYNC: '@last_sync',
  PENDING_SYNC: '@pending_sync',
  USER_SETTINGS: '@user_settings',
};

interface PendingSyncItem {
  id: string;
  type: 'invoice' | 'customer' | 'receipt';
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
}

class StorageService {
  // Generic storage methods
  async setItem(key: string, value: any): Promise<void> {
    try {
      const jsonValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, jsonValue);
    } catch (error) {
      console.error('Error storing data:', error);
      throw error;
    }
  }

  async getItem<T>(key: string): Promise<T | null> {
    try {
      const jsonValue = await AsyncStorage.getItem(key);
      return jsonValue != null ? JSON.parse(jsonValue) : null;
    } catch (error) {
      console.error('Error retrieving data:', error);
      return null;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing data:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Error clearing storage:', error);
      throw error;
    }
  }

  // Invoices
  async saveInvoices(invoices: Invoice[]): Promise<void> {
    await this.setItem(STORAGE_KEYS.INVOICES, invoices);
  }

  async getInvoices(): Promise<Invoice[]> {
    return (await this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES)) || [];
  }

  async saveInvoice(invoice: Invoice): Promise<void> {
    const invoices = await this.getInvoices();
    const index = invoices.findIndex(i => i.id === invoice.id);
    if (index >= 0) {
      invoices[index] = invoice;
    } else {
      invoices.push(invoice);
    }
    await this.saveInvoices(invoices);
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const invoices = await this.getInvoices();
    return invoices.find(i => i.id === id) || null;
  }

  async deleteInvoice(id: string): Promise<void> {
    const invoices = await this.getInvoices();
    const filtered = invoices.filter(i => i.id !== id);
    await this.saveInvoices(filtered);
  }

  // Customers
  async saveCustomers(customers: Customer[]): Promise<void> {
    await this.setItem(STORAGE_KEYS.CUSTOMERS, customers);
  }

  async getCustomers(): Promise<Customer[]> {
    return (await this.getItem<Customer[]>(STORAGE_KEYS.CUSTOMERS)) || [];
  }

  async saveCustomer(customer: Customer): Promise<void> {
    const customers = await this.getCustomers();
    const index = customers.findIndex(c => c.id === customer.id);
    if (index >= 0) {
      customers[index] = customer;
    } else {
      customers.push(customer);
    }
    await this.saveCustomers(customers);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const customers = await this.getCustomers();
    return customers.find(c => c.id === id) || null;
  }

  async deleteCustomer(id: string): Promise<void> {
    const customers = await this.getCustomers();
    const filtered = customers.filter(c => c.id !== id);
    await this.saveCustomers(filtered);
  }

  // Receipts
  async saveReceipts(receipts: Receipt[]): Promise<void> {
    await this.setItem(STORAGE_KEYS.RECEIPTS, receipts);
  }

  async getReceipts(): Promise<Receipt[]> {
    return (await this.getItem<Receipt[]>(STORAGE_KEYS.RECEIPTS)) || [];
  }

  async saveReceipt(receipt: Receipt): Promise<void> {
    const receipts = await this.getReceipts();
    const index = receipts.findIndex(r => r.id === receipt.id);
    if (index >= 0) {
      receipts[index] = receipt;
    } else {
      receipts.push(receipt);
    }
    await this.saveReceipts(receipts);
  }

  async getReceipt(id: string): Promise<Receipt | null> {
    const receipts = await this.getReceipts();
    return receipts.find(r => r.id === id) || null;
  }

  async deleteReceipt(id: string): Promise<void> {
    const receipts = await this.getReceipts();
    const filtered = receipts.filter(r => r.id !== id);
    await this.saveReceipts(filtered);
  }

  // Sync management
  async getLastSyncTime(): Promise<string | null> {
    return this.getItem<string>(STORAGE_KEYS.LAST_SYNC);
  }

  async setLastSyncTime(timestamp: string): Promise<void> {
    await this.setItem(STORAGE_KEYS.LAST_SYNC, timestamp);
  }

  async getPendingSyncItems(): Promise<PendingSyncItem[]> {
    return (await this.getItem<PendingSyncItem[]>(STORAGE_KEYS.PENDING_SYNC)) || [];
  }

  async addPendingSyncItem(item: Omit<PendingSyncItem, 'timestamp'>): Promise<void> {
    const items = await this.getPendingSyncItems();
    items.push({
      ...item,
      timestamp: new Date().toISOString(),
    });
    await this.setItem(STORAGE_KEYS.PENDING_SYNC, items);
  }

  async clearPendingSyncItems(): Promise<void> {
    await this.setItem(STORAGE_KEYS.PENDING_SYNC, []);
  }

  async removePendingSyncItem(id: string): Promise<void> {
    const items = await this.getPendingSyncItems();
    const filtered = items.filter(item => item.id !== id);
    await this.setItem(STORAGE_KEYS.PENDING_SYNC, filtered);
  }

  // Offline data sync
  async getAllOfflineData(): Promise<OfflineData> {
    const [invoices, customers, receipts, lastSync] = await Promise.all([
      this.getInvoices(),
      this.getCustomers(),
      this.getReceipts(),
      this.getLastSyncTime(),
    ]);

    return {
      invoices,
      customers,
      receipts,
      lastSync: lastSync || new Date().toISOString(),
    };
  }

  async saveAllOfflineData(data: OfflineData): Promise<void> {
    await Promise.all([
      this.saveInvoices(data.invoices),
      this.saveCustomers(data.customers),
      this.saveReceipts(data.receipts),
      this.setLastSyncTime(data.lastSync),
    ]);
  }

  // User settings
  async getUserSettings(): Promise<any> {
    return this.getItem(STORAGE_KEYS.USER_SETTINGS);
  }

  async saveUserSettings(settings: any): Promise<void> {
    await this.setItem(STORAGE_KEYS.USER_SETTINGS, settings);
  }

  // Search functionality
  async searchInvoices(query: string): Promise<Invoice[]> {
    const invoices = await this.getInvoices();
    const lowerQuery = query.toLowerCase();
    return invoices.filter(
      invoice =>
        invoice.invoiceNumber.toLowerCase().includes(lowerQuery) ||
        invoice.customer?.name.toLowerCase().includes(lowerQuery),
    );
  }

  async searchCustomers(query: string): Promise<Customer[]> {
    const customers = await this.getCustomers();
    const lowerQuery = query.toLowerCase();
    return customers.filter(
      customer =>
        customer.name.toLowerCase().includes(lowerQuery) ||
        customer.email.toLowerCase().includes(lowerQuery) ||
        customer.organizationNumber.toLowerCase().includes(lowerQuery),
    );
  }
}

export default new StorageService();
