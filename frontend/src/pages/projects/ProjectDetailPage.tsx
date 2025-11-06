import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  useProject,
  useProjectSummary,
  useTimeEntries,
  useCreateTimeEntry,
  useDeleteTimeEntry
} from '../../hooks/useProject';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const companyId = localStorage.getItem('currentCompanyId') || '';

  const { data: project, isLoading: projectLoading } = useProject(id || '', companyId);
  const { data: summary, isLoading: summaryLoading } = useProjectSummary(id || '', companyId);
  const { data: timeEntriesData, isLoading: entriesLoading } = useTimeEntries(companyId, {
    project_id: id
  });

  const createTimeEntry = useCreateTimeEntry();
  const deleteTimeEntry = useDeleteTimeEntry();

  const [showTimeEntryForm, setShowTimeEntryForm] = useState(false);
  const [timeEntryForm, setTimeEntryForm] = useState({
    description: '',
    entry_date: new Date().toISOString().split('T')[0],
    hours: '',
    hourly_rate: '',
    is_billable: true,
    notes: ''
  });

  const handleTimeEntryChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setTimeEntryForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleTimeEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createTimeEntry.mutateAsync({
        company_id: companyId,
        project_id: id!,
        description: timeEntryForm.description || undefined,
        entry_date: timeEntryForm.entry_date,
        hours: parseFloat(timeEntryForm.hours),
        hourly_rate: timeEntryForm.hourly_rate ? parseFloat(timeEntryForm.hourly_rate) : undefined,
        is_billable: timeEntryForm.is_billable,
        notes: timeEntryForm.notes || undefined
      });

      // Reset form
      setTimeEntryForm({
        description: '',
        entry_date: new Date().toISOString().split('T')[0],
        hours: '',
        hourly_rate: '',
        is_billable: true,
        notes: ''
      });
      setShowTimeEntryForm(false);
      alert('Tidrapport har sparats');
    } catch (error) {
      alert(`Ett fel uppstod: ${error}`);
    }
  };

  const handleDeleteTimeEntry = async (entryId: string) => {
    if (confirm('Är du säker på att du vill ta bort denna tidrapport?')) {
      try {
        await deleteTimeEntry.mutateAsync({ id: entryId, companyId });
        alert('Tidrapport har tagits bort');
      } catch (error: any) {
        alert(`Ett fel uppstod: ${error?.response?.data?.error || error}`);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      completed: 'bg-blue-100 text-blue-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    const labels = {
      active: 'Aktiv',
      inactive: 'Inaktiv',
      completed: 'Avslutad',
      cancelled: 'Avbruten'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${badges[status as keyof typeof badges]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  if (projectLoading || summaryLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar projekt...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg text-red-600'>Projektet hittades inte</div>
      </div>
    );
  }

  return (
    <div className='p-6 max-w-7xl mx-auto'>
      {/* Header */}
      <div className='flex justify-between items-start mb-6'>
        <div>
          <div className='flex items-center gap-3 mb-2'>
            <h1 className='text-3xl font-bold'>{project.name}</h1>
            {getStatusBadge(project.status)}
          </div>
          {project.customer_name && (
            <p className='text-gray-600'>Kund: {project.customer_name}</p>
          )}
        </div>
        <div className='flex gap-2'>
          <Link
            to={`/projects/${id}/edit`}
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
          >
            Redigera projekt
          </Link>
          <button
            onClick={() => navigate('/projects')}
            className='px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300'
          >
            Tillbaka
          </button>
        </div>
      </div>

      {/* Project Info */}
      <div className='grid grid-cols-1 md:grid-cols-3 gap-6 mb-6'>
        <div className='bg-white rounded-lg shadow p-6'>
          <h3 className='text-sm font-medium text-gray-500 mb-2'>Projektinformation</h3>
          <div className='space-y-2 text-sm'>
            {project.project_number && (
              <p><span className='font-medium'>Projektnummer:</span> {project.project_number}</p>
            )}
            {project.start_date && (
              <p><span className='font-medium'>Startdatum:</span> {new Date(project.start_date).toLocaleDateString('sv-SE')}</p>
            )}
            {project.end_date && (
              <p><span className='font-medium'>Slutdatum:</span> {new Date(project.end_date).toLocaleDateString('sv-SE')}</p>
            )}
            {project.estimated_hours && (
              <p><span className='font-medium'>Uppskattade timmar:</span> {project.estimated_hours}h</p>
            )}
          </div>
        </div>

        <div className='bg-white rounded-lg shadow p-6'>
          <h3 className='text-sm font-medium text-gray-500 mb-2'>Budget & Prissättning</h3>
          <div className='space-y-2 text-sm'>
            {project.budget_amount && (
              <p><span className='font-medium'>Budget:</span> {project.budget_amount.toLocaleString()} SEK</p>
            )}
            {project.hourly_rate && (
              <p><span className='font-medium'>Timtaxa:</span> {project.hourly_rate.toLocaleString()} SEK/h</p>
            )}
            <p><span className='font-medium'>Prismodell:</span> {project.fixed_price ? 'Fast pris' : 'Timbaserad'}</p>
            <p><span className='font-medium'>Debiterbart:</span> {project.is_billable ? 'Ja' : 'Nej'}</p>
          </div>
        </div>

        <div className='bg-white rounded-lg shadow p-6'>
          <h3 className='text-sm font-medium text-gray-500 mb-2'>Sammanfattning</h3>
          {summary ? (
            <div className='space-y-2 text-sm'>
              <p><span className='font-medium'>Totalt timmar:</span> {summary.total_hours}h</p>
              <p><span className='font-medium'>Debiterbara timmar:</span> {summary.billable_hours}h</p>
              <p><span className='font-medium'>Total intäkt:</span> {summary.total_revenue.toLocaleString()} SEK</p>
              <p><span className='font-medium'>Fakturerat:</span> {summary.invoiced_amount.toLocaleString()} SEK</p>
              <p><span className='font-medium'>Ej fakturerat:</span> {summary.uninvoiced_amount.toLocaleString()} SEK</p>
            </div>
          ) : (
            <p className='text-sm text-gray-500'>Laddar...</p>
          )}
        </div>
      </div>

      {project.description && (
        <div className='bg-white rounded-lg shadow p-6 mb-6'>
          <h3 className='text-lg font-semibold mb-2'>Beskrivning</h3>
          <p className='text-gray-700 whitespace-pre-wrap'>{project.description}</p>
        </div>
      )}

      {/* Time Entries */}
      <div className='bg-white rounded-lg shadow p-6'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-2xl font-bold'>Tidrapporter</h2>
          <button
            onClick={() => setShowTimeEntryForm(!showTimeEntryForm)}
            className='px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700'
          >
            {showTimeEntryForm ? 'Dölj formulär' : 'Ny tidrapport'}
          </button>
        </div>

        {/* Time Entry Form */}
        {showTimeEntryForm && (
          <form onSubmit={handleTimeEntrySubmit} className='mb-6 p-4 bg-gray-50 rounded-lg'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='col-span-2'>
                <label className='block text-sm font-medium mb-2'>Beskrivning</label>
                <input
                  type='text'
                  name='description'
                  value={timeEntryForm.description}
                  onChange={handleTimeEntryChange}
                  className='w-full px-4 py-2 border rounded-lg'
                />
              </div>

              <div>
                <label className='block text-sm font-medium mb-2'>Datum *</label>
                <input
                  type='date'
                  name='entry_date'
                  value={timeEntryForm.entry_date}
                  onChange={handleTimeEntryChange}
                  required
                  className='w-full px-4 py-2 border rounded-lg'
                />
              </div>

              <div>
                <label className='block text-sm font-medium mb-2'>Timmar *</label>
                <input
                  type='number'
                  name='hours'
                  value={timeEntryForm.hours}
                  onChange={handleTimeEntryChange}
                  step='0.25'
                  min='0'
                  required
                  className='w-full px-4 py-2 border rounded-lg'
                />
              </div>

              <div>
                <label className='block text-sm font-medium mb-2'>
                  Timtaxa (SEK) {project.hourly_rate && `(Standard: ${project.hourly_rate})`}
                </label>
                <input
                  type='number'
                  name='hourly_rate'
                  value={timeEntryForm.hourly_rate}
                  onChange={handleTimeEntryChange}
                  placeholder={project.hourly_rate?.toString() || ''}
                  step='0.01'
                  min='0'
                  className='w-full px-4 py-2 border rounded-lg'
                />
              </div>

              <div className='col-span-2'>
                <label className='block text-sm font-medium mb-2'>Anteckningar</label>
                <textarea
                  name='notes'
                  value={timeEntryForm.notes}
                  onChange={handleTimeEntryChange}
                  rows={2}
                  className='w-full px-4 py-2 border rounded-lg'
                />
              </div>

              <div className='col-span-2'>
                <label className='flex items-center'>
                  <input
                    type='checkbox'
                    name='is_billable'
                    checked={timeEntryForm.is_billable}
                    onChange={handleTimeEntryChange}
                    className='mr-2'
                  />
                  <span className='text-sm font-medium'>Debiterbar</span>
                </label>
              </div>
            </div>

            <div className='flex gap-2 mt-4'>
              <button
                type='submit'
                disabled={createTimeEntry.isPending}
                className='px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400'
              >
                Spara tidrapport
              </button>
              <button
                type='button'
                onClick={() => setShowTimeEntryForm(false)}
                className='px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300'
              >
                Avbryt
              </button>
            </div>
          </form>
        )}

        {/* Time Entries List */}
        {entriesLoading ? (
          <p className='text-center text-gray-500'>Laddar tidrapporter...</p>
        ) : timeEntriesData?.timeEntries && timeEntriesData.timeEntries.length > 0 ? (
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead className='bg-gray-50'>
                <tr>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Datum</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Beskrivning</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Användare</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Timmar</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Timtaxa</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Summa</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Status</th>
                  <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Åtgärder</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-200'>
                {timeEntriesData.timeEntries.map((entry: any) => (
                  <tr key={entry.id} className='hover:bg-gray-50'>
                    <td className='px-4 py-3 whitespace-nowrap text-sm'>
                      {new Date(entry.entry_date).toLocaleDateString('sv-SE')}
                    </td>
                    <td className='px-4 py-3 text-sm'>{entry.description || '-'}</td>
                    <td className='px-4 py-3 whitespace-nowrap text-sm text-gray-500'>
                      {entry.user_email}
                    </td>
                    <td className='px-4 py-3 whitespace-nowrap text-sm'>{entry.hours}h</td>
                    <td className='px-4 py-3 whitespace-nowrap text-sm'>
                      {entry.hourly_rate ? `${entry.hourly_rate.toLocaleString()} SEK` : '-'}
                    </td>
                    <td className='px-4 py-3 whitespace-nowrap text-sm font-medium'>
                      {entry.hourly_rate
                        ? `${(entry.hours * entry.hourly_rate).toLocaleString()} SEK`
                        : '-'}
                    </td>
                    <td className='px-4 py-3 whitespace-nowrap text-sm'>
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          entry.is_invoiced
                            ? 'bg-blue-100 text-blue-800'
                            : entry.is_billable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {entry.is_invoiced ? 'Fakturerad' : entry.is_billable ? 'Debiterbar' : 'Ej debiterbar'}
                      </span>
                    </td>
                    <td className='px-4 py-3 whitespace-nowrap text-sm'>
                      {!entry.is_invoiced && (
                        <button
                          onClick={() => handleDeleteTimeEntry(entry.id)}
                          className='text-red-600 hover:text-red-800'
                          disabled={deleteTimeEntry.isPending}
                        >
                          Ta bort
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className='text-center text-gray-500 py-8'>
            Inga tidrapporter ännu. Klicka på "Ny tidrapport" för att lägga till en.
          </p>
        )}
      </div>
    </div>
  );
}
