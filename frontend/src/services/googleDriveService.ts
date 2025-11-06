import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export interface GoogleDriveConnectionStatus {
  connected: boolean;
  stats: Array<{
    document_type: string;
    sync_status: string;
    count: number;
  }>;
}

export interface SyncResult {
  message: string;
  driveFileId: string;
  driveFileName: string;
  webViewLink: string;
}

export interface SyncStatus {
  id: string;
  drive_file_id: string;
  drive_file_name: string;
  web_view_link: string;
  last_synced_at: string;
  sync_status: 'synced' | 'pending' | 'failed' | 'deleted';
  error_message?: string;
}

export interface SyncedDocument {
  id: string;
  document_type: 'invoice' | 'receipt';
  document_id: string;
  drive_file_name: string;
  web_view_link: string;
  last_synced_at: string;
  sync_status: string;
  document_name: string;
}

/**
 * Get Google Drive authorization URL
 */
export const getAuthUrl = async (companyId: string): Promise<{ authUrl: string }> => {
  const response = await axios.post(
    `${API_URL}/integrations/google/auth`,
    { companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

/**
 * Check Google Drive connection status
 */
export const getConnectionStatus = async (
  companyId: string
): Promise<GoogleDriveConnectionStatus> => {
  const response = await axios.get(
    `${API_URL}/integrations/google/status/${companyId}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

/**
 * Disconnect Google Drive
 */
export const disconnect = async (companyId: string): Promise<void> => {
  await axios.post(
    `${API_URL}/integrations/google/disconnect/${companyId}`,
    {},
    { headers: getAuthHeader() }
  );
};

/**
 * Sync invoice to Google Drive
 */
export const syncInvoice = async (invoiceId: string): Promise<SyncResult> => {
  const response = await axios.post(
    `${API_URL}/integrations/google/sync/invoice/${invoiceId}`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

/**
 * Sync receipt to Google Drive
 */
export const syncReceipt = async (receiptId: string): Promise<SyncResult> => {
  const response = await axios.post(
    `${API_URL}/integrations/google/sync/receipt/${receiptId}`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

/**
 * Get sync status for a document
 */
export const getSyncStatus = async (
  documentType: 'invoice' | 'receipt',
  documentId: string
): Promise<{ syncStatus: SyncStatus | null }> => {
  const response = await axios.get(
    `${API_URL}/integrations/google/sync/status/${documentType}/${documentId}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

/**
 * Get all synced documents for a company
 */
export const getSyncedDocuments = async (
  companyId: string
): Promise<{ documents: SyncedDocument[] }> => {
  const response = await axios.get(
    `${API_URL}/integrations/google/sync/documents/${companyId}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};
