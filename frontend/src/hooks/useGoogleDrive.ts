import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as googleDriveService from '../services/googleDriveService';

/**
 * Get Google Drive connection status
 */
export const useGoogleDriveStatus = (companyId: string) => {
  return useQuery({
    queryKey: ['googleDrive', 'status', companyId],
    queryFn: () => googleDriveService.getConnectionStatus(companyId),
    enabled: !!companyId,
  });
};

/**
 * Get authorization URL
 */
export const useGetAuthUrl = () => {
  return useMutation({
    mutationFn: (companyId: string) => googleDriveService.getAuthUrl(companyId),
  });
};

/**
 * Disconnect Google Drive
 */
export const useDisconnectGoogleDrive = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) => googleDriveService.disconnect(companyId),
    onSuccess: (_, companyId) => {
      queryClient.invalidateQueries({ queryKey: ['googleDrive', 'status', companyId] });
      queryClient.invalidateQueries({ queryKey: ['googleDrive', 'documents', companyId] });
    },
  });
};

/**
 * Sync invoice to Google Drive
 */
export const useSyncInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invoiceId: string) => googleDriveService.syncInvoice(invoiceId),
    onSuccess: (_, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ['googleDrive', 'syncStatus', 'invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['googleDrive', 'documents'] });
    },
  });
};

/**
 * Sync receipt to Google Drive
 */
export const useSyncReceipt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (receiptId: string) => googleDriveService.syncReceipt(receiptId),
    onSuccess: (_, receiptId) => {
      queryClient.invalidateQueries({ queryKey: ['googleDrive', 'syncStatus', 'receipt', receiptId] });
      queryClient.invalidateQueries({ queryKey: ['googleDrive', 'documents'] });
    },
  });
};

/**
 * Get sync status for a document
 */
export const useSyncStatus = (
  documentType: 'invoice' | 'receipt',
  documentId: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ['googleDrive', 'syncStatus', documentType, documentId],
    queryFn: () => googleDriveService.getSyncStatus(documentType, documentId),
    enabled: !!documentId && enabled,
  });
};

/**
 * Get all synced documents for a company
 */
export const useSyncedDocuments = (companyId: string) => {
  return useQuery({
    queryKey: ['googleDrive', 'documents', companyId],
    queryFn: () => googleDriveService.getSyncedDocuments(companyId),
    enabled: !!companyId,
  });
};
