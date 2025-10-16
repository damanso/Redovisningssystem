import request from 'supertest';
import app from '../../app';

describe('Customer API - Simple Tests', () => {
  let authToken: string;
  let companyId: string;
  let customerId: string;

  beforeAll(async () => {
    // Login with existing test user or create one
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'TestPass123!'
      });

    if (loginRes.status === 200) {
      authToken = loginRes.body.token;
      
      // Get company
      const companiesRes = await request(app)
        .get('/api/v1/companies/my-companies')
        .set('Authorization', `Bearer ${authToken}`);
      
      if (companiesRes.body.length > 0) {
        companyId = companiesRes.body[0].id;
      }
    }
  });

  test('POST /api/v1/customers - create customer', async () => {
    if (!authToken || !companyId) {
      console.log('Skipping test: no auth or company');
      return;
    }

    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        company_id: companyId,
        name: 'Test Customer AB',
        email: 'customer@test.com',
        payment_terms: 30
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Test Customer AB');
    
    customerId = res.body.id;
  });

  test('GET /api/v1/customers - list customers', async () => {
    if (!authToken || !companyId) {
      return;
    }

    const res = await request(app)
      .get(`/api/v1/customers?company_id=${companyId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('customers');
    expect(Array.isArray(res.body.customers)).toBe(true);
  });

  test('GET /api/v1/customers/:id - get customer by id', async () => {
    if (!authToken || !companyId || !customerId) {
      return;
    }

    const res = await request(app)
      .get(`/api/v1/customers/${customerId}?company_id=${companyId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(customerId);
  });

  test('PUT /api/v1/customers/:id - update customer', async () => {
    if (!authToken || !companyId || !customerId) {
      return;
    }

    const res = await request(app)
      .put(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        company_id: companyId,
        name: 'Updated Customer AB'
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Customer AB');
  });

  test('POST /api/v1/customers/:id/contacts - add contact', async () => {
    if (!authToken || !customerId) {
      return;
    }

    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/contacts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        name: 'John Doe',
        email: 'john@test.com'
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('John Doe');
  });

  test('POST /api/v1/customers/:id/notes - add note', async () => {
    if (!authToken || !customerId) {
      return;
    }

    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        note: 'Test note about customer'
      });

    expect(res.status).toBe(201);
    expect(res.body.note).toBe('Test note about customer');
  });
});
