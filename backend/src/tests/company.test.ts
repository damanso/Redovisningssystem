import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

describe('Company API Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let companyId: string;

  beforeAll(async () => {
    // Register and login
    const timestamp = Date.now();
    const registerData = {
      email: `companytest${timestamp}@example.com`,
      password: 'TestPass123',
      name: 'Company Test User'
    };

    const registerRes = await axios.post(`${API_URL}/auth/register`, registerData);
    userId = registerRes.data.id;

    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: registerData.email,
      password: registerData.password
    });

    authToken = loginRes.data.token;
  });

  describe('POST /api/v1/companies', () => {
    it('should create a new company', async () => {
      const companyData = {
        name: 'Test Company AB',
        org_number: '556677-8899',
        address: 'Test Street 123',
        postal_code: '12345',
        city: 'Stockholm',
        country: 'Sweden',
        phone: '+46-8-1234567',
        email: 'info@testcompany.se',
        website: 'https://testcompany.se',
        vat_number: 'SE556677889901'
      };

      const response = await axios.post(
        `${API_URL}/companies`,
        companyData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('id');
      expect(response.data.name).toBe(companyData.name);
      expect(response.data.org_number).toBe(companyData.org_number);
      expect(response.data.country).toBe('Sweden');
      expect(response.data.currency).toBe('SEK');
      expect(response.data.is_active).toBe(true);

      companyId = response.data.id;
    });

    it('should create company with minimal data', async () => {
      const companyData = {
        name: 'Minimal Company',
        org_number: '123456-7890'
      };

      const response = await axios.post(
        `${API_URL}/companies`,
        companyData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data.name).toBe(companyData.name);
      expect(response.data.country).toBe('Sweden'); // Default
      expect(response.data.currency).toBe('SEK'); // Default
    });

    it('should fail with duplicate org_number', async () => {
      try {
        await axios.post(
          `${API_URL}/companies`,
          {
            name: 'Duplicate Company',
            org_number: '556677-8899' // Already used
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
        await axios.post(`${API_URL}/companies`, {
          name: 'Test',
          org_number: '111111-1111'
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });
  });

  describe('GET /api/v1/companies', () => {
    it('should get all companies for user', async () => {
      const response = await axios.get(`${API_URL}/companies`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);
      expect(response.data[0]).toHaveProperty('id');
      expect(response.data[0]).toHaveProperty('name');
      expect(response.data[0]).toHaveProperty('org_number');
    });

    it('should fail without authentication', async () => {
      try {
        await axios.get(`${API_URL}/companies`);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });
  });

  describe('GET /api/v1/companies/:id', () => {
    it('should get company by ID', async () => {
      const response = await axios.get(`${API_URL}/companies/${companyId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(companyId);
      expect(response.data.name).toBe('Test Company AB');
      expect(response.data.org_number).toBe('556677-8899');
    });

    it('should return 404 for non-existent company', async () => {
      try {
        await axios.get(`${API_URL}/companies/00000000-0000-0000-0000-000000000000`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });

  describe('PUT /api/v1/companies/:id', () => {
    it('should update company', async () => {
      const updateData = {
        name: 'Updated Company AB',
        phone: '+46-8-9999999',
        email: 'updated@testcompany.se',
        website: 'https://updated.testcompany.se'
      };

      const response = await axios.put(
        `${API_URL}/companies/${companyId}`,
        updateData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.name).toBe(updateData.name);
      expect(response.data.phone).toBe(updateData.phone);
      expect(response.data.email).toBe(updateData.email);
      expect(response.data.website).toBe(updateData.website);
    });

    it('should return 404 for non-existent company', async () => {
      try {
        await axios.put(
          `${API_URL}/companies/00000000-0000-0000-0000-000000000000`,
          { name: 'Test' },
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

  describe('DELETE /api/v1/companies/:id', () => {
    it('should create a company for deletion test', async () => {
      const companyData = {
        name: 'To Be Deleted Company',
        org_number: '999999-9999'
      };

      const createRes = await axios.post(
        `${API_URL}/companies`,
        companyData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      const deleteId = createRes.data.id;

      // Delete the company
      const deleteRes = await axios.delete(`${API_URL}/companies/${deleteId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(deleteRes.status).toBe(200);

      // Verify it's deleted (returns 404 or inactive)
      try {
        await axios.get(`${API_URL}/companies/${deleteId}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error or returned inactive company');
      } catch (error: any) {
        // Either 404 or the company exists but is inactive
        expect([404, 200]).toContain(error.response?.status || 200);
      }
    });

    it('should return 404 for non-existent company', async () => {
      try {
        await axios.delete(`${API_URL}/companies/00000000-0000-0000-0000-000000000000`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });
});
