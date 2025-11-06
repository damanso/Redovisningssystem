import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useRecurringInvoices,
  useDeleteRecurringInvoice,
  usePauseRecurringInvoice,
  useResumeRecurringInvoice,
  useGenerateInvoice,
  useRecurringInvoiceStats
} from '../../hooks/useRecurringInvoice';
import type { RecurringStatus } from '../../types/recurringInvoice.types';

export default function RecurringInvoiceListPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RecurringStatus | ''>('');

  const { data, isLoading, error } = useRecurringInvoices({
    search,
    status: statusFilter || undefined
  });
  const { data: stats } = useRecurringInvoiceStats();

  const deleteRecurring = useDeleteRecurringInvoice();
  const pauseRecurring = usePauseRecurringInvoice();
  const resumeRecurring = useResumeRecurringInvoice();
  const generateInvoice = useGenerateInvoice();

  const handleDelete = async (id: string) => {
    if (confirm('Är du säker på att du vill ta bort denna återkommande faktura?')) {
      try {
        await deleteRecurring.mutateAsync(id);
        alert('Återkommande faktura borttagen');
      } catch (error) {
        alert('Kunde inte ta bort återkommande faktura');
      }
    }
  };

  const handlePause = async (id: string) => {
    try {
      await pauseRecurring.mutateAsync(id);
      alert('Återkommande faktura pausad');
    } catch (error) {
      alert('Kunde inte pausa återkommande faktura');
    }
  };

  const handleResume = async (id: string) => {
    try {
      await resumeRecurring.mutateAsync(id);
      alert('Återkommande faktura återupptagen');
    } catch (error) {
      alert('Kunde inte återuppta återkommande faktura');
    }
  };

  const handleGenerate = async (id: string) => {
    if (confirm('Vill du generera en faktura nu från denna mall?')) {
      try {
        await generateInvoice.mutateAsync({ id });
        alert('Faktura genererad');
      } catch (error: any) {
        alert(`Kunde inte generera faktura: ${error.response?.data?.error || error.message}`);
      }
    }
  };

  const getFrequencyText = (frequency: string) => {
    const map: Record<string, string> = {
      daily: 'Dagligen',
      weekly: 'Veckovis',
      monthly: 'Månadsvis',
      quarterly: 'Kvartalsvis',
      yearly: 'Årligen'
    };
    return map[frequency] || frequency;
  };

  const getStatusBadge = (status: RecurringStatus) => {
    const styles: Record<RecurringStatus, string> = {
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-blue-100 text-blue-800',
      cancelled: 'bg-red-100 text-red-800'
    };

    const labels: Record<RecurringStatus, string> = {
      active: 'Aktiv',
      paused: 'Pausad',
      completed: 'Slutförd',
      cancelled: 'Avbruten'
    };

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar återkommande fakturor...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg text-red-600'>Ett fel uppstod vid laddning</div>
      </div>
    );
  }

  return (
    <div className='p-6 max-w-7xl mx-auto'>
      <div className='flex justify-between items-center mb-6'>
        <h1 className='text-3xl font-bold'>Återkommande Fakturor</h1>
        <Link
          to='/recurring-invoices/new'
          className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
        >
          Ny återkommande faktura
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className='grid grid-cols-1 md:grid-cols-5 gap-4 mb-6'>
          <div className='bg-white p-4 rounded-lg shadow'>
            <div className='text-sm text-gray-500'>Totalt</div>
            <div className='text-2xl font-bold'>{stats.total_recurring}</div>
          </div>
          <div className='bg-green-50 p-4 rounded-lg shadow'>
            <div className='text-sm text-gray-500'>Aktiva</div>
            <div className='text-2xl font-bold text-green-600'>{stats.active_recurring}</div>
          </div>
          <div className='bg-yellow-50 p-4 rounded-lg shadow'>
            <div className='text-sm text-gray-500'>Pausade</div>
            <div className='text-2xl font-bold text-yellow-600'>{stats.paused_recurring}</div>
          </div>
          <div className='bg-blue-50 p-4 rounded-lg shadow'>
            <div className='text-sm text-gray-500'>Genererade</div>
            <div className='text-2xl font-bold text-blue-600'>{stats.total_generated}</div>
          </div>
          <div className='bg-purple-50 p-4 rounded-lg shadow'>
            <div className='text-sm text-gray-500'>Väntande</div>
            <div className='text-2xl font-bold text-purple-600'>{stats.pending_generation}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className='mb-6 flex gap-4'>
        <input
          type='search'
          placeholder='Sök...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='flex-1 px-4 py-2 border rounded-lg'
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RecurringStatus | '')}
          className='px-4 py-2 border rounded-lg'
        >
          <option value=''>Alla statusar</option>
          <option value='active'>Aktiv</option>
          <option value='paused'>Pausad</option>
          <option value='completed'>Slutförd</option>
          <option value='cancelled'>Avbruten</option>
        </select>
      </div>

      {/* List */}
      <div className='bg-white rounded-lg shadow overflow-hidden'>
        {data?.recurring_invoices && data.recurring_invoices.length > 0 ? (
          <table className='w-full'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Mall</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Kund</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Frekvens</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Nästa datum</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Genererade</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Status</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Åtgärder</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200'>
              {data.recurring_invoices.map((recurring: any) => (
                <tr key={recurring.id} className='hover:bg-gray-50'>
                  <td className='px-6 py-4'>
                    <Link
                      to={`/recurring-invoices/${recurring.id}`}
                      className='text-blue-600 hover:text-blue-800 font-medium'
                    >
                      {recurring.template_name}
                    </Link>
                  </td>
                  <td className='px-6 py-4 text-sm text-gray-500'>
                    {recurring.customer_name}
                  </td>
                  <td className='px-6 py-4 text-sm text-gray-500'>
                    {getFrequencyText(recurring.frequency)}
                    {recurring.interval_count > 1 && ` (var ${recurring.interval_count})`}
                  </td>
                  <td className='px-6 py-4 text-sm text-gray-500'>
                    {new Date(recurring.next_generation_date).toLocaleDateString('sv-SE')}
                  </td>
                  <td className='px-6 py-4 text-sm text-gray-500'>
                    {recurring.generated_count}
                    {recurring.max_occurrences && ` / ${recurring.max_occurrences}`}
                  </td>
                  <td className='px-6 py-4'>
                    {getStatusBadge(recurring.status)}
                  </td>
                  <td className='px-6 py-4 text-sm space-x-2'>
                    {recurring.status === 'active' && (
                      <>
                        <button
                          onClick={() => handleGenerate(recurring.id)}
                          className='text-green-600 hover:text-green-800'
                        >
                          Generera
                        </button>
                        <button
                          onClick={() => handlePause(recurring.id)}
                          className='text-yellow-600 hover:text-yellow-800'
                        >
                          Pausa
                        </button>
                      </>
                    )}
                    {recurring.status === 'paused' && (
                      <button
                        onClick={() => handleResume(recurring.id)}
                        className='text-green-600 hover:text-green-800'
                      >
                        Återuppta
                      </button>
                    )}
                    <Link
                      to={`/recurring-invoices/${recurring.id}/edit`}
                      className='text-blue-600 hover:text-blue-800'
                    >
                      Redigera
                    </Link>
                    <button
                      onClick={() => handleDelete(recurring.id)}
                      className='text-red-600 hover:text-red-800'
                    >
                      Ta bort
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className='p-6 text-center text-gray-500'>
            Inga återkommande fakturor hittades
          </div>
        )}
      </div>
    </div>
  );
}
