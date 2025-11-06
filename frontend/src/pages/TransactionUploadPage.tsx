import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadTransactionFile } from '../services/bankService';
import { TransactionImportResult } from '../types/bank.types';

const TransactionUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'csv' | 'excel'>('csv');
  const [bankName, setBankName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<TransactionImportResult | null>(null);

  const companyId = localStorage.getItem('selectedCompanyId') || '';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);

      // Auto-detect file type
      if (selectedFile.name.endsWith('.csv')) {
        setFileType('csv');
      } else if (selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls')) {
        setFileType('excel');
      }
    }
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Välj en fil först');
      return;
    }

    try {
      setUploading(true);
      const importResult = await uploadTransactionFile(companyId, file, fileType, bankName);
      setResult(importResult);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Uppladdning misslyckades');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Ladda upp Banktransaktioner</h1>
        <p className="text-gray-600">Importera transaktioner från din bank (CSV eller Excel)</p>
      </div>

      {!result ? (
        <div className="bg-white rounded-lg shadow p-8">
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Välj fil
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {file && (
              <p className="mt-2 text-sm text-gray-600">
                Vald fil: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filtyp
            </label>
            <select
              value={fileType}
              onChange={(e) => setFileType(e.target.value as 'csv' | 'excel')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="csv">CSV</option>
              <option value="excel">Excel (.xlsx, .xls)</option>
            </select>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bank (valfritt)
            </label>
            <select
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Generisk format</option>
              <option value="swedbank">Swedbank</option>
              <option value="handelsbanken">Handelsbanken</option>
              <option value="seb">SEB</option>
              <option value="nordea">Nordea</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Välj din bank för bättre tolkning av filformat
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-blue-900 mb-2">💡 Tips</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Filen ska innehålla kolumner för datum, beskrivning och belopp</li>
              <li>• Duplikattransaktioner kommer att identifieras och visas</li>
              <li>• CSV-filer kan använda semikolon (;) eller komma (,) som avgränsare</li>
            </ul>
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className={`flex-1 px-6 py-3 rounded-lg font-semibold ${
                file && !uploading
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {uploading ? 'Laddar upp...' : 'Ladda upp och Importera'}
            </button>
            <button
              onClick={() => navigate('/cash-flow')}
              className="px-6 py-3 border border-gray-300 rounded-lg font-semibold hover:bg-gray-50"
            >
              Avbryt
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-8">
          <div className="text-center mb-6">
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
              result.success ? 'bg-green-100' : 'bg-yellow-100'
            }`}>
              {result.success ? (
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {result.success ? 'Import Slutförd!' : 'Import Slutförd med Varningar'}
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-green-600">{result.imported_count}</p>
              <p className="text-sm text-gray-600 mt-1">Importerade</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600">{result.duplicate_count}</p>
              <p className="text-sm text-gray-600 mt-1">Duplikater</p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-red-600">{result.error_count}</p>
              <p className="text-sm text-gray-600 mt-1">Fel</p>
            </div>
          </div>

          {result.duplicates.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-yellow-900 mb-2">
                Duplikattransaktioner ({result.duplicates.length})
              </h3>
              <p className="text-sm text-yellow-800 mb-2">
                Dessa transaktioner har redan importerats tidigare och kommer att ignoreras:
              </p>
              <div className="max-h-40 overflow-y-auto">
                {result.duplicates.slice(0, 5).map((dup, index) => (
                  <div key={index} className="text-xs text-yellow-700 py-1 border-b border-yellow-200 last:border-0">
                    {new Date(dup.transaction_date).toLocaleDateString('sv-SE')} - {dup.description} - {dup.amount} SEK
                  </div>
                ))}
                {result.duplicates.length > 5 && (
                  <p className="text-xs text-yellow-600 mt-2">...och {result.duplicates.length - 5} till</p>
                )}
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-red-900 mb-2">
                Fel vid import ({result.errors.length})
              </h3>
              <div className="max-h-40 overflow-y-auto">
                {result.errors.map((error, index) => (
                  <div key={index} className="text-xs text-red-700 py-1">
                    Rad {error.row}: {error.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={() => navigate('/transactions')}
              className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
            >
              Se Transaktioner
            </button>
            <button
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
              className="px-6 py-3 border border-gray-300 rounded-lg font-semibold hover:bg-gray-50"
            >
              Ladda upp Fler
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionUploadPage;
