import React, { useEffect } from 'react';
import { Cloud, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useSyncInvoice, useSyncReceipt, useSyncStatus } from '../hooks/useGoogleDrive';

interface GoogleDriveSyncButtonProps {
  documentType: 'invoice' | 'receipt';
  documentId: string;
  companyId?: string; // Optional for now, can be used for future enhancements
  className?: string;
  showStatus?: boolean;
}

const GoogleDriveSyncButton: React.FC<GoogleDriveSyncButtonProps> = ({
  documentType,
  documentId,
  className = '',
  showStatus = true,
}) => {
  const syncInvoice = useSyncInvoice();
  const syncReceipt = useSyncReceipt();
  const { data: syncStatusData, refetch } = useSyncStatus(documentType, documentId);

  const syncStatus = syncStatusData?.syncStatus;

  // Refetch status after sync
  useEffect(() => {
    if (syncInvoice.isSuccess || syncReceipt.isSuccess) {
      setTimeout(() => refetch(), 1000);
    }
  }, [syncInvoice.isSuccess, syncReceipt.isSuccess, refetch]);

  const handleSync = async () => {
    try {
      if (documentType === 'invoice') {
        const result = await syncInvoice.mutateAsync(documentId);
        if (result.webViewLink) {
          alert(`Faktura synkroniserad! Öppna i Drive: ${result.webViewLink}`);
        }
      } else {
        const result = await syncReceipt.mutateAsync(documentId);
        if (result.webViewLink) {
          alert(`Kvitto synkroniserat! Öppna i Drive: ${result.webViewLink}`);
        }
      }
    } catch (error: any) {
      console.error('Sync failed:', error);
      const errorMsg = error.response?.data?.error || 'Kunde inte synkronisera dokument';
      alert(`Fel: ${errorMsg}`);
    }
  };

  const isSyncing = syncInvoice.isPending || syncReceipt.isPending;
  const isSynced = syncStatus?.sync_status === 'synced';
  const hasFailed = syncStatus?.sync_status === 'failed';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={handleSync}
        disabled={isSyncing}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title={isSynced ? 'Uppdatera i Google Drive' : 'Synkronisera till Google Drive'}
      >
        {isSyncing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Synkroniserar...</span>
          </>
        ) : (
          <>
            <Cloud className="w-4 h-4" />
            <span>{isSynced ? 'Uppdatera' : 'Synkronisera'}</span>
          </>
        )}
      </button>

      {showStatus && syncStatus && (
        <div className="flex items-center gap-1">
          {isSynced && (
            <>
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-xs text-gray-600">
                Synkad {new Date(syncStatus.last_synced_at).toLocaleDateString('sv-SE')}
              </span>
              {syncStatus.web_view_link && (
                <a
                  href={syncStatus.web_view_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline ml-1"
                >
                  Öppna
                </a>
              )}
            </>
          )}
          {hasFailed && (
            <>
              <XCircle className="w-4 h-4 text-red-600" />
              <span className="text-xs text-red-600" title={syncStatus.error_message}>
                Misslyckades
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default GoogleDriveSyncButton;
