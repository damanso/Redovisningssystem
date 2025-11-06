import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  useRecurringInvoice,
  useRecurringInvoiceHistory,
  usePauseRecurringInvoice,
  useResumeRecurringInvoice,
  useCancelRecurringInvoice,
  useGenerateInvoice
} from '../../hooks/useRecurringInvoice';

export default function RecurringInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: recurring, isLoading } = useRecurringInvoice(id || '');
  const { data: history } = useRecurringInvoiceHistory(id || '');

  const pauseRecurring = usePauseRecurringInvoice();
  const resumeRecurring = useResumeRecurringInvoice();
  const cancelRecurring = useCancelRecurringInvoice();
  const generateInvoice = useGenerateInvoice();

  const handlePause = async () => {
    if (!id) return;
    try {
      await pauseRecurring.mutateAsync(id);
      alert('Återkommande faktura pausad');
    } catch (error) {
      alert('Kunde inte pausa återkommande faktura');
    }
  };

  const handleResume = async () => {
    if (!id) return;
    try {
      await resumeRecurring.mutateAsync(id);
      alert('Återkommande faktura återupptagen');
    } catch (error) {
      alert('Kunde inte återuppta återkommande faktura');
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    if (confirm('Är du säker på att du vill avbryta denna återkommande faktura?')) {
      try {
        await cancelRecurring.mutateAsync(id);
        alert('Återkommande faktura avbruten');
      } catch (error) {
        alert('Kunde inte avbryta återkommande faktura');
      }
    }
  };

  const handleGenerate = async () => {
    if (!id) return;
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

  const calculateLineTotal = (line: any) => {
    const subtotal = line.quantity * line.unit_price;
    const vat = subtotal * (line.vat_rate / 100);
    return subtotal + vat;
  };

  const calculateTotals = () => {
    if (!recurring?.lines) return { subtotal: 0, vat: 0, total: 0 };

    let subtotal = 0;
    let vat = 0;

    recurring.lines.forEach((line: any) => {
      const lineSubtotal = line.quantity * line.unit_price;
      const lineVat = lineSubtotal * (line.vat_rate / 100);
      subtotal += lineSubtotal;
      vat += lineVat;
    });

    return {
      subtotal,
      vat,
      total: subtotal + vat
    };
  };

  if (isLoading) {
    return <div className='p-6'>Laddar...</div>;
  }

  if (!recurring) {
    return <div className='p-6 text-red-600'>Återkommande faktura hittades inte</div>;
  }

  const totals = calculateTotals();

  return (
    <div className='p-6 max-w-5xl mx-auto'>
      <div className='flex justify-between items-start mb-6'>
        <div>
          <h1 className='text-3xl font-bold'>{recurring.template_name}</h1>
          <p className='text-gray-500 mt-1'>Återkommande faktura</p>
        </div>

        <div className='flex gap-2'>
          {recurring.status === 'active' && (
            <>
              <button
                onClick={handleGenerate}
                className='px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700'
              >
                Generera nu
              </button>
              <button
                onClick={handlePause}
                className='px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700'
              >
                Pausa
              </button>
            </>
          )}
          {recurring.status === 'paused' && (
            <button
              onClick={handleResume}
              className='px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700'
            >
              Återuppta
            </button>
          )}
          {(recurring.status === 'active' || recurring.status === 'paused') && (
            <button
              onClick={handleCancel}
              className='px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700'
            >
              Avbryt
            </button>
          )}
          <Link
            to={`/recurring-invoices/${id}/edit`}
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
          >
            Redigera
          </Link>
        </div>
      </div>

      {/* Details */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-6 mb-6'>
        <div className='bg-white p-6 rounded-lg shadow'>
          <h2 className='text-xl font-semibold mb-4'>Detaljer</h2>
          <dl className='space-y-2'>
            <div>
              <dt className='text-sm text-gray-500'>Kund</dt>
              <dd className='font-medium'>{recurring.customer_name}</dd>
            </div>
            <div>
              <dt className='text-sm text-gray-500'>Status</dt>
              <dd className='font-medium'>{recurring.status}</dd>
            </div>
            <div>
              <dt className='text-sm text-gray-500'>Frekvens</dt>
              <dd className='font-medium'>
                {getFrequencyText(recurring.frequency)}
                {recurring.interval_count > 1 && ` (var ${recurring.interval_count})`}
              </dd>
            </div>
            <div>
              <dt className='text-sm text-gray-500'>Betalningsvillkor</dt>
              <dd className='font-medium'>{recurring.payment_terms} dagar</dd>
            </div>
          </dl>
        </div>

        <div className='bg-white p-6 rounded-lg shadow'>
          <h2 className='text-xl font-semibold mb-4'>Schema</h2>
          <dl className='space-y-2'>
            <div>
              <dt className='text-sm text-gray-500'>Startdatum</dt>
              <dd className='font-medium'>{new Date(recurring.start_date).toLocaleDateString('sv-SE')}</dd>
            </div>
            {recurring.end_date && (
              <div>
                <dt className='text-sm text-gray-500'>Slutdatum</dt>
                <dd className='font-medium'>{new Date(recurring.end_date).toLocaleDateString('sv-SE')}</dd>
              </div>
            )}
            <div>
              <dt className='text-sm text-gray-500'>Nästa generering</dt>
              <dd className='font-medium'>{new Date(recurring.next_generation_date).toLocaleDateString('sv-SE')}</dd>
            </div>
            {recurring.last_generated_date && (
              <div>
                <dt className='text-sm text-gray-500'>Senast genererad</dt>
                <dd className='font-medium'>{new Date(recurring.last_generated_date).toLocaleDateString('sv-SE')}</dd>
              </div>
            )}
            <div>
              <dt className='text-sm text-gray-500'>Genererade</dt>
              <dd className='font-medium'>
                {recurring.generated_count}
                {recurring.max_occurrences && ` / ${recurring.max_occurrences}`}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Lines */}
      <div className='bg-white p-6 rounded-lg shadow mb-6'>
        <h2 className='text-xl font-semibold mb-4'>Fakturarader</h2>
        <table className='w-full'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='px-4 py-2 text-left text-sm font-medium text-gray-500'>Beskrivning</th>
              <th className='px-4 py-2 text-right text-sm font-medium text-gray-500'>Antal</th>
              <th className='px-4 py-2 text-right text-sm font-medium text-gray-500'>Pris</th>
              <th className='px-4 py-2 text-right text-sm font-medium text-gray-500'>Moms%</th>
              <th className='px-4 py-2 text-right text-sm font-medium text-gray-500'>Totalt</th>
            </tr>
          </thead>
          <tbody className='divide-y'>
            {recurring.lines?.map((line: any) => (
              <tr key={line.id}>
                <td className='px-4 py-2'>{line.description}</td>
                <td className='px-4 py-2 text-right'>{line.quantity} {line.unit}</td>
                <td className='px-4 py-2 text-right'>{line.unit_price.toFixed(2)} kr</td>
                <td className='px-4 py-2 text-right'>{line.vat_rate}%</td>
                <td className='px-4 py-2 text-right'>{calculateLineTotal(line).toFixed(2)} kr</td>
              </tr>
            ))}
          </tbody>
          <tfoot className='bg-gray-50'>
            <tr>
              <td colSpan={4} className='px-4 py-2 text-right font-medium'>Delsumma:</td>
              <td className='px-4 py-2 text-right font-medium'>{totals.subtotal.toFixed(2)} kr</td>
            </tr>
            <tr>
              <td colSpan={4} className='px-4 py-2 text-right font-medium'>Moms:</td>
              <td className='px-4 py-2 text-right font-medium'>{totals.vat.toFixed(2)} kr</td>
            </tr>
            <tr>
              <td colSpan={4} className='px-4 py-2 text-right font-bold'>Totalt:</td>
              <td className='px-4 py-2 text-right font-bold'>{totals.total.toFixed(2)} kr</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* History */}
      <div className='bg-white p-6 rounded-lg shadow'>
        <h2 className='text-xl font-semibold mb-4'>Genererade fakturor</h2>
        {history && history.length > 0 ? (
          <table className='w-full'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-2 text-left text-sm font-medium text-gray-500'>Fakturanummer</th>
                <th className='px-4 py-2 text-left text-sm font-medium text-gray-500'>Genererad</th>
                <th className='px-4 py-2 text-left text-sm font-medium text-gray-500'>Period</th>
                <th className='px-4 py-2 text-left text-sm font-medium text-gray-500'>Status</th>
                <th className='px-4 py-2 text-right text-sm font-medium text-gray-500'>Belopp</th>
              </tr>
            </thead>
            <tbody className='divide-y'>
              {history.map((item: any) => (
                <tr key={item.id}>
                  <td className='px-4 py-2'>
                    <Link
                      to={`/invoices/${item.invoice_id}`}
                      className='text-blue-600 hover:text-blue-800'
                    >
                      {item.invoice_number}
                    </Link>
                  </td>
                  <td className='px-4 py-2'>
                    {new Date(item.generated_date).toLocaleDateString('sv-SE')}
                  </td>
                  <td className='px-4 py-2 text-sm text-gray-500'>
                    {item.period_start && item.period_end &&
                      `${new Date(item.period_start).toLocaleDateString('sv-SE')} - ${new Date(item.period_end).toLocaleDateString('sv-SE')}`
                    }
                  </td>
                  <td className='px-4 py-2'>{item.invoice_status}</td>
                  <td className='px-4 py-2 text-right'>
                    {item.invoice_total ? `${item.invoice_total.toFixed(2)} kr` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className='text-gray-500'>Inga fakturor har genererats än</p>
        )}
      </div>

      <div className='mt-6'>
        <Link
          to='/recurring-invoices'
          className='text-blue-600 hover:text-blue-800'
        >
          ← Tillbaka till lista
        </Link>
      </div>
    </div>
  );
}
