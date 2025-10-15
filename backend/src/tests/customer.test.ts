import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

const TEST_USER = {
  email: 'test@example.com',
  password: 'TestPassword123',
};

const TEST_COMPANY_ID = 'de3bc8f8-d16f-498c-b82d-352348e616df';

let authToken: string;
let customerId: string;

describe('Customer CRM API Tests', () => {

  beforeAll(async () => {
    console.log('\n🔐 Logging in...');
    const response = await axios.post(`${API_URL}/auth/login`, TEST_USER);
    authToken = response.data.token;
    console.log('✅ Login successful\n');
  });

  test('1. Create customer', async () => {
    console.log('📝 Creating customer...');
    const response = await axios.post(`${API_URL}/customers`, {
      company_id: TEST_COMPANY_ID,
      name: 'Acme Corporation',
      org_number: '556677-8899',
      contact_person: 'John Doe',
      email: 'john@acme.com',
      phone: '+46-8-1234567',
      mobile: '+46-70-1234567',
      website: 'https://acme.com',
      address_street: 'Main Street 123',
      address_postal_code: '12345',
      address_city: 'Stockholm',
      address_country: 'Sweden',
      payment_terms: 30,
      discount_percentage: 5,
      currency: 'SEK',
      vat_number: 'SE556677889901',
      notes: 'Important customer',
      tags: ['vip', 'enterprise']
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Customer created: ${response.data.name}`);
    console.log(`   ID: ${response.data.id}`);

    expect(response.status).toBe(201);
    expect(response.data).toHaveProperty('id');
    expect(response.data.name).toBe('Acme Corporation');
    expect(response.data.email).toBe('john@acme.com');
    expect(response.data.is_active).toBe(true);

    customerId = response.data.id;
  });

  test('2. Get customers list', async () => {
    console.log('\n📋 Fetching customers list...');
    const response = await axios.get(`${API_URL}/customers`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    console.log(`✅ Found ${response.data.customers.length} customers`);
    console.log(`   Total: ${response.data.total}`);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('customers');
    expect(response.data).toHaveProperty('total');
    expect(Array.isArray(response.data.customers)).toBe(true);
    expect(response.data.total).toBeGreaterThan(0);
  });

  test('3. Get customer by ID', async () => {
    console.log('\n🔍 Fetching customer by ID...');
    const response = await axios.get(`${API_URL}/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    console.log(`✅ Customer found: ${response.data.name}`);
    console.log(`   Org Number: ${response.data.org_number}`);
    console.log(`   Payment Terms: ${response.data.payment_terms} days`);

    expect(response.status).toBe(200);
    expect(response.data.id).toBe(customerId);
    expect(response.data.name).toBe('Acme Corporation');
  });

  test('4. Update customer', async () => {
    console.log('\n✏️  Updating customer...');
    const response = await axios.put(`${API_URL}/customers/${customerId}`, {
      company_id: TEST_COMPANY_ID,
      name: 'Acme Corporation AB',
      discount_percentage: 10,
      notes: 'VIP customer - increased discount'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Customer updated: ${response.data.name}`);
    console.log(`   Discount: ${response.data.discount_percentage}%`);

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('Acme Corporation AB');
    expect(response.data.discount_percentage).toBe('10.00');
  });

  test('5. Add customer contact', async () => {
    console.log('\n👤 Adding customer contact...');
    const response = await axios.post(`${API_URL}/customers/${customerId}/contacts`, {
      customer_id: customerId,
      name: 'Jane Smith',
      title: 'CFO',
      email: 'jane@acme.com',
      phone: '+46-8-7654321',
      mobile: '+46-70-7654321',
      is_primary: true
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Contact added: ${response.data.name}`);
    console.log(`   Title: ${response.data.title}`);

    expect(response.status).toBe(201);
    expect(response.data.name).toBe('Jane Smith');
    expect(response.data.is_primary).toBe(true);
  });

  test('6. Get customer contacts', async () => {
    console.log('\n📇 Fetching customer contacts...');
    const response = await axios.get(`${API_URL}/customers/${customerId}/contacts`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Found ${response.data.length} contact(s)`);
    response.data.forEach((contact: any, i: number) => {
      console.log(`   ${i + 1}. ${contact.name} (${contact.title || 'No title'})`);
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
  });

  test('7. Add customer note', async () => {
    console.log('\n📝 Adding customer note...');
    const response = await axios.post(`${API_URL}/customers/${customerId}/notes`, {
      note: 'Met with CFO to discuss contract renewal. Very positive meeting.'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Note added`);
    console.log(`   Note: ${response.data.note.substring(0, 50)}...`);

    expect(response.status).toBe(201);
    expect(response.data).toHaveProperty('note');
    expect(response.data).toHaveProperty('created_at');
  });

  test('8. Get customer notes', async () => {
    console.log('\n📋 Fetching customer notes...');
    const response = await axios.get(`${API_URL}/customers/${customerId}/notes`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Found ${response.data.length} note(s)`);
    response.data.forEach((note: any, i: number) => {
      console.log(`   ${i + 1}. ${note.note.substring(0, 60)}...`);
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
  });

  test('9. Search customers', async () => {
    console.log('\n🔎 Searching customers...');
    const response = await axios.get(`${API_URL}/customers`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: {
        company_id: TEST_COMPANY_ID,
        search: 'Acme',
        is_active: true
      }
    });

    console.log(`✅ Search found ${response.data.customers.length} customer(s)`);

    expect(response.status).toBe(200);
    expect(response.data.customers.length).toBeGreaterThan(0);
    expect(response.data.customers[0].name).toContain('Acme');
  });

  test('10. Get customer stats', async () => {
    console.log('\n📊 Fetching customer statistics...');
    const response = await axios.get(`${API_URL}/customers/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    console.log('✅ Customer Statistics:');
    console.log(`   Total customers: ${response.data.total_customers}`);
    console.log(`   Active: ${response.data.active_customers}`);
    console.log(`   Inactive: ${response.data.inactive_customers}`);
    console.log(`   New (last 30 days): ${response.data.new_last_30days}`);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('total_customers');
    expect(response.data).toHaveProperty('active_customers');
  });

  test('11. Deactivate customer', async () => {
    console.log('\n🗑️  Deactivating customer...');
    const response = await axios.delete(`${API_URL}/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { company_id: TEST_COMPANY_ID }
    });

    console.log('✅ Customer deactivated successfully');

    expect(response.status).toBe(200);
    expect(response.data.message).toBe('Customer deactivated successfully');

    // Verify customer is inactive
    const getResponse = await axios.get(`${API_URL}/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    expect(getResponse.data.is_active).toBe(false);
    console.log('✅ Verified customer is inactive');
  });
});

console.log('\n🧪 CUSTOMER CRM API TESTS\n');
console.log('================================\n');
