import { Link, useParams } from 'react-router-dom';
import { useCustomer } from '../../hooks/useCustomer';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const companyId = localStorage.getItem('currentCompanyId') || '';
  
  const { data: customer, isLoading, error } = useCustomer(id || '', companyId);
  
  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg'>Laddar kunduppgifter...</div>
      </div>
    );
  }
  
  if (error || !customer) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-lg text-red-600'>Kunden kunde inte hittas</div>
      </div>
    );
  }
  
  return (
    <div className='p-6 max-w-4xl mx-auto'>
      <div className='flex justify-between items-start mb-6'>
        <div>
          <h1 className='text-3xl font-bold'>{customer.name}</h1>
          {customer.org_number && (
            <p className='text-gray-600 mt-1'>Org.nr: {customer.org_number}</p>
          )}
        </div>
        
        <div className='flex gap-2'>
          <Link
            to={`/customers/${id}/edit`}
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
          >
            Redigera
          </Link>
          <Link
            to='/customers'
            className='px-4 py-2 border rounded-lg hover:bg-gray-50'
          >
            Tillbaka
          </Link>
        </div>
      </div>
      
      {/* Kontaktinformation */}
      <div className='bg-white rounded-lg shadow p-6 mb-6'>
        <h2 className='text-xl font-semibold mb-4'>Kontaktinformation</h2>
        
        <div className='grid grid-cols-2 gap-4'>
          {customer.contact_person && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Kontaktperson</label>
              <p className='mt-1'>{customer.contact_person}</p>
            </div>
          )}
          
          {customer.email && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Email</label>
              <p className='mt-1'>
                <a href={`mailto:${customer.email}`} className='text-blue-600 hover:text-blue-800'>
                  {customer.email}
                </a>
              </p>
            </div>
          )}
          
          {customer.phone && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Telefon</label>
              <p className='mt-1'>
                <a href={`tel:${customer.phone}`} className='text-blue-600 hover:text-blue-800'>
                  {customer.phone}
                </a>
              </p>
            </div>
          )}
          
          {customer.mobile && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Mobil</label>
              <p className='mt-1'>
                <a href={`tel:${customer.mobile}`} className='text-blue-600 hover:text-blue-800'>
                  {customer.mobile}
                </a>
              </p>
            </div>
          )}
          
          {customer.website && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Webbplats</label>
              <p className='mt-1'>
                <a 
                  href={customer.website}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-600 hover:text-blue-800'
                >
                  {customer.website}
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Adress */}
      {(customer.address_street || customer.address_city) && (
        <div className='bg-white rounded-lg shadow p-6 mb-6'>
          <h2 className='text-xl font-semibold mb-4'>Adress</h2>
          
          <div>
            {customer.address_street && <p>{customer.address_street}</p>}
            {(customer.address_postal_code || customer.address_city) && (
              <p>
                {customer.address_postal_code} {customer.address_city}
              </p>
            )}
            {customer.address_country && <p>{customer.address_country}</p>}
          </div>
        </div>
      )}
      
      {/* Ekonomisk information */}
      <div className='bg-white rounded-lg shadow p-6 mb-6'>
        <h2 className='text-xl font-semibold mb-4'>Ekonomisk information</h2>
        
        <div className='grid grid-cols-2 gap-4'>
          <div>
            <label className='text-sm font-medium text-gray-500'>Betalningsvillkor</label>
            <p className='mt-1'>{customer.payment_terms} dagar</p>
          </div>
          
          {customer.discount_percentage > 0 && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Rabatt</label>
              <p className='mt-1'>{customer.discount_percentage}%</p>
            </div>
          )}
          
          <div>
            <label className='text-sm font-medium text-gray-500'>Valuta</label>
            <p className='mt-1'>{customer.currency}</p>
          </div>
          
          {customer.vat_number && (
            <div>
              <label className='text-sm font-medium text-gray-500'>Momsnummer</label>
              <p className='mt-1'>{customer.vat_number}</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Anteckningar */}
      {customer.notes && (
        <div className='bg-white rounded-lg shadow p-6 mb-6'>
          <h2 className='text-xl font-semibold mb-4'>Anteckningar</h2>
          <p className='whitespace-pre-wrap'>{customer.notes}</p>
        </div>
      )}
      
      {/* Status */}
      <div className='bg-white rounded-lg shadow p-6'>
        <h2 className='text-xl font-semibold mb-4'>Status</h2>
        
        <div className='flex items-center gap-2'>
          <span className={`px-3 py-1 rounded-full text-sm ${
            customer.is_active 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            {customer.is_active ? 'Aktiv' : 'Inaktiv'}
          </span>
        </div>
        
        <div className='mt-4 text-sm text-gray-500'>
          <p>Skapad: {new Date(customer.created_at).toLocaleDateString('sv-SE')}</p>
          <p>Uppdaterad: {new Date(customer.updated_at).toLocaleDateString('sv-SE')}</p>
        </div>
      </div>
    </div>
  );
}
