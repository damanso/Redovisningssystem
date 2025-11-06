import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

describe('Recurring Invoice API Integration Tests', () => {
  let authToken: string;
  let companyId: string;
  let customerId: string;
  let recurringInvoiceId: string;

  beforeAll(async () => {
    // Register and login
    const timestamp = Date.now();
    const registerData = {
      email: `recurring${timestamp}@example.com`,
      password: 'TestPass123',
      name: 'Recurring Test User'
    };

    await axios.post(`${API_URL}/auth/register`, registerData);

    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: registerData.email,
      password: registerData.password
    });

    authToken = loginRes.data.token;

    // Create a test company
    const companyRes = await axios.post(
      `${API_URL}/companies`,
      {
        name: 'Test Company',
        org_number: `${timestamp}`
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );

    companyId = companyRes.data.id;

    // Create a test customer
    const customerRes = await axios.post(
      `${API_URL}/customers`,
      {
        company_id: companyId,
        name: 'Test Customer AB',
        org_number: '556677-8899',
        email: 'customer@test.com',
        payment_terms: 30
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );

    customerId = customerRes.data.id;
  });

  describe('POST /api/v1/recurring-invoices', () => {
    it('should create a new recurring invoice', async () => {
      const recurringData = {
        customer_id: customerId,
        template_name: 'Monthly Subscription',
        payment_terms: 30,
        frequency: 'monthly',
        interval_count: 1,
        start_date: '2025-01-01',
        reference: 'SUB-001',
        notes: 'Monthly subscription fee',
        lines: [
          {
            description: 'Subscription - Premium Plan',
            quantity: 1,
            unit_price: 999.00,
            unit: 'st',
            vat_rate: 25.00
          }
        ]
      };

      const res = await axios.post(
        `${API_URL}/recurring-invoices`,
        recurringData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(201);
      expect(res.data).toHaveProperty('id');
      expect(res.data.template_name).toBe('Monthly Subscription');
      expect(res.data.frequency).toBe('monthly');
      expect(res.data.status).toBe('active');
      expect(res.data.lines).toHaveLength(1);

      recurringInvoiceId = res.data.id;
    });

    it('should fail with missing required fields', async () => {
      try {
        await axios.post(
          `${API_URL}/recurring-invoices`,
          {
            customer_id: customerId
          },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('GET /api/v1/recurring-invoices', () => {
    it('should get all recurring invoices', async () => {
      const res = await axios.get(
        `${API_URL}/recurring-invoices`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('recurring_invoices');
      expect(res.data.recurring_invoices.length).toBeGreaterThan(0);
    });

    it('should filter recurring invoices by status', async () => {
      const res = await axios.get(
        `${API_URL}/recurring-invoices?status=active`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      res.data.recurring_invoices.forEach((recurring: any) => {
        expect(recurring.status).toBe('active');
      });
    });

    it('should search recurring invoices', async () => {
      const res = await axios.get(
        `${API_URL}/recurring-invoices?search=Monthly`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.recurring_invoices.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/recurring-invoices/:id', () => {
    it('should get a recurring invoice by ID', async () => {
      const res = await axios.get(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.id).toBe(recurringInvoiceId);
      expect(res.data).toHaveProperty('lines');
      expect(res.data).toHaveProperty('customer_name');
    });

    it('should return 404 for non-existent recurring invoice', async () => {
      try {
        await axios.get(
          `${API_URL}/recurring-invoices/00000000-0000-0000-0000-000000000000`,
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });

  describe('PUT /api/v1/recurring-invoices/:id', () => {
    it('should update a recurring invoice', async () => {
      const updateData = {
        template_name: 'Monthly Subscription - Updated',
        payment_terms: 15,
        notes: 'Updated subscription'
      };

      const res = await axios.put(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}`,
        updateData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.template_name).toBe('Monthly Subscription - Updated');
      expect(res.data.payment_terms).toBe(15);
      expect(res.data.notes).toBe('Updated subscription');
    });
  });

  describe('POST /api/v1/recurring-invoices/:id/generate', () => {
    it('should generate an invoice from recurring template', async () => {
      const res = await axios.post(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}/generate`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(201);
      expect(res.data).toHaveProperty('invoice');
      expect(res.data).toHaveProperty('recurring');
      expect(res.data.invoice).toHaveProperty('id');
      expect(res.data.invoice).toHaveProperty('invoice_number');
      expect(res.data.recurring.generated_count).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/recurring-invoices/:id/pause', () => {
    it('should pause a recurring invoice', async () => {
      const res = await axios.post(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}/pause`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('paused');
    });
  });

  describe('POST /api/v1/recurring-invoices/:id/resume', () => {
    it('should resume a paused recurring invoice', async () => {
      const res = await axios.post(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}/resume`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('active');
    });
  });

  describe('GET /api/v1/recurring-invoices/:id/history', () => {
    it('should get recurring invoice history', async () => {
      const res = await axios.get(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}/history`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data[0]).toHaveProperty('invoice_id');
      expect(res.data[0]).toHaveProperty('invoice_number');
    });
  });

  describe('GET /api/v1/recurring-invoices/stats', () => {
    it('should get recurring invoice statistics', async () => {
      const res = await axios.get(
        `${API_URL}/recurring-invoices/stats`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('total_recurring');
      expect(res.data).toHaveProperty('active_recurring');
      expect(res.data).toHaveProperty('paused_recurring');
      expect(res.data).toHaveProperty('total_generated');
      expect(res.data).toHaveProperty('pending_generation');
      expect(res.data.total_recurring).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/recurring-invoices/:id/cancel', () => {
    it('should cancel a recurring invoice', async () => {
      const res = await axios.post(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}/cancel`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('cancelled');
    });

    it('should not allow generating from cancelled recurring invoice', async () => {
      try {
        await axios.post(
          `${API_URL}/recurring-invoices/${recurringInvoiceId}/generate`,
          {},
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('DELETE /api/v1/recurring-invoices/:id', () => {
    it('should delete a recurring invoice', async () => {
      const res = await axios.delete(
        `${API_URL}/recurring-invoices/${recurringInvoiceId}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(res.status).toBe(204);
    });

    it('should return 404 after deletion', async () => {
      try {
        await axios.get(
          `${API_URL}/recurring-invoices/${recurringInvoiceId}`,
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });
});
