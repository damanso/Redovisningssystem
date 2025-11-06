/**
 * Bank Reconciliation Page
 * Match and reconcile bank transactions with invoices/receipts
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useBankTransactions,
  useMatchCandidates,
  useMatchTransaction,
  useReconcileTransaction,
  useReconciliationSummary,
  BankTransaction,
  MatchCandidate,
} from '../../hooks/useBank';

export default function BankReconciliationPage() {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('account') || '';
  const companyId = localStorage.getItem('currentCompanyId') || '';

  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('unmatched');

  const { data: transactionsData, isLoading: transactionsLoading } = useBankTransactions(
    accountId,
    companyId,
    { status: statusFilter }
  );

  const { data: candidates, isLoading: candidatesLoading } = useMatchCandidates(
    selectedTransaction?.id || '',
    companyId
  );

  const { data: summary } = useReconciliationSummary(companyId);
  const matchTransaction = useMatchTransaction();
  const reconcileTransaction = useReconcileTransaction();

  const formatAmount = (amount: number, currency: string = 'SEK') => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const handleMatch = async (candidate: MatchCandidate) => {
    if (!selectedTransaction) return;

    try {
      await matchTransaction.mutateAsync({
        transactionId: selectedTransaction.id,
        companyId,
        matchData: {
          match_type: candidate.type,
          match_id: candidate.invoice_id || candidate.receipt_id,
          matched_amount: Math.abs(selectedTransaction.amount),
        },
      });

      alert('Transaktion matchad!');
      setSelectedTransaction(null);
    } catch (error: any) {
      alert(`Matchning misslyckades: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleReconcile = async (transactionId: string) => {
    if (!confirm('Är du säker på att du vill avstäma denna transaktion?')) {
      return;
    }

    try {
      await reconcileTransaction.mutateAsync({
        transactionId,
        companyId,
        options: { create_journal_entry: true },
      });

      alert('Transaktion avstämd och verifikation skapad!');
    } catch (error: any) {
      alert(`Avstämning misslyckades: ${error.response?.data?.error || error.message}`);
    }
  };

  return (
    <div className='p-6 max-w-7xl mx-auto'>
      {/* Header */}
      <div className='mb-6'>
        <h1 className='text-3xl font-bold'>Bankavsťmning</h1>
        <p className='text-gray-600 mt-2'>Matcha och avstäm banktransaktioner</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-6'>
          <div className='bg-yellow-50 border border-yellow-200 rounded-lg p-4'>
            <div className='text-sm text-yellow-800 font-medium'>Omatchade</div>
            <div className='text-2xl font-bold text-yellow-900'>{summary.unmatched_count || 0}</div>
          </div>
          <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
            <div className='text-sm text-blue-800 font-medium'>Matchade</div>
            <div className='text-2xl font-bold text-blue-900'>{summary.matched_count || 0}</div>
          </div>
          <div className='bg-green-50 border border-green-200 rounded-lg p-4'>
            <div className='text-sm text-green-800 font-medium'>Avstämda</div>
            <div className='text-2xl font-bold text-green-900'>{summary.reconciled_count || 0}</div>
          </div>
          <div className='bg-gray-50 border border-gray-200 rounded-lg p-4'>
            <div className='text-sm text-gray-600 font-medium'>Ignorerade</div>
            <div className='text-2xl font-bold text-gray-900'>{summary.ignored_count || 0}</div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className='mb-6'>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className='px-4 py-2 border rounded-lg'
        >
          <option value='unmatched'>Omatchade</option>
          <option value='matched'>Matchade</option>
          <option value='reconciled'>Avstämda</option>
          <option value=''>Alla</option>
        </select>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        {/* Transactions List */}
        <div className='bg-white rounded-lg shadow overflow-hidden'>
          <div className='px-6 py-4 border-b border-gray-200'>
            <h2 className='text-xl font-semibold'>Transaktioner</h2>
          </div>

          {transactionsLoading ? (
            <div className='p-6 text-center'>Laddar...</div>
          ) : transactionsData?.transactions && transactionsData.transactions.length > 0 ? (
            <div className='divide-y divide-gray-200 max-h-[600px] overflow-y-auto'>
              {transactionsData.transactions.map((tx: BankTransaction) => (
                <div
                  key={tx.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${
                    selectedTransaction?.id === tx.id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => setSelectedTransaction(tx)}
                >
                  <div className='flex justify-between items-start mb-2'>
                    <div>
                      <div className='font-medium'>{tx.description || 'Ingen beskrivning'}</div>
                      <div className='text-sm text-gray-500'>
                        {new Date(tx.transaction_date).toLocaleDateString('sv-SE')}
                      </div>
                      {tx.counterparty_name && (
                        <div className='text-sm text-gray-500'>{tx.counterparty_name}</div>
                      )}
                    </div>
                    <div
                      className={`text-lg font-bold ${tx.amount > 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatAmount(tx.amount)}
                    </div>
                  </div>

                  {tx.status === 'matched' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReconcile(tx.id);
                      }}
                      className='mt-2 px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700'
                    >
                      Avstäm
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className='p-6 text-center text-gray-500'>Inga transaktioner</div>
          )}
        </div>

        {/* Match Candidates */}
        <div className='bg-white rounded-lg shadow overflow-hidden'>
          <div className='px-6 py-4 border-b border-gray-200'>
            <h2 className='text-xl font-semibold'>
              {selectedTransaction ? 'Matchningsförslag' : 'Välj transaktion'}
            </h2>
          </div>

          {!selectedTransaction ? (
            <div className='p-12 text-center text-gray-500'>
              Välj en transaktion för att se matchningsförslag
            </div>
          ) : candidatesLoading ? (
            <div className='p-6 text-center'>Söker matchningar...</div>
          ) : candidates && candidates.length > 0 ? (
            <div className='divide-y divide-gray-200 max-h-[600px] overflow-y-auto'>
              {candidates.map((candidate: MatchCandidate, index: number) => (
                <div key={index} className='p-4 hover:bg-gray-50'>
                  <div className='flex justify-between items-start mb-2'>
                    <div>
                      <div className='font-medium'>
                        {candidate.type === 'invoice' ? 'Faktura' : 'Kvitto'}
                      </div>
                      <div className='text-sm text-gray-500'>
                        {new Date(candidate.date).toLocaleDateString('sv-SE')}
                      </div>
                    </div>
                    <div className='text-lg font-bold'>{formatAmount(candidate.amount)}</div>
                  </div>

                  {/* Confidence Score */}
                  <div className='mb-2'>
                    <div className='flex items-center gap-2'>
                      <div className='flex-1 bg-gray-200 rounded-full h-2'>
                        <div
                          className='bg-green-500 h-2 rounded-full'
                          style={{ width: `${candidate.confidence_score * 100}%` }}
                        />
                      </div>
                      <span className='text-xs text-gray-600'>
                        {Math.round(candidate.confidence_score * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Match Reasons */}
                  <div className='mb-3'>
                    {candidate.match_reasons.map((reason, i) => (
                      <div key={i} className='text-xs text-gray-600 flex items-center gap-1'>
                        <svg
                          className='w-3 h-3 text-green-500'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                        >
                          <path
                            fillRule='evenodd'
                            d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                            clipRule='evenodd'
                          />
                        </svg>
                        {reason}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => handleMatch(candidate)}
                    disabled={matchTransaction.isPending}
                    className='w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400'
                  >
                    Matcha
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className='p-12 text-center'>
              <p className='text-gray-500 mb-4'>Inga matchningsförslag hittades</p>
              <p className='text-sm text-gray-400'>
                Du kan skapa en manuell matchning eller ignorera transaktionen
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
