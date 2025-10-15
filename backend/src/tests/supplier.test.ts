import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

const TEST_USER = {
  email: 'test@example.com',
  password: 'TestPassword123',
};

const TEST_COMPANY_ID = 'de3bc8f8-d16f-498c-b82d-352348e616df';

let authToken: string;
let supplierId: string;

describe('Supplier CRM API Tests', () => {

  beforeAll(async () => {
    console.log('\n🔐 Logging in...');
    const response = await axios.post(`${API_URL}/auth/login`, TEST_USER);
    authToken = response.data.token;
    console.log('✅ Login successful\n');
  });

  test('1. Create supplier', async () => {
    console.log('📝 Creating supplier...');
    const response = await axios.post(`${API_URL}/suppliers`, {
      company_id: TEST_COMPANY_ID,
      name: 'TechVendor Inc',
      org_number: '556677-8899',
      contact_person: 'John Doe',
      email: 'sales@techvendor.com',
      phone: '+46-8-1234567',
      mobile: '+46-70-1234567',
      website: 'https://techvendor.com',
      address_street: 'Main Street 123',
      address_postal_code: '12345',
      address_city: 'Stockholm',
      address_country: 'Sweden',
      payment_terms: 30,
      discount_percentage: 5,
      currency: 'SEK',
      vat_number: 'SE556677889901',
      notes: 'Important supplier',
      tags: ['vip', 'enterprise']
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Supplier created: ${response.data.name}`);
    console.log(`   ID: ${response.data.id}`);

    expect(response.status).toBe(201);
    expect(response.data).toHaveProperty('id');
    expect(response.data.name).toBe('TechVendor Inc');
    expect(response.data.email).toBe('sales@techvendor.com');
    expect(response.data.is_active).toBe(true);

    supplierId = response.data.id;
  });

  test('2. Get suppliers list', async () => {
    console.log('\n📋 Fetching suppliers list...');
    const response = await axios.get(`${API_URL}/suppliers`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    console.log(`✅ Found ${response.data.suppliers.length} suppliers`);
    console.log(`   Total: ${response.data.total}`);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('suppliers');
    expect(response.data).toHaveProperty('total');
    expect(Array.isArray(response.data.suppliers)).toBe(true);
    expect(response.data.total).toBeGreaterThan(0);
  });

  test('3. Get supplier by ID', async () => {
    console.log('\n🔍 Fetching supplier by ID...');
    const response = await axios.get(`${API_URL}/suppliers/${supplierId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    console.log(`✅ Supplier found: ${response.data.name}`);
    console.log(`   Org Number: ${response.data.org_number}`);
    console.log(`   Payment Terms: ${response.data.payment_terms} days`);

    expect(response.status).toBe(200);
    expect(response.data.id).toBe(supplierId);
    expect(response.data.name).toBe('TechVendor Inc');
  });

  test('4. Update supplier', async () => {
    console.log('\n✏️  Updating supplier...');
    const response = await axios.put(`${API_URL}/suppliers/${supplierId}`, {
      company_id: TEST_COMPANY_ID,
      name: 'TechVendor Inc AB',
      discount_percentage: 10,
      notes: 'VIP supplier - increased discount'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`✅ Supplier updated: ${response.data.name}`);
    console.log(`   Discount: ${response.data.discount_percentage}%`);

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('TechVendor Inc AB');
    expect(response.data.discount_percentage).toBe('10.00');
  });

  test('5. Add supplier contact', async () => {
    console.log('\n👤 Adding supplier contact...');
    const response = await axios.post(`${API_URL}/suppliers/${supplierId}/contacts`, {
      supplier_id: supplierId,
      name: 'Jane Smith',
      title: 'CFO',
      email: 'jane@techvendor.com',
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

  test('6. Get supplier contacts', async () => {
    console.log('\n📇 Fetching supplier contacts...');
    const response = await axios.get(`${API_URL}/suppliers/${supplierId}/contacts`, {
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

  test('7. Add supplier note', async () => {
    console.log('\n📝 Adding supplier note...');
    const response = await axios.post(`${API_URL}/suppliers/${supplierId}/notes`, {
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

  test('8. Get supplier notes', async () => {
    console.log('\n📋 Fetching supplier notes...');
    const response = await axios.get(`${API_URL}/suppliers/${supplierId}/notes`, {
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

  test('9. Search suppliers', async () => {
    console.log('\n🔎 Searching suppliers...');
    const response = await axios.get(`${API_URL}/suppliers`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: {
        company_id: TEST_COMPANY_ID,
        search: 'TechVendor',
        is_active: true
      }
    });

    console.log(`✅ Search found ${response.data.suppliers.length} supplier(s)`);

    expect(response.status).toBe(200);
    expect(response.data.suppliers.length).toBeGreaterThan(0);
    expect(response.data.suppliers[0].name).toContain('TechVendor');
  });

  test('10. Get supplier stats', async () => {
    console.log('\n📊 Fetching supplier statistics...');
    const response = await axios.get(`${API_URL}/suppliers/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    console.log('✅ Supplier Statistics:');
    console.log(`   Total suppliers: ${response.data.total_suppliers}`);
    console.log(`   Active: ${response.data.active_suppliers}`);
    console.log(`   Inactive: ${response.data.inactive_suppliers}`);
    console.log(`   New (last 30 days): ${response.data.new_last_30days}`);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('total_suppliers');
    expect(response.data).toHaveProperty('active_suppliers');
  });

  test('11. Deactivate supplier', async () => {
    console.log('\n🗑️  Deactivating supplier...');
    const response = await axios.delete(`${API_URL}/suppliers/${supplierId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { company_id: TEST_COMPANY_ID }
    });

    console.log('✅ Supplier deactivated successfully');

    expect(response.status).toBe(200);
    expect(response.data.message).toBe('Supplier deactivated successfully');

    // Verify supplier is inactive
    const getResponse = await axios.get(`${API_URL}/suppliers/${supplierId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { company_id: TEST_COMPANY_ID }
    });

    expect(getResponse.data.is_active).toBe(false);
    console.log('✅ Verified supplier is inactive');
  });
});

console.log('\n🧪 SUPPLIER CRM API TESTS\n');
console.log('================================\n');
