/**
 * Bank Connections Page
 * Manage Open Banking connections via Tink
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useBankConnections,
  useCreateBankConnection,
  useDeleteBankConnection,
} from '../../hooks/useBank';

export default function BankConnectionsPage() {
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [isConnecting, setIsConnecting] = useState(false);

  const { data: connections, isLoading, error } = useBankConnections(companyId);
  const createConnection = useCreateBankConnection();
  const deleteConnection = useDeleteBankConnection();

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await createConnection.mutateAsync({
        company_id: companyId,
        provider: 'tink',
      });

      if (result.authorization_url) {
        // Redirect to Tink for authorization
        window.location.href = result.authorization_url;
      }
    } catch (error: any) {
      alert(`Kunde inte ansluta bank: ${error.response?.data?.error || error.message}`);
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    if (confirm('Är du säker på att du vill koppla från denna bank?')) {
      try {
        await deleteConnection.mutateAsync({ connectionId, companyId });
        alert('Banken har kopplats från');
      } catch (error) {
        alert('Kunde inte koppla från banken');
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      expired: 'bg-yellow-100 text-yellow-800',
      revoked: 'bg-red-100 text-red-800',
      error: 'bg-red-100 text-red-800',
    };

    const labels = {
      active: 'Aktiv',
      expired: 'Utgången',
      revoked: 'Frånkopplad',
      error: 'Fel',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar bankanslutningar...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg text-red-600'>Ett fel uppstod vid laddning av bankanslutningar</div>
      </div>
    );
  }

  return (
    <div className='p-6 max-w-7xl mx-auto'>
      {/* Header */}
      <div className='flex justify-between items-center mb-6'>
        <div>
          <h1 className='text-3xl font-bold'>Bankanslutningar</h1>
          <p className='text-gray-600 mt-2'>
            Anslut din bank via Open Banking för automatisk import av transaktioner
          </p>
        </div>
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400'
        >
          {isConnecting ? 'Ansluter...' : 'Anslut bank'}
        </button>
      </div>

      {/* Info Box */}
      <div className='bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6'>
        <h3 className='font-semibold text-blue-900 mb-2'>Om Open Banking</h3>
        <p className='text-sm text-blue-800'>
          Med Open Banking kan du säkert ansluta ditt företags bankkonto och automatiskt importera
          transaktioner. Vi använder Tink som är godkänd av Finansinspektionen och följer PSD2-direktivet.
        </p>
      </div>

      {/* Connections List */}
      {connections && connections.length > 0 ? (
        <div className='bg-white rounded-lg shadow overflow-hidden'>
          <table className='w-full'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                  Bank
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                  Status
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                  Senast synkad
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                  Ansluten
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                  Åtgärder
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200'>
              {connections.map((connection: any) => (
                <tr key={connection.id} className='hover:bg-gray-50'>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center'>
                      <div>
                        <div className='font-medium text-gray-900'>
                          {connection.bank_name || 'Okänd bank'}
                        </div>
                        <div className='text-sm text-gray-500'>{connection.provider}</div>
                      </div>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    {getStatusBadge(connection.status)}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {connection.last_sync_at
                      ? new Date(connection.last_sync_at).toLocaleString('sv-SE')
                      : 'Aldrig'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {new Date(connection.created_at).toLocaleDateString('sv-SE')}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm'>
                    <Link
                      to={`/bank/connections/${connection.id}`}
                      className='text-blue-600 hover:text-blue-800 mr-4'
                    >
                      Visa konton
                    </Link>
                    <button
                      onClick={() => handleDisconnect(connection.id)}
                      className='text-red-600 hover:text-red-800'
                    >
                      Koppla från
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className='bg-white rounded-lg shadow p-12 text-center'>
          <svg
            className='mx-auto h-12 w-12 text-gray-400'
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'
            />
          </svg>
          <h3 className='mt-2 text-sm font-medium text-gray-900'>Inga bankanslutningar</h3>
          <p className='mt-1 text-sm text-gray-500'>
            Kom igång genom att ansluta din bank med Open Banking.
          </p>
          <div className='mt-6'>
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400'
            >
              {isConnecting ? 'Ansluter...' : 'Anslut din första bank'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
