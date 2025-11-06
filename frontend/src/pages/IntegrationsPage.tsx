import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import GoogleDriveConnect from '../components/GoogleDriveConnect';
import GoogleDriveSyncedDocuments from '../components/GoogleDriveSyncedDocuments';

const IntegrationsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [companyId, setCompanyId] = useState<string>('');

  // Get company ID from localStorage or context
  useEffect(() => {
    // In a real app, this would come from a context or auth state
    const storedCompanyId = localStorage.getItem('selectedCompanyId');
    if (storedCompanyId) {
      setCompanyId(storedCompanyId);
    }
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // This contains company ID

    if (code && state) {
      // The backend will handle the OAuth callback
      // Show success message
      alert('Google Drive ansluten framgångsrikt!');
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      // Reload to update status
      window.location.reload();
    }
  }, [searchParams]);

  if (!companyId) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">Vänligen välj ett företag först</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Integrationer</h1>
        <p className="mt-2 text-gray-600">
          Anslut externa tjänster för att automatisera ditt arbetsflöde
        </p>
      </div>

      <div className="space-y-6">
        {/* Google Drive Integration */}
        <GoogleDriveConnect companyId={companyId} />

        {/* Synced Documents */}
        <GoogleDriveSyncedDocuments companyId={companyId} />
      </div>

      {/* Future integrations can be added here */}
      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Fler integrationer kommer snart</h3>
        <p className="text-gray-600">
          Vi arbetar på att lägga till fler integrationer som Dropbox, OneDrive, och mer.
        </p>
      </div>
    </div>
  );
};

export default IntegrationsPage;
