import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:3000/api/v1';

describe('Receipt Management API Integration Tests', () => {
  let authToken: string;
  let companyId: string;
  let supplierId: string;
  let receiptId: string;

  beforeAll(async () => {
    // Register and login
    const timestamp = Date.now();
    const registerData = {
      email: `receipttest${timestamp}@example.com`,
      password: 'TestPass123',
      name: 'Receipt Test User'
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
        name: 'Test Receipt Company',
        org_number: `${timestamp}`
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );

    companyId = companyRes.data.id;

    // Create a test supplier
    const supplierRes = await axios.post(
      `${API_URL}/suppliers`,
      {
        company_id: companyId,
        name: 'Test Supplier AB',
        org_number: '5566778899',
        email: 'supplier@test.se'
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );

    supplierId = supplierRes.data.id;
  });

  describe('POST /api/v1/receipts/upload', () => {
    it('should upload a receipt with file', async () => {
      // Create a simple text file to simulate a receipt
      const testFilePath = path.join(__dirname, 'test-receipt.txt');
      fs.writeFileSync(testFilePath, 'Test Receipt Content');

      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFilePath));
      formData.append('company_id', companyId);
      formData.append('supplier_id', supplierId);
      formData.append('receipt_date', '2025-01-15');
      formData.append('amount', '1000.00');
      formData.append('vat_amount', '250.00');
      formData.append('category', 'Office Supplies');
      formData.append('description', 'Test receipt upload');

      const response = await axios.post(
        `${API_URL}/receipts/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            ...formData.getHeaders()
          }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('id');
      expect(response.data.amount).toBe(1000);
      expect(response.data.vat_amount).toBe(250);
      expect(response.data.total_amount).toBe(1250);
      expect(response.data.status).toBe('pending');
      expect(response.data.file_url).toContain('/uploads/receipts/');

      receiptId = response.data.id;

      // Clean up test file
      fs.unlinkSync(testFilePath);
    });

    it('should upload receipt without supplier', async () => {
      const testFilePath = path.join(__dirname, 'test-receipt2.txt');
      fs.writeFileSync(testFilePath, 'Test Receipt 2');

      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFilePath));
      formData.append('company_id', companyId);
      formData.append('receipt_date', '2025-01-16');
      formData.append('amount', '500.00');

      const response = await axios.post(
        `${API_URL}/receipts/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            ...formData.getHeaders()
          }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data.supplier_id).toBeNull();

      fs.unlinkSync(testFilePath);
    });

    it('should fail without file', async () => {
      const formData = new FormData();
      formData.append('company_id', companyId);
      formData.append('amount', '100.00');

      try {
        await axios.post(
          `${API_URL}/receipts/upload`,
          formData,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              ...formData.getHeaders()
            }
          }
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });

    it('should fail without authentication', async () => {
      const testFilePath = path.join(__dirname, 'test-receipt-noauth.txt');
      fs.writeFileSync(testFilePath, 'Test');

      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFilePath));
      formData.append('company_id', companyId);
      formData.append('amount', '100.00');

      try {
        await axios.post(`${API_URL}/receipts/upload`, formData, {
          headers: formData.getHeaders()
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      } finally {
        fs.unlinkSync(testFilePath);
      }
    });
  });

  describe('GET /api/v1/receipts', () => {
    it('should get all receipts for company', async () => {
      const response = await axios.get(`${API_URL}/receipts`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter receipts by supplier', async () => {
      const response = await axios.get(`${API_URL}/receipts`, {
        params: {
          company_id: companyId,
          supplier_id: supplierId
        },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      response.data.forEach((receipt: any) => {
        expect(receipt.supplier_id).toBe(supplierId);
      });
    });

    it('should filter receipts by status', async () => {
      const response = await axios.get(`${API_URL}/receipts`, {
        params: {
          company_id: companyId,
          status: 'pending'
        },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      response.data.forEach((receipt: any) => {
        expect(receipt.status).toBe('pending');
      });
    });

    it('should filter receipts by date range', async () => {
      const response = await axios.get(`${API_URL}/receipts`, {
        params: {
          company_id: companyId,
          start_date: '2025-01-01',
          end_date: '2025-12-31'
        },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    it('should paginate receipts', async () => {
      const response = await axios.get(`${API_URL}/receipts`, {
        params: {
          company_id: companyId,
          limit: 1,
          offset: 0
        },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/v1/receipts/:id', () => {
    it('should get receipt by ID', async () => {
      const response = await axios.get(`${API_URL}/receipts/${receiptId}`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(receiptId);
      expect(response.data).toHaveProperty('file_url');
      expect(response.data).toHaveProperty('status');
    });

    it('should return 404 for non-existent receipt', async () => {
      try {
        await axios.get(`${API_URL}/receipts/99999999-9999-9999-9999-999999999999`, {
          params: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });

  describe('PUT /api/v1/receipts/:id', () => {
    it('should update receipt', async () => {
      const response = await axios.put(
        `${API_URL}/receipts/${receiptId}`,
        {
          company_id: companyId,
          description: 'Updated description',
          category: 'Updated Category',
          amount: 1200.00
        },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.description).toBe('Updated description');
      expect(response.data.category).toBe('Updated Category');
      expect(response.data.amount).toBe(1200);
    });

    it('should update receipt status', async () => {
      const response = await axios.put(
        `${API_URL}/receipts/${receiptId}`,
        {
          company_id: companyId,
          status: 'processed'
        },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('processed');
    });

    it('should update receipt with OCR data', async () => {
      const ocrData = {
        vendor: 'Test Vendor',
        date: '2025-01-15',
        total: 1250,
        confidence: 0.95
      };

      const response = await axios.put(
        `${API_URL}/receipts/${receiptId}`,
        {
          company_id: companyId,
          ocr_data: ocrData
        },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.ocr_data).toEqual(ocrData);
    });

    it('should return 404 for non-existent receipt', async () => {
      try {
        await axios.put(
          `${API_URL}/receipts/99999999-9999-9999-9999-999999999999`,
          {
            company_id: companyId,
            description: 'Test'
          },
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

  describe('GET /api/v1/receipts/stats', () => {
    it('should get receipt statistics', async () => {
      const response = await axios.get(`${API_URL}/receipts/stats`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('total_receipts');
      expect(response.data).toHaveProperty('pending_receipts');
      expect(response.data).toHaveProperty('processed_receipts');
      expect(response.data).toHaveProperty('booked_receipts');
      expect(response.data).toHaveProperty('total_amount');
      expect(response.data).toHaveProperty('total_vat');
      expect(response.data.total_receipts).toBeGreaterThanOrEqual(2);
    });

    it('should get statistics with date filter', async () => {
      const response = await axios.get(`${API_URL}/receipts/stats`, {
        params: {
          company_id: companyId,
          start_date: '2025-01-01',
          end_date: '2025-12-31'
        },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('total_receipts');
    });
  });

  describe('DELETE /api/v1/receipts/:id', () => {
    it('should not delete processed receipt by default', async () => {
      try {
        await axios.delete(`${API_URL}/receipts/${receiptId}`, {
          data: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        // We expect this to pass if we implement the delete protection
        expect(error.response.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('should create and delete a pending receipt', async () => {
      // Create a new receipt
      const testFilePath = path.join(__dirname, 'test-delete-receipt.txt');
      fs.writeFileSync(testFilePath, 'To be deleted');

      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFilePath));
      formData.append('company_id', companyId);
      formData.append('receipt_date', '2025-01-17');
      formData.append('amount', '100.00');

      const createRes = await axios.post(
        `${API_URL}/receipts/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            ...formData.getHeaders()
          }
        }
      );

      const deleteId = createRes.data.id;
      fs.unlinkSync(testFilePath);

      // Delete the receipt
      const deleteResponse = await axios.delete(`${API_URL}/receipts/${deleteId}`, {
        data: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(deleteResponse.status).toBe(200);

      // Verify it's deleted
      try {
        await axios.get(`${API_URL}/receipts/${deleteId}`, {
          params: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });

    it('should not allow deleting booked receipts', async () => {
      // Create and book a receipt
      const testFilePath = path.join(__dirname, 'test-booked-receipt.txt');
      fs.writeFileSync(testFilePath, 'Booked receipt');

      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFilePath));
      formData.append('company_id', companyId);
      formData.append('receipt_date', '2025-01-18');
      formData.append('amount', '200.00');

      const createRes = await axios.post(
        `${API_URL}/receipts/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            ...formData.getHeaders()
          }
        }
      );

      const bookedId = createRes.data.id;
      fs.unlinkSync(testFilePath);

      // Mark as booked
      await axios.put(
        `${API_URL}/receipts/${bookedId}`,
        {
          company_id: companyId,
          status: 'booked'
        },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      // Try to delete
      try {
        await axios.delete(`${API_URL}/receipts/${bookedId}`, {
          data: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toContain('booked');
      }
    });
  });
});
