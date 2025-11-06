import React from 'react';
import { ExternalLink, FileText, Receipt, Loader2 } from 'lucide-react';
import { useSyncedDocuments } from '../hooks/useGoogleDrive';

interface GoogleDriveSyncedDocumentsProps {
  companyId: string;
}

const GoogleDriveSyncedDocuments: React.FC<GoogleDriveSyncedDocumentsProps> = ({ companyId }) => {
  const { data, isLoading } = useSyncedDocuments(companyId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const documents = data?.documents || [];

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>Inga synkroniserade dokument ännu</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Synkroniserade dokument</h3>
        <p className="text-sm text-gray-600 mt-1">
          Dokument som är uppladdade till Google Drive
        </p>
      </div>

      <div className="divide-y divide-gray-200">
        {documents.map((doc) => (
          <div key={doc.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {doc.document_type === 'invoice' ? (
                  <FileText className="w-5 h-5 text-blue-600" />
                ) : (
                  <Receipt className="w-5 h-5 text-green-600" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{doc.drive_file_name}</p>
                  <p className="text-sm text-gray-600">
                    {doc.document_name} • Synkad{' '}
                    {new Date(doc.last_synced_at).toLocaleDateString('sv-SE', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              </div>

              {doc.web_view_link && (
                <a
                  href={doc.web_view_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  Öppna i Drive
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GoogleDriveSyncedDocuments;
