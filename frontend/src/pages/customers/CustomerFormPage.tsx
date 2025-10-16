import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCustomer, useCreateCustomer, useUpdateCustomer } from '../../hooks/useCustomer';

export default function CustomerFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const companyId = localStorage.getItem('currentCompanyId') || '';
  
  const { data: customer } = useCustomer(id || '', companyId);
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  
  const [formData, setFormData] = useState({
    name: '',
    org_number: '',
    contact_person: '',
    email: '',
    phone: '',
    mobile: '',
    website: '',
    address_street: '',
    address_postal_code: '',
    address_city: '',
    address_country: 'Sweden',
    payment_terms: 30,
    discount_percentage: 0,
    currency: 'SEK',
    vat_number: '',
    notes: ''
  });
  
  useEffect(() => {
    if (customer) {
      setFormData({
        name: customer.name || '',
        org_number: customer.org_number || '',
        contact_person: customer.contact_person || '',
        email: customer.email || '',
        phone: customer.phone || '',
        mobile: customer.mobile || '',
        website: customer.website || '',
        address_street: customer.address_street || '',
        address_postal_code: customer.address_postal_code || '',
        address_city: customer.address_city || '',
        address_country: customer.address_country || 'Sweden',
        payment_terms: customer.payment_terms || 30,
        discount_percentage: customer.discount_percentage || 0,
        currency: customer.currency || 'SEK',
        vat_number: customer.vat_number || '',
        notes: customer.notes || ''
      });
    }
  }, [customer]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'payment_terms' || name === 'discount_percentage' 
        ? parseFloat(value) || 0 
        : value
    }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isEdit && id) {
        await updateCustomer.mutateAsync({
          id,
          companyId,
          data: formData
        });
        alert('Kunden har uppdaterats');
      } else {
        await createCustomer.mutateAsync({
          company_id: companyId,
          ...formData
        });
        alert('Kunden har skapats');
      }
      navigate('/customers');
    } catch (error) {
      alert(`Ett fel uppstod: ${error}`);
    }
  };
  
  return (
    <div className='p-6 max-w-4xl mx-auto'>
      <h1 className='text-3xl font-bold mb-6'>
        {isEdit ? 'Redigera kund' : 'Ny kund'}
      </h1>
      
      <form onSubmit={handleSubmit} className='space-y-6'>
        {/* Grundläggande information */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Grundläggande information</h2>
          
          <div className='grid grid-cols-2 gap-4'>
            <div className='col-span-2'>
              <label className='block text-sm font-medium mb-2'>
                Företagsnamn *
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
            
            <div>
              <label className='block text-sm font-medium mb-2'>
                Organisationsnummer
              </label>
              <input
                type='text'
                name='org_number'
                value={formData.org_number}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>
                Kontaktperson
              </label>
              <input
                type='text'
                name='contact_person'
                value={formData.contact_person}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Email</label>
              <input
                type='email'
                name='email'
                value={formData.email}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Telefon</label>
              <input
                type='tel'
                name='phone'
                value={formData.phone}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Mobil</label>
              <input
                type='tel'
                name='mobile'
                value={formData.mobile}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Webbplats</label>
              <input
                type='url'
                name='website'
                value={formData.website}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
          </div>
        </div>
        
        {/* Adress */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Adress</h2>
          
          <div className='grid grid-cols-2 gap-4'>
            <div className='col-span-2'>
              <label className='block text-sm font-medium mb-2'>Gatuadress</label>
              <input
                type='text'
                name='address_street'
                value={formData.address_street}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Postnummer</label>
              <input
                type='text'
                name='address_postal_code'
                value={formData.address_postal_code}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Stad</label>
              <input
                type='text'
                name='address_city'
                value={formData.address_city}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div className='col-span-2'>
              <label className='block text-sm font-medium mb-2'>Land</label>
              <input
                type='text'
                name='address_country'
                value={formData.address_country}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
          </div>
        </div>
        
        {/* Ekonomisk information */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Ekonomisk information</h2>
          
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='block text-sm font-medium mb-2'>
                Betalningsvillkor (dagar)
              </label>
              <input
                type='number'
                name='payment_terms'
                value={formData.payment_terms}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>
                Rabatt (%)
              </label>
              <input
                type='number'
                step='0.01'
                name='discount_percentage'
                value={formData.discount_percentage}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Valuta</label>
              <input
                type='text'
                name='currency'
                value={formData.currency}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
            
            <div>
              <label className='block text-sm font-medium mb-2'>Momsnummer</label>
              <input
                type='text'
                name='vat_number'
                value={formData.vat_number}
                onChange={handleChange}
                className='w-full px-4 py-2 border rounded-lg'
              />
            </div>
          </div>
        </div>
        
        {/* Anteckningar */}
        <div className='bg-white rounded-lg shadow p-6'>
          <h2 className='text-xl font-semibold mb-4'>Anteckningar</h2>
          
          <textarea
            name='notes'
            value={formData.notes}
            onChange={handleChange}
            rows={4}
            className='w-full px-4 py-2 border rounded-lg'
            placeholder='Interna anteckningar om kunden...'
          />
        </div>
        
        {/* Actions */}
        <div className='flex gap-4'>
          <button
            type='submit'
            disabled={createCustomer.isPending || updateCustomer.isPending}
            className='px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400'
          >
            {createCustomer.isPending || updateCustomer.isPending 
              ? 'Sparar...' 
              : isEdit ? 'Uppdatera kund' : 'Skapa kund'
            }
          </button>
          
          <button
            type='button'
            onClick={() => navigate('/customers')}
            className='px-6 py-2 border rounded-lg hover:bg-gray-50'
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}
