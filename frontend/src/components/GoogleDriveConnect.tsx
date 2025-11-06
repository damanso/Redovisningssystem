import React from 'react';
import { Cloud, CloudOff, Loader2 } from 'lucide-react';
import {
  useGoogleDriveStatus,
  useGetAuthUrl,
  useDisconnectGoogleDrive,
} from '../hooks/useGoogleDrive';

interface GoogleDriveConnectProps {
  companyId: string;
}

const GoogleDriveConnect: React.FC<GoogleDriveConnectProps> = ({ companyId }) => {
  const { data: status, isLoading } = useGoogleDriveStatus(companyId);
  const getAuthUrl = useGetAuthUrl();
  const disconnect = useDisconnectGoogleDrive();

  const handleConnect = async () => {
    try {
      const { authUrl } = await getAuthUrl.mutateAsync(companyId);
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to get auth URL:', error);
      alert('Kunde inte ansluta till Google Drive. Försök igen.');
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Är du säker på att du vill koppla från Google Drive?')) {
      return;
    }

    try {
      await disconnect.mutateAsync(companyId);
      alert('Google Drive frånkopplat');
    } catch (error) {
      console.error('Failed to disconnect:', error);
      alert('Kunde inte koppla från Google Drive. Försök igen.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Laddar...</span>
      </div>
    );
  }

  const isConnected = status?.connected || false;

  // Calculate stats
  const syncedInvoices =
    status?.stats?.find((s) => s.document_type === 'invoice' && s.sync_status === 'synced')
      ?.count || 0;
  const syncedReceipts =
    status?.stats?.find((s) => s.document_type === 'receipt' && s.sync_status === 'synced')
      ?.count || 0;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {isConnected ? (
            <Cloud className="w-8 h-8 text-blue-600" />
          ) : (
            <CloudOff className="w-8 h-8 text-gray-400" />
          )}
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Google Drive</h3>
            <p className="text-sm text-gray-600">
              {isConnected
                ? 'Ansluten - Dina dokument synkroniseras automatiskt'
                : 'Anslut för att synkronisera fakturor och kvitton'}
            </p>
          </div>
        </div>

        {isConnected ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            {disconnect.isPending ? 'Kopplar från...' : 'Koppla från'}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={getAuthUrl.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {getAuthUrl.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Ansluter...
              </>
            ) : (
              'Anslut Google Drive'
            )}
          </button>
        )}
      </div>

      {isConnected && (
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">Synkroniserade fakturor</p>
            <p className="text-2xl font-bold text-blue-600">{syncedInvoices}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">Synkroniserade kvitton</p>
            <p className="text-2xl font-bold text-green-600">{syncedReceipts}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoogleDriveConnect;
