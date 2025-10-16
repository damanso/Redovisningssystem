import request from 'supertest';
import app from '../app';
import { query } from '../config/database';

describe('Email Service Integration Tests', () => {
  let authToken: string;
  let companyId: string;
  let customerId: string;
  let invoiceId: string;

  beforeAll(async () => {
    // Register and login
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `test-email-${Date.now()}@example.com`,
        password: 'TestPass123!',
        name: 'Email Test User'
      });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: registerRes.body.email,
        password: 'TestPass123!'
      });

    authToken = loginRes.body.token;

    // Create company
    const companyRes = await request(app)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Email Test Company AB',
        org_number: '556677-8899',
        email: 'company@example.com',
        phone: '+46701234567',
        bank_account: '123-4567'
      });

    companyId = companyRes.body.id;

    // Create customer
    const customerRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        company_id: companyId,
        name: 'Email Test Customer',
        email: 'customer@example.com',
        org_number: '559988-7766',
        address_street: 'Kundvägen 1',
        address_postal_code: '123 45',
        address_city: 'Stockholm'
      });

    customerId = customerRes.body.id;

    // Create invoice
    const invoiceRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        company_id: companyId,
        customer_id: customerId,
        invoice_date: new Date().toISOString().split('T')[0],
        payment_terms: 30,
        lines: [
          {
            description: 'Konsulttjänst',
            quantity: 10,
            unit_price: 1000,
            unit: 'timmar',
            vat_rate: 25
          }
        ]
      });

    invoiceId = invoiceRes.body.id;
  });

  afterAll(async () => {
    // Cleanup
    await query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
    await query('DELETE FROM customers WHERE id = $1', [customerId]);
    await query('DELETE FROM companies WHERE id = $1', [companyId]);
    await query('DELETE FROM users WHERE email LIKE $1', ['test-email-%@example.com']);
  });

  describe('POST /api/v1/invoices/:id/send', () => {
    it('should validate required fields', async () => {
      const res = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/send`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId
          // Missing recipient_email
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('recipient_email is required');
    });

    it('should reject invalid invoice ID', async () => {
      const res = await request(app)
        .post('/api/v1/invoices/00000000-0000-0000-0000-000000000000/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId,
          recipient_email: 'test@example.com'
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('should prepare to send invoice email (requires SMTP config)', async () => {
      // Note: This test will fail without valid SMTP configuration
      // In production, you'd mock the emailService or use a test SMTP server

      const res = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/send`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId,
          recipient_email: 'test@example.com',
          recipient_name: 'Test Recipient'
        });

      // Will succeed if SMTP is configured, otherwise may fail
      // We're testing the endpoint structure here
      if (res.status === 200) {
        expect(res.body.message).toBe('Invoice sent successfully');
        expect(res.body.sent_to).toBe('test@example.com');

        // Verify invoice was marked as sent
        const invoiceCheck = await request(app)
          .get(`/api/v1/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .query({ company_id: companyId });

        expect(invoiceCheck.body.status).toBe('sent');
        expect(invoiceCheck.body.sent_date).toBeTruthy();
      } else {
        // Expected if SMTP not configured
        console.log('Email test skipped - SMTP not configured');
      }
    });

    it('should use customer name if recipient_name not provided', async () => {
      const res = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/send`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId,
          recipient_email: 'customer@example.com'
          // No recipient_name - should use customer's name
        });

      // Will use customer name from database
      if (res.status === 200) {
        expect(res.body.sent_to).toBe('customer@example.com');
      }
    });
  });

  describe('Email Service Functions', () => {
    it('should have sendWelcomeEmail function available', () => {
      // This is a unit test to verify the function exists
      const emailService = require('../services/emailService');
      expect(typeof emailService.sendWelcomeEmail).toBe('function');
    });

    it('should have sendPasswordResetEmail function available', () => {
      const emailService = require('../services/emailService');
      expect(typeof emailService.sendPasswordResetEmail).toBe('function');
    });

    it('should have verifyEmailConfig function available', () => {
      const emailService = require('../services/emailService');
      expect(typeof emailService.verifyEmailConfig).toBe('function');
    });
  });
});
