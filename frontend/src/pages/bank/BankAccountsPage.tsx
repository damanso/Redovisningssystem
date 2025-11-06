/**
 * Bank Accounts Page
 * View bank accounts and transactions for a connection
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useBankAccounts,
  useSyncBankAccount,
  useBankTransactions,
  BankAccount,
} from '../../hooks/useBank';

export default function BankAccountsPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const { data: accounts, isLoading: accountsLoading } = useBankAccounts(connectionId || '', companyId);
  const syncAccount = useSyncBankAccount();

  const { data: transactionsData, isLoading: transactionsLoading } = useBankTransactions(
    selectedAccountId,
    companyId,
    { limit: 50 }
  );

  const handleSync = async (accountId: string) => {
    try {
      await syncAccount.mutateAsync({ accountId, companyId, options: {} });
      alert('Synkronisering slutförd!');
    } catch (error: any) {
      alert(`Synkronisering misslyckades: ${error.response?.data?.error || error.message}`);
    }
  };

  const formatAmount = (amount: number, currency: string = 'SEK') => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      unmatched: 'bg-yellow-100 text-yellow-800',
      matched: 'bg-blue-100 text-blue-800',
      reconciled: 'bg-green-100 text-green-800',
      ignored: 'bg-gray-100 text-gray-800',
    };

    const labels = {
      unmatched: 'Omatchad',
      matched: 'Matchad',
      reconciled: 'Avstämd',
      ignored: 'Ignorerad',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status as keyof typeof colors]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  if (accountsLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar bankkonton...</div>
      </div>
    );
  }

  return (
    <div className='p-6 max-w-7xl mx-auto'>
      {/* Header */}
      <div className='mb-6'>
        <Link to='/bank' className='text-blue-600 hover:text-blue-800 mb-2 inline-block'>
          ← Tillbaka till bankanslutningar
        </Link>
        <h1 className='text-3xl font-bold'>Bankkonton</h1>
      </div>

      {/* Accounts List */}
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6'>
        {accounts?.map((account: BankAccount) => (
          <div
            key={account.id}
            className={`bg-white rounded-lg shadow p-6 cursor-pointer border-2 ${
              selectedAccountId === account.id ? 'border-blue-500' : 'border-transparent'
            }`}
            onClick={() => setSelectedAccountId(account.id)}
          >
            <div className='flex justify-between items-start mb-4'>
              <div>
                <h3 className='font-semibold text-lg'>{account.account_name}</h3>
                <p className='text-sm text-gray-500'>
                  {account.clearing_number} {account.account_number}
                </p>
              </div>
              {account.unmatched_count && account.unmatched_count > 0 && (
                <span className='bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full'>
                  {account.unmatched_count} omatchade
                </span>
              )}
            </div>

            <div className='mb-4'>
              <div className='text-2xl font-bold'>{formatAmount(account.balance || 0, account.currency)}</div>
              <div className='text-xs text-gray-500'>Saldo</div>
            </div>

            <div className='flex justify-between items-center text-xs text-gray-500'>
              <span>
                Synkad: {account.last_synced_at ? new Date(account.last_synced_at).toLocaleDateString('sv-SE') : 'Aldrig'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSync(account.id);
                }}
                disabled={syncAccount.isPending}
                className='text-blue-600 hover:text-blue-800 font-medium'
              >
                Synka
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Transactions */}
      {selectedAccountId && (
        <div className='bg-white rounded-lg shadow overflow-hidden'>
          <div className='px-6 py-4 border-b border-gray-200 flex justify-between items-center'>
            <h2 className='text-xl font-semibold'>Transaktioner</h2>
            <Link
              to={`/bank/reconciliation?account=${selectedAccountId}`}
              className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm'
            >
              Gå till avstämning
            </Link>
          </div>

          {transactionsLoading ? (
            <div className='p-6 text-center'>Laddar transaktioner...</div>
          ) : transactionsData?.transactions && transactionsData.transactions.length > 0 ? (
            <div className='overflow-x-auto'>
              <table className='w-full'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                      Datum
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                      Beskrivning
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                      Motpart
                    </th>
                    <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase'>
                      Belopp
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-200'>
                  {transactionsData.transactions.map((tx: any) => (
                    <tr key={tx.id} className='hover:bg-gray-50'>
                      <td className='px-6 py-4 whitespace-nowrap text-sm'>
                        {new Date(tx.transaction_date).toLocaleDateString('sv-SE')}
                      </td>
                      <td className='px-6 py-4 text-sm'>
                        <div className='max-w-xs truncate'>{tx.description || '-'}</div>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                        {tx.counterparty_name || '-'}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-sm text-right'>
                        <span className={tx.amount > 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatAmount(tx.amount)}
                        </span>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>{getStatusBadge(tx.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className='p-6 text-center text-gray-500'>Inga transaktioner</div>
          )}
        </div>
      )}

      {!selectedAccountId && (
        <div className='bg-white rounded-lg shadow p-12 text-center'>
          <p className='text-gray-500'>Välj ett bankkonto för att visa transaktioner</p>
        </div>
      )}
    </div>
  );
}
