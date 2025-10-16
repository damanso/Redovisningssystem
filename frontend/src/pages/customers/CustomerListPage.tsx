import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCustomers, useDeleteCustomer } from '../../hooks/useCustomer';

export default function CustomerListPage() {
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [search, setSearch] = useState('');
  
  const { data, isLoading, error } = useCustomers(companyId, { search });
  const deleteCustomer = useDeleteCustomer();
  
  const handleDelete = async (id: string) => {
    if (confirm('Är du säker på att du vill ta bort denna kund?')) {
      try {
        await deleteCustomer.mutateAsync({ id, companyId });
        alert('Kunden har tagits bort');
      } catch (error) {
        alert('Kunde inte ta bort kunden');
      }
    }
  };
  
  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar kunder...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg text-red-600'>Ett fel uppstod vid laddning av kunder</div>
      </div>
    );
  }
  
  return (
    <div className='p-6 max-w-7xl mx-auto'>
      <div className='flex justify-between items-center mb-6'>
        <h1 className='text-3xl font-bold'>Kunder</h1>
        <Link
          to='/customers/new'
          className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
        >
          Ny kund
        </Link>
      </div>
      
      {/* Search */}
      <div className='mb-6'>
        <input
          type='search'
          placeholder='Sök kunder...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='w-full px-4 py-2 border rounded-lg'
        />
      </div>
      
      {/* Customer List */}
      <div className='bg-white rounded-lg shadow overflow-hidden'>
        {data?.customers && data.customers.length > 0 ? (
          <table className='w-full'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Namn</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Organisationsnummer</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Email</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Telefon</th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'>Åtgärder</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200'>
              {data.customers.map((customer: any) => (
                <tr key={customer.id} className='hover:bg-gray-50'>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <Link 
                      to={`/customers/${customer.id}`}
                      className='text-blue-600 hover:text-blue-800 font-medium'
                    >
                      {customer.name}
                    </Link>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {customer.org_number || '-'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {customer.email || '-'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
                    {customer.phone || '-'}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-sm'>
                    <Link
                      to={`/customers/${customer.id}/edit`}
                      className='text-blue-600 hover:text-blue-800 mr-4'
                    >
                      Redigera
                    </Link>
                    <button
                      onClick={() => handleDelete(customer.id)}
                      className='text-red-600 hover:text-red-800'
                      disabled={deleteCustomer.isPending}
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
            Inga kunder hittades. <Link to='/customers/new' className='text-blue-600 hover:text-blue-800'>Skapa din första kund</Link>
          </div>
        )}
      </div>
      
      {data?.total && (
        <div className='mt-4 text-sm text-gray-600'>
          Visar {data.customers.length} av {data.total} kunder
        </div>
      )}
    </div>
  );
}
