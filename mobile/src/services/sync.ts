import NetInfo from '@react-native-community/netinfo';
import apiService from './api';
import storageService from './storage';

class SyncService {
  private isSyncing: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;

  async startAutoSync(intervalMinutes: number = 15): Promise<void> {
    // Stop any existing sync interval
    this.stopAutoSync();

    // Start new sync interval
    this.syncInterval = setInterval(() => {
      this.syncData();
    }, intervalMinutes * 60 * 1000);

    // Do an immediate sync
    await this.syncData();
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async syncData(): Promise<boolean> {
    if (this.isSyncing) {
      console.log('Sync already in progress');
      return false;
    }

    // Check network connectivity
    const networkState = await NetInfo.fetch();
    if (!networkState.isConnected) {
      console.log('No network connection, skipping sync');
      return false;
    }

    this.isSyncing = true;

    try {
      // 1. Upload pending changes
      await this.uploadPendingChanges();

      // 2. Download fresh data
      await this.downloadFreshData();

      // 3. Update last sync time
      await storageService.setLastSyncTime(new Date().toISOString());

      console.log('Sync completed successfully');
      return true;
    } catch (error) {
      console.error('Sync failed:', error);
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  private async uploadPendingChanges(): Promise<void> {
    const pendingItems = await storageService.getPendingSyncItems();

    for (const item of pendingItems) {
      try {
        switch (item.type) {
          case 'invoice':
            await this.syncInvoice(item);
            break;
          case 'customer':
            await this.syncCustomer(item);
            break;
          case 'receipt':
            await this.syncReceipt(item);
            break;
        }

        // Remove successfully synced item
        await storageService.removePendingSyncItem(item.id);
      } catch (error) {
        console.error(`Failed to sync ${item.type} ${item.id}:`, error);
        // Keep item in pending queue for next sync attempt
      }
    }
  }

  private async syncInvoice(item: any): Promise<void> {
    switch (item.action) {
      case 'create':
        await apiService.createInvoice(item.data);
        break;
      case 'update':
        await apiService.updateInvoice(item.id, item.data);
        break;
      case 'delete':
        await apiService.deleteInvoice(item.id);
        break;
    }
  }

  private async syncCustomer(item: any): Promise<void> {
    switch (item.action) {
      case 'create':
        await apiService.createCustomer(item.data);
        break;
      case 'update':
        await apiService.updateCustomer(item.id, item.data);
        break;
      case 'delete':
        await apiService.deleteCustomer(item.id);
        break;
    }
  }

  private async syncReceipt(item: any): Promise<void> {
    switch (item.action) {
      case 'update':
        await apiService.updateReceipt(item.id, item.data);
        break;
      case 'delete':
        await apiService.deleteReceipt(item.id);
        break;
    }
  }

  private async downloadFreshData(): Promise<void> {
    try {
      // Download invoices
      const invoicesResponse = await apiService.getInvoices(1, 100);
      if (invoicesResponse.success && invoicesResponse.data) {
        await storageService.saveInvoices(invoicesResponse.data.data);
      }

      // Download customers
      const customersResponse = await apiService.getCustomers(1, 100);
      if (customersResponse.success && customersResponse.data) {
        await storageService.saveCustomers(customersResponse.data.data);
      }

      // Download receipts
      const receiptsResponse = await apiService.getReceipts(1, 100);
      if (receiptsResponse.success && receiptsResponse.data) {
        await storageService.saveReceipts(receiptsResponse.data.data);
      }
    } catch (error) {
      console.error('Error downloading fresh data:', error);
      throw error;
    }
  }

  async forceSyncNow(): Promise<boolean> {
    return this.syncData();
  }

  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}

export default new SyncService();
