import request from 'supertest';
import app from '../../app';
import { pool } from '../../config/database';

describe('Customer API Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let companyId: string;
  let customerId: string;

  beforeAll(async () => {
    // Register and login
    const timestamp = Date.now();
    const testEmail = `customer-test-${timestamp}@example.com`;
    
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: 'TestPass123!',
        name: 'Customer Test User'
      });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'TestPass123!'
      });

    authToken = loginRes.body.token;
    userId = loginRes.body.user.id;

    // Create a company
    const companyRes = await request(app)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Company for Customers',
        org_number: `999${timestamp}`.substr(0, 10)
      });

    companyId = companyRes.body.id;
  });

  afterAll(async () => {
    // Cleanup
    if (customerId) {
      await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
    }
    if (companyId) {
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    }
    if (userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await pool.end();
  });

  describe('POST /api/v1/customers', () => {
    it('should create a new customer', async () => {
      const res = await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId,
          name: 'Test Customer AB',
          org_number: '556677-8899',
          email: 'customer@example.com',
          phone: '+46701234567',
          payment_terms: 30,
          currency: 'SEK'
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Customer AB');
      expect(res.body.org_number).toBe('556677-8899');
      expect(res.body.email).toBe('customer@example.com');
      expect(res.body.payment_terms).toBe(30);
      expect(res.body.is_active).toBe(true);

      customerId = res.body.id;
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/v1/customers')
        .send({
          company_id: companyId,
          name: 'Test Customer'
        })
        .expect(401);
    });

    it('should require company_id', async () => {
      await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Customer'
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/customers', () => {
    it('should list all customers for company', async () => {
      const res = await request(app)
        .get(`/api/v1/customers?company_id=${companyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('customers');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.customers)).toBe(true);
      expect(res.body.customers.length).toBeGreaterThan(0);
    });

    it('should filter customers by search term', async () => {
      const res = await request(app)
        .get(`/api/v1/customers?company_id=${companyId}&search=Test Customer`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.customers.length).toBeGreaterThan(0);
      expect(res.body.customers[0].name).toContain('Test Customer');
    });

    it('should require company_id', async () => {
      await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('should get customer by id', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerId}?company_id=${companyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.id).toBe(customerId);
      expect(res.body.name).toBe('Test Customer AB');
    });

    it('should return 404 for non-existent customer', async () => {
      await request(app)
        .get(`/api/v1/customers/00000000-0000-0000-0000-000000000000?company_id=${companyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/customers/:id', () => {
    it('should update customer', async () => {
      const res = await request(app)
        .put(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId,
          name: 'Updated Customer AB',
          email: 'updated@example.com',
          payment_terms: 45
        })
        .expect(200);

      expect(res.body.name).toBe('Updated Customer AB');
      expect(res.body.email).toBe('updated@example.com');
      expect(res.body.payment_terms).toBe(45);
    });
  });

  describe('Customer Contacts', () => {
    let contactId: string;

    it('should add contact to customer', async () => {
      const res = await request(app)
        .post(`/api/v1/customers/${customerId}/contacts`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customer_id: customerId,
          name: 'John Doe',
          title: 'CEO',
          email: 'john@example.com',
          phone: '+46701111111',
          is_primary: true
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('John Doe');
      expect(res.body.title).toBe('CEO');
      expect(res.body.is_primary).toBe(true);

      contactId = res.body.id;
    });

    it('should get customer contacts', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerId}/contacts`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].name).toBe('John Doe');
    });

    afterAll(async () => {
      if (contactId) {
        await pool.query('DELETE FROM customer_contacts WHERE id = $1', [contactId]);
      }
    });
  });

  describe('Customer Notes', () => {
    let noteId: string;

    it('should add note to customer', async () => {
      const res = await request(app)
        .post(`/api/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          note: 'This is a test note about the customer'
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.note).toBe('This is a test note about the customer');
      expect(res.body.user_id).toBe(userId);

      noteId = res.body.id;
    });

    it('should get customer notes', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].note).toBe('This is a test note about the customer');
    });

    afterAll(async () => {
      if (noteId) {
        await pool.query('DELETE FROM customer_notes WHERE id = $1', [noteId]);
      }
    });
  });

  describe('DELETE /api/v1/customers/:id', () => {
    it('should soft delete customer', async () => {
      await request(app)
        .delete(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId
        })
        .expect(200);

      // Verify customer is deactivated
      const res = await request(app)
        .get(`/api/v1/customers/${customerId}?company_id=${companyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.is_active).toBe(false);
    });
  });
});
