import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

describe('Invoice API Integration Tests', () => {
  let authToken: string;
  let companyId: string;
  let customerId: string;
  let articleId: string;
  let invoiceId: string;
  let draftInvoiceId: string;

  beforeAll(async () => {
    // Register and login
    const timestamp = Date.now();
    const registerData = {
      email: `invoicetest${timestamp}@example.com`,
      password: 'TestPass123',
      name: 'Invoice Test User'
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

    // Create a test article
    const articleRes = await axios.post(
      `${API_URL}/articles`,
      {
        company_id: companyId,
        name: 'Consulting Service',
        price: 1200.00,
        unit: 'hour',
        vat_rate: 25.00
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );

    articleId = articleRes.data.id;
  });

  describe('POST /api/v1/invoices', () => {
    it('should create a new invoice with lines', async () => {
      const invoiceData = {
        company_id: companyId,
        customer_id: customerId,
        invoice_date: '2025-01-15',
        payment_terms: 30,
        reference: 'Project ABC',
        notes: 'Thank you for your business',
        lines: [
          {
            article_id: articleId,
            description: 'Consulting - 10 hours',
            quantity: 10,
            unit_price: 1200.00,
            unit: 'hour',
            vat_rate: 25.00
          },
          {
            description: 'Travel expenses',
            quantity: 1,
            unit_price: 500.00,
            unit: 'st',
            vat_rate: 25.00
          }
        ]
      };

      const response = await axios.post(
        `${API_URL}/invoices`,
        invoiceData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('id');
      expect(response.data.invoice_number).toMatch(/^\d{4}-\d{4}$/); // Format: 2025-0001
      expect(response.data.customer_id).toBe(customerId);
      expect(response.data.status).toBe('draft');
      expect(response.data.currency).toBe('SEK');
      expect(response.data.subtotal).toBe('12500.00');
      expect(response.data.vat_amount).toBe('3125.00');
      expect(response.data.total_amount).toBe('15625.00');
      expect(response.data.paid_amount).toBe('0.00');
      expect(response.data).toHaveProperty('ocr_number');
      expect(response.data.lines).toHaveLength(2);
      expect(response.data.customer_name).toBe('Test Customer AB');

      invoiceId = response.data.id;
    });

    it('should create another invoice with incremented number', async () => {
      const invoiceData = {
        company_id: companyId,
        customer_id: customerId,
        invoice_date: '2025-01-16',
        lines: [
          {
            description: 'Service',
            quantity: 1,
            unit_price: 1000.00,
            vat_rate: 25.00
          }
        ]
      };

      const response = await axios.post(
        `${API_URL}/invoices`,
        invoiceData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data.invoice_number).toMatch(/^\d{4}-\d{4}$/);

      draftInvoiceId = response.data.id;
    });

    it('should fail without company_id', async () => {
      try {
        await axios.post(
          `${API_URL}/invoices`,
          {
            customer_id: customerId,
            invoice_date: '2025-01-15',
            lines: []
          },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });

    it('should fail without authentication', async () => {
      try {
        await axios.post(`${API_URL}/invoices`, {});
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });
  });

  describe('GET /api/v1/invoices', () => {
    it('should get all invoices for company', async () => {
      const response = await axios.get(`${API_URL}/invoices`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('invoices');
      expect(response.data).toHaveProperty('total');
      expect(Array.isArray(response.data.invoices)).toBe(true);
      expect(response.data.total).toBeGreaterThanOrEqual(2);
      expect(response.data.invoices[0]).toHaveProperty('customer_name');
    });

    it('should filter invoices by customer', async () => {
      const response = await axios.get(`${API_URL}/invoices`, {
        params: { company_id: companyId, customer_id: customerId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      response.data.invoices.forEach((invoice: any) => {
        expect(invoice.customer_id).toBe(customerId);
      });
    });

    it('should filter invoices by status', async () => {
      const response = await axios.get(`${API_URL}/invoices`, {
        params: { company_id: companyId, status: 'draft' },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      response.data.invoices.forEach((invoice: any) => {
        expect(invoice.status).toBe('draft');
      });
    });

    it('should search invoices by invoice number', async () => {
      const firstInvoice = await axios.get(`${API_URL}/invoices/${invoiceId}`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const invoiceNumber = firstInvoice.data.invoice_number;

      const response = await axios.get(`${API_URL}/invoices`, {
        params: { company_id: companyId, search: invoiceNumber },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.invoices.length).toBeGreaterThan(0);
      expect(response.data.invoices[0].invoice_number).toBe(invoiceNumber);
    });

    it('should paginate invoices', async () => {
      const response = await axios.get(`${API_URL}/invoices`, {
        params: { company_id: companyId, limit: 1, offset: 0 },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.invoices.length).toBe(1);
      expect(response.data.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/v1/invoices/:id', () => {
    it('should get invoice by ID with lines', async () => {
      const response = await axios.get(`${API_URL}/invoices/${invoiceId}`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(invoiceId);
      expect(response.data.lines).toHaveLength(2);
      expect(response.data.lines[0]).toHaveProperty('description');
      expect(response.data.lines[0]).toHaveProperty('quantity');
      expect(response.data.lines[0]).toHaveProperty('unit_price');
      expect(response.data.lines[0]).toHaveProperty('amount');
    });

    it('should return 404 for non-existent invoice', async () => {
      try {
        await axios.get(`${API_URL}/invoices/00000000-0000-0000-0000-000000000000`, {
          params: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });

  describe('PUT /api/v1/invoices/:id', () => {
    it('should update draft invoice', async () => {
      const updateData = {
        company_id: companyId,
        reference: 'Updated Reference',
        notes: 'Updated notes',
        lines: [
          {
            description: 'Updated service',
            quantity: 5,
            unit_price: 2000.00,
            vat_rate: 25.00
          }
        ]
      };

      const response = await axios.put(
        `${API_URL}/invoices/${draftInvoiceId}`,
        updateData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.reference).toBe('Updated Reference');
      expect(response.data.notes).toBe('Updated notes');
      expect(response.data.lines).toHaveLength(1);
      expect(response.data.subtotal).toBe('10000.00');
      expect(response.data.vat_amount).toBe('2500.00');
      expect(response.data.total_amount).toBe('12500.00');
    });

    it('should return 404 for non-existent invoice', async () => {
      try {
        await axios.put(
          `${API_URL}/invoices/00000000-0000-0000-0000-000000000000`,
          { company_id: companyId, reference: 'Test' },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });

  describe('POST /api/v1/invoices/:id/send', () => {
    it('should mark invoice as sent', async () => {
      const response = await axios.post(
        `${API_URL}/invoices/${invoiceId}/send`,
        { company_id: companyId },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('sent');
      expect(response.data.sent_date).toBeTruthy();
    });

    it('should not allow sending non-draft invoice', async () => {
      try {
        await axios.post(
          `${API_URL}/invoices/${invoiceId}/send`,
          { company_id: companyId },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('POST /api/v1/invoices/:id/mark-paid', () => {
    it('should mark invoice as paid', async () => {
      const response = await axios.post(
        `${API_URL}/invoices/${invoiceId}/mark-paid`,
        {
          company_id: companyId,
          paid_amount: 15625.00,
          paid_date: '2025-01-20'
        },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('paid');
      expect(response.data.paid_amount).toBe('15625.00');
      expect(response.data.paid_date).toBeTruthy();
    });

    it('should fail without paid_amount', async () => {
      try {
        await axios.post(
          `${API_URL}/invoices/${draftInvoiceId}/mark-paid`,
          {
            company_id: companyId,
            paid_date: '2025-01-20'
          },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('POST /api/v1/invoices/:id/cancel', () => {
    it('should cancel draft invoice', async () => {
      const response = await axios.post(
        `${API_URL}/invoices/${draftInvoiceId}/cancel`,
        { company_id: companyId },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('cancelled');
    });

    it('should not cancel paid invoice', async () => {
      try {
        await axios.post(
          `${API_URL}/invoices/${invoiceId}/cancel`,
          { company_id: companyId },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('GET /api/v1/invoices/stats', () => {
    it('should get invoice statistics', async () => {
      const response = await axios.get(`${API_URL}/invoices/stats`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('total_invoices');
      expect(response.data).toHaveProperty('draft_invoices');
      expect(response.data).toHaveProperty('sent_invoices');
      expect(response.data).toHaveProperty('paid_invoices');
      expect(response.data).toHaveProperty('overdue_invoices');
      expect(response.data).toHaveProperty('total_outstanding');
      expect(response.data).toHaveProperty('total_paid');
      expect(response.data.total_invoices).toBeGreaterThanOrEqual(2);
      expect(response.data.paid_invoices).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DELETE /api/v1/invoices/:id', () => {
    it('should create a new draft invoice for deletion test', async () => {
      const invoiceData = {
        company_id: companyId,
        customer_id: customerId,
        invoice_date: '2025-01-17',
        lines: [
          {
            description: 'To be deleted',
            quantity: 1,
            unit_price: 100.00,
            vat_rate: 25.00
          }
        ]
      };

      const response = await axios.post(
        `${API_URL}/invoices`,
        invoiceData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      const deleteId = response.data.id;

      // Delete the invoice
      const deleteResponse = await axios.delete(`${API_URL}/invoices/${deleteId}`, {
        data: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(deleteResponse.status).toBe(200);

      // Verify it's deleted
      try {
        await axios.get(`${API_URL}/invoices/${deleteId}`, {
          params: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });

    it('should not delete non-draft invoice', async () => {
      try {
        await axios.delete(`${API_URL}/invoices/${invoiceId}`, {
          data: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });
});
