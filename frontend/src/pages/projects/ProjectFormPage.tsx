import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject, useCreateProject, useUpdateProject } from '../../hooks/useProject';
import { useCustomers } from '../../hooks/useCustomer';

export default function ProjectFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const companyId = localStorage.getItem('currentCompanyId') || '';

  const { data: project } = useProject(id || '', companyId);
  const { data: customersData } = useCustomers(companyId);
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    customer_id: '',
    project_number: '',
    status: 'active',
    start_date: '',
    end_date: '',
    estimated_hours: '',
    budget_amount: '',
    hourly_rate: '',
    fixed_price: false,
    is_billable: true
  });

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        description: project.description || '',
        customer_id: project.customer_id || '',
        project_number: project.project_number || '',
        status: project.status || 'active',
        start_date: project.start_date ? project.start_date.split('T')[0] : '',
        end_date: project.end_date ? project.end_date.split('T')[0] : '',
        estimated_hours: project.estimated_hours?.toString() || '',
        budget_amount: project.budget_amount?.toString() || '',
        hourly_rate: project.hourly_rate?.toString() || '',
        fixed_price: project.fixed_price || false,
        is_billable: project.is_billable !== undefined ? project.is_billable : true
      });
    }
  }, [project]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const submitData = {
        company_id: companyId,
        name: formData.name,
        description: formData.description || undefined,
        customer_id: formData.customer_id || undefined,
        project_number: formData.project_number || undefined,
        status: formData.status as 'active' | 'inactive' | 'completed' | 'cancelled',
        start_date: formData.start_date || undefined,
        end_date: formData.end_date || undefined,
        estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : undefined,
        budget_amount: formData.budget_amount ? parseFloat(formData.budget_amount) : undefined,
        hourly_rate: formData.hourly_rate ? parseFloat(formData.hourly_rate) : undefined,
        fixed_price: formData.fixed_price,
        is_billable: formData.is_billable
      };

      if (isEdit && id) {
        await updateProject.mutateAsync({
          id,
          companyId,
          data: submitData
        });
        alert('Projektet har uppdaterats');
      } else {
        await createProject.mutateAsync(submitData);
        alert('Projektet har skapats');
      }
      navigate('/projects');
    } catch (error) {
      alert(`Ett fel uppstod: ${error}`);
    }
  };

  return (
    <div className='p-6 max-w-4xl mx-auto'>
      <h1 className='text-3xl font-bold mb-6'>
        {isEdit ? 'Redigera projekt' : 'Nytt projekt'}
      </h1>

      <form onSubmit={handleSubmit} className='space-y-6'>
        {/* Grundläggande information */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Grundläggande information</h2>

          <div className='grid grid-cols-2 gap-4'>
            <div className='col-span-2'>
              <label className='block text-sm font-medium mb-2'>
                Projektnamn *
              </label>
              <input
                type='text'
                name='name'
                value={formData.name}
                onChange={handleChange}
                required
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div className='col-span-2'>
              <label className='block text-sm font-medium mb-2'>
                Beskrivning
              </label>
              <textarea
                name='description'
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-2'>
                Kund
              </label>
              <select
                name='customer_id'
                value={formData.customer_id}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              >
                <option value=''>Välj kund (valfritt)</option>
                {customersData?.customers?.map((customer: any) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className='block text-sm font-medium mb-2'>
                Projektnummer
              </label>
              <input
                type='text'
                name='project_number'
                value={formData.project_number}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-2'>
                Status
              </label>
              <select
                name='status'
                value={formData.status}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              >
                <option value='active'>Aktiv</option>
                <option value='inactive'>Inaktiv</option>
                <option value='completed'>Avslutad</option>
                <option value='cancelled'>Avbruten</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tidsplan */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Tidsplan</h2>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='block text-sm font-medium mb-2'>
                Startdatum
              </label>
              <input
                type='date'
                name='start_date'
                value={formData.start_date}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-2'>
                Slutdatum
              </label>
              <input
                type='date'
                name='end_date'
                value={formData.end_date}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div className='col-span-2'>
              <label className='block text-sm font-medium mb-2'>
                Uppskattade timmar
              </label>
              <input
                type='number'
                name='estimated_hours'
                value={formData.estimated_hours}
                onChange={handleChange}
                step='0.01'
                min='0'
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
          </div>
        </div>

        {/* Budget och prissättning */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Budget och prissättning</h2>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='block text-sm font-medium mb-2'>
                Budget (SEK)
              </label>
              <input
                type='number'
                name='budget_amount'
                value={formData.budget_amount}
                onChange={handleChange}
                step='0.01'
                min='0'
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-2'>
                Timtaxa (SEK)
              </label>
              <input
                type='number'
                name='hourly_rate'
                value={formData.hourly_rate}
                onChange={handleChange}
                step='0.01'
                min='0'
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>

            <div className='col-span-2 space-y-2'>
              <label className='flex items-center'>
                <input
                  type='checkbox'
                  name='fixed_price'
                  checked={formData.fixed_price}
                  onChange={handleChange}
                  className='mr-2'
                />
                <span className='text-sm font-medium'>Fast pris (ej timbaserat)</span>
              </label>

              <label className='flex items-center'>
                <input
                  type='checkbox'
                  name='is_billable'
                  checked={formData.is_billable}
                  onChange={handleChange}
                  className='mr-2'
                />
                <span className='text-sm font-medium'>Debiterbart projekt</span>
              </label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className='flex gap-4'>
          <button
            type='submit'
            disabled={createProject.isPending || updateProject.isPending}
            className='px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400'
          >
            {isEdit ? 'Uppdatera' : 'Skapa'}
          </button>
          <button
            type='button'
            onClick={() => navigate('/projects')}
            className='px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300'
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}
