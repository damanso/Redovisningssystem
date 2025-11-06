import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useRecurringInvoice,
  useCreateRecurringInvoice,
  useUpdateRecurringInvoice
} from '../../hooks/useRecurringInvoice';
import { useCustomers } from '../../hooks/useCustomer';
import type { CreateRecurringInvoiceDto, RecurringFrequency } from '../../types/recurringInvoice.types';

export default function RecurringInvoiceFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const companyId = localStorage.getItem('currentCompanyId') || '';

  const { data: recurring, isLoading } = useRecurringInvoice(id || '');
  const { data: customersData } = useCustomers(companyId);
  const createRecurring = useCreateRecurringInvoice();
  const updateRecurring = useUpdateRecurringInvoice();

  const [formData, setFormData] = useState<CreateRecurringInvoiceDto>({
    customer_id: '',
    template_name: '',
    payment_terms: 30,
    reference: '',
    notes: '',
    frequency: 'monthly',
    interval_count: 1,
    start_date: new Date().toISOString().split('T')[0],
    lines: [
      {
        description: '',
        quantity: 1,
        unit_price: 0,
        unit: 'st',
        vat_rate: 25
      }
    ]
  });

  useEffect(() => {
    if (recurring && id) {
      setFormData({
        customer_id: recurring.customer_id,
        template_name: recurring.template_name,
        payment_terms: recurring.payment_terms,
        reference: recurring.reference || '',
        notes: recurring.notes || '',
        frequency: recurring.frequency,
        interval_count: recurring.interval_count,
        start_date: recurring.start_date.split('T')[0],
        end_date: recurring.end_date?.split('T')[0],
        max_occurrences: recurring.max_occurrences,
        lines: recurring.lines || []
      });
    }
  }, [recurring, id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (id) {
        await updateRecurring.mutateAsync({ id, data: formData });
        alert('Återkommande faktura uppdaterad');
      } else {
        await createRecurring.mutateAsync(formData);
        alert('Återkommande faktura skapad');
      }
      navigate('/recurring-invoices');
    } catch (error: any) {
      alert(`Fel: ${error.response?.data?.error || error.message}`);
    }
  };

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          description: '',
          quantity: 1,
          unit_price: 0,
          unit: 'st',
          vat_rate: 25
        }
      ]
    });
  };

  const removeLine = (index: number) => {
    setFormData({
      ...formData,
      lines: formData.lines.filter((_, i) => i !== index)
    });
  };

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines];
    (newLines[index] as any)[field] = value;
    setFormData({ ...formData, lines: newLines });
  };

  if (isLoading && id) {
    return <div className='p-6'>Laddar...</div>;
  }

  return (
    <div className='p-6 max-w-4xl mx-auto'>
      <h1 className='text-3xl font-bold mb-6'>
        {id ? 'Redigera' : 'Ny'} återkommande faktura
      </h1>

      <form onSubmit={handleSubmit} className='space-y-6 bg-white p-6 rounded-lg shadow'>
        {/* Basic Info */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Mallnamn *
            </label>
            <input
              type='text'
              required
              value={formData.template_name}
              onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
              className='w-full px-3 py-2 border rounded-lg'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Kund *
            </label>
            <select
              required
              value={formData.customer_id}
              onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })}
              className='w-full px-3 py-2 border rounded-lg'
            >
              <option value=''>Välj kund</option>
              {customersData?.customers?.map((customer: any) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Frekvens *
            </label>
            <select
              required
              value={formData.frequency}
              onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RecurringFrequency })}
              className='w-full px-3 py-2 border rounded-lg'
            >
              <option value='daily'>Dagligen</option>
              <option value='weekly'>Veckovis</option>
              <option value='monthly'>Månadsvis</option>
              <option value='quarterly'>Kvartalsvis</option>
              <option value='yearly'>Årligen</option>
            </select>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Intervall
            </label>
            <input
              type='number'
              min='1'
              value={formData.interval_count}
              onChange={(e) => setFormData({ ...formData, interval_count: parseInt(e.target.value) })}
              className='w-full px-3 py-2 border rounded-lg'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Startdatum *
            </label>
            <input
              type='date'
              required
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              className='w-full px-3 py-2 border rounded-lg'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Slutdatum (valfritt)
            </label>
            <input
              type='date'
              value={formData.end_date || ''}
              onChange={(e) => setFormData({ ...formData, end_date: e.target.value || undefined })}
              className='w-full px-3 py-2 border rounded-lg'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Betalningsvillkor (dagar)
            </label>
            <input
              type='number'
              value={formData.payment_terms}
              onChange={(e) => setFormData({ ...formData, payment_terms: parseInt(e.target.value) })}
              className='w-full px-3 py-2 border rounded-lg'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Max antal (valfritt)
            </label>
            <input
              type='number'
              min='1'
              value={formData.max_occurrences || ''}
              onChange={(e) => setFormData({ ...formData, max_occurrences: e.target.value ? parseInt(e.target.value) : undefined })}
              className='w-full px-3 py-2 border rounded-lg'
            />
          </div>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 mb-1'>
            Referens
          </label>
          <input
            type='text'
            value={formData.reference}
            onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
            className='w-full px-3 py-2 border rounded-lg'
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 mb-1'>
            Anteckningar
          </label>
          <textarea
            rows={3}
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className='w-full px-3 py-2 border rounded-lg'
          />
        </div>

        {/* Lines */}
        <div>
          <div className='flex justify-between items-center mb-2'>
            <label className='block text-sm font-medium text-gray-700'>
              Fakturarader *
            </label>
            <button
              type='button'
              onClick={addLine}
              className='px-3 py-1 bg-blue-600 text-white rounded text-sm'
            >
              + Lägg till rad
            </button>
          </div>

          <div className='space-y-2'>
            {formData.lines.map((line, index) => (
              <div key={index} className='flex gap-2 items-start bg-gray-50 p-3 rounded'>
                <input
                  type='text'
                  placeholder='Beskrivning'
                  required
                  value={line.description}
                  onChange={(e) => updateLine(index, 'description', e.target.value)}
                  className='flex-1 px-2 py-1 border rounded'
                />
                <input
                  type='number'
                  placeholder='Antal'
                  required
                  min='0'
                  step='0.01'
                  value={line.quantity}
                  onChange={(e) => updateLine(index, 'quantity', parseFloat(e.target.value))}
                  className='w-20 px-2 py-1 border rounded'
                />
                <input
                  type='number'
                  placeholder='Pris'
                  required
                  min='0'
                  step='0.01'
                  value={line.unit_price}
                  onChange={(e) => updateLine(index, 'unit_price', parseFloat(e.target.value))}
                  className='w-24 px-2 py-1 border rounded'
                />
                <input
                  type='text'
                  placeholder='Enhet'
                  value={line.unit}
                  onChange={(e) => updateLine(index, 'unit', e.target.value)}
                  className='w-16 px-2 py-1 border rounded'
                />
                <input
                  type='number'
                  placeholder='Moms%'
                  required
                  min='0'
                  max='100'
                  step='0.01'
                  value={line.vat_rate}
                  onChange={(e) => updateLine(index, 'vat_rate', parseFloat(e.target.value))}
                  className='w-20 px-2 py-1 border rounded'
                />
                {formData.lines.length > 1 && (
                  <button
                    type='button'
                    onClick={() => removeLine(index)}
                    className='px-2 py-1 bg-red-600 text-white rounded text-sm'
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className='flex gap-4'>
          <button
            type='submit'
            className='px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
          >
            {id ? 'Uppdatera' : 'Skapa'}
          </button>
          <button
            type='button'
            onClick={() => navigate('/recurring-invoices')}
            className='px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400'
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}
