import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects, useDeleteProject } from '../../hooks/useProject';

export default function ProjectListPage() {
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data, isLoading, error } = useProjects(companyId, {
    search,
    status: statusFilter || undefined
  });
  const deleteProject = useDeleteProject();

  const handleDelete = async (id: string) => {
    if (confirm('Är du säker på att du vill ta bort detta projekt?')) {
      try {
        await deleteProject.mutateAsync({ id, companyId });
        alert('Projektet har tagits bort');
      } catch (error) {
        alert('Kunde inte ta bort projektet');
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

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar projekt...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg text-red-600'>Ett fel uppstod vid laddning av projekt</div>
      </div>
    );
  }

  return (
    <div className='p-6 max-w-7xl mx-auto'>
      <div className='flex justify-between items-center mb-6'>
        <h1 className='text-3xl font-bold'>Projekt</h1>
        <Link
          to='/projects/new'
          className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
        >
          Nytt projekt
        </Link>
      </div>

      {/* Filters */}
      <div className='mb-6 grid grid-cols-1 md:grid-cols-2 gap-4'>
        <input
          type='search'
          placeholder='Sök projekt...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='px-4 py-2 border rounded-lg'
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className='px-4 py-2 border rounded-lg'
        >
          <option value=''>Alla statusar</option>
          <option value='active'>Aktiv</option>
          <option value='inactive'>Inaktiv</option>
          <option value='completed'>Avslutad</option>
          <option value='cancelled'>Avbruten</option>
        </select>
      </div>

      {/* Project List */}
      <div className='bg-white rounded-lg shadow overflow-hidden'>
        {data?.projects && data.projects.length > 0 ? (
          <table className='w-full'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Namn</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Kund</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Status</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Projektnummer</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Budget</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Åtgärder</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200'>
              {data.projects.map((project: any) => (
                <tr key={project.id} className='hover:bg-gray-50'>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <Link
                      to={`/projects/${project.id}`}
                      className='text-blue-600 hover:text-blue-800 font-medium'
                    >
                      {project.name}
                    </Link>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {project.customer_name || '-'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    {getStatusBadge(project.status)}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {project.project_number || '-'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {project.budget_amount ? `${project.budget_amount.toLocaleString()} SEK` : '-'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm'>
                    <Link
                      to={`/projects/${project.id}/edit`}
                      className='text-blue-600 hover:text-blue-800 mr-4'
                    >
                      Redigera
                    </Link>
                    <button
                      onClick={() => handleDelete(project.id)}
                      className='text-red-600 hover:text-red-800'
                      disabled={deleteProject.isPending}
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
            Inga projekt hittades. <Link to='/projects/new' className='text-blue-600 hover:text-blue-800'>Skapa ditt första projekt</Link>
          </div>
        )}
      </div>

      {data?.total && (
        <div className='mt-4 text-sm text-gray-600'>
          Visar {data.projects.length} av {data.total} projekt
        </div>
      )}
    </div>
  );
}
