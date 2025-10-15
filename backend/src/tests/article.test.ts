import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

describe('Article API Integration Tests', () => {
  let authToken: string;
  let companyId: string;
  let articleId: string;

  beforeAll(async () => {
    // Register and login
    const timestamp = Date.now();
    const registerData = {
      email: `articletest${timestamp}@example.com`,
      password: 'TestPass123!',
      name: 'Article Test User'
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
  });

  describe('POST /api/v1/articles', () => {
    it('should create a new article', async () => {
      const articleData = {
        company_id: companyId,
        name: 'Konsulttjänst',
        description: 'Timkonsultation utveckling',
        article_number: 'KONS-001',
        price: 1200.00,
        unit: 'timme',
        vat_rate: 25.00,
        account_number: 3001,
        category: 'Tjänster'
      };

      const response = await axios.post(
        `${API_URL}/articles`,
        articleData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('id');
      expect(response.data.name).toBe(articleData.name);
      expect(response.data.company_id).toBe(companyId);
      expect(response.data.price).toBe('1200.00');
      expect(response.data.unit).toBe('timme');
      expect(response.data.vat_rate).toBe('25.00');
      expect(response.data.account_number).toBe(3001);
      expect(response.data.category).toBe('Tjänster');
      expect(response.data.is_active).toBe(true);

      articleId = response.data.id;
    });

    it('should create article with minimal data', async () => {
      const articleData = {
        company_id: companyId,
        name: 'Produkt utan detaljer',
        price: 99.90,
        vat_rate: 25.00
      };

      const response = await axios.post(
        `${API_URL}/articles`,
        articleData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(201);
      expect(response.data.name).toBe(articleData.name);
      expect(response.data.unit).toBe('st'); // Default value
      expect(response.data.price).toBe('99.90');
    });

    it('should fail without authentication', async () => {
      const articleData = {
        name: 'Test Article',
        price: 100,
        vat_rate: 25
      };

      try {
        await axios.post(`${API_URL}/articles`, articleData);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });

    it('should fail with missing required fields', async () => {
      try {
        await axios.post(
          `${API_URL}/articles`,
          { name: 'Incomplete Article' }, // Missing price and vat_rate
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

  describe('GET /api/v1/articles', () => {
    it('should get all articles for company', async () => {
      const response = await axios.get(`${API_URL}/articles`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('articles');
      expect(response.data).toHaveProperty('total');
      expect(Array.isArray(response.data.articles)).toBe(true);
      expect(response.data.total).toBeGreaterThan(0);
    });

    it('should filter articles by search term', async () => {
      const response = await axios.get(`${API_URL}/articles`, {
        params: { company_id: companyId, search: 'Konsulttjänst' },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.articles.length).toBeGreaterThan(0);
      expect(response.data.articles[0].name).toContain('Konsulttjänst');
    });

    it('should filter articles by category', async () => {
      const response = await axios.get(`${API_URL}/articles`, {
        params: { company_id: companyId, category: 'Tjänster' },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.articles.length).toBeGreaterThan(0);
      expect(response.data.articles[0].category).toBe('Tjänster');
    });

    it('should filter articles by active status', async () => {
      const response = await axios.get(`${API_URL}/articles`, {
        params: { company_id: companyId, is_active: true },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      response.data.articles.forEach((article: any) => {
        expect(article.is_active).toBe(true);
      });
    });

    it('should paginate articles', async () => {
      const response = await axios.get(`${API_URL}/articles`, {
        params: { company_id: companyId, limit: 1, offset: 0 },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.articles.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/v1/articles/:id', () => {
    it('should get article by ID', async () => {
      const response = await axios.get(`${API_URL}/articles/${articleId}`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(articleId);
      expect(response.data.name).toBe('Konsulttjänst');
    });

    it('should return 404 for non-existent article', async () => {
      try {
        await axios.get(`${API_URL}/articles/00000000-0000-0000-0000-000000000000`, {
          params: { company_id: companyId },
          headers: { Authorization: `Bearer ${authToken}` }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });
  });

  describe('PUT /api/v1/articles/:id', () => {
    it('should update article', async () => {
      const updateData = {
        company_id: companyId,
        name: 'Konsulttjänst Senior',
        price: 1500.00,
        description: 'Senior konsultation'
      };

      const response = await axios.put(
        `${API_URL}/articles/${articleId}`,
        updateData,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.name).toBe(updateData.name);
      expect(response.data.price).toBe('1500.00');
      expect(response.data.description).toBe(updateData.description);
    });

    it('should return 404 for non-existent article', async () => {
      try {
        await axios.put(
          `${API_URL}/articles/00000000-0000-0000-0000-000000000000`,
          { company_id: companyId, name: 'Updated' },
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

  describe('DELETE /api/v1/articles/:id', () => {
    it('should soft delete article', async () => {
      const response = await axios.delete(`${API_URL}/articles/${articleId}`, {
        data: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);

      // Verify article is marked as inactive
      const getResponse = await axios.get(`${API_URL}/articles/${articleId}`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(getResponse.data.is_active).toBe(false);
    });
  });

  describe('GET /api/v1/articles/stats', () => {
    it('should get article statistics', async () => {
      const response = await axios.get(`${API_URL}/articles/stats`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('total_articles');
      expect(response.data).toHaveProperty('active_articles');
      expect(response.data).toHaveProperty('inactive_articles');
      expect(response.data).toHaveProperty('categories_count');
    });
  });

  describe('GET /api/v1/articles/popular', () => {
    it('should get popular articles', async () => {
      const response = await axios.get(`${API_URL}/articles/popular`, {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await axios.get(`${API_URL}/articles/popular`, {
        params: { company_id: companyId, limit: 5 },
        headers: { Authorization: `Bearer ${authToken}` }
      });

      expect(response.status).toBe(200);
      expect(response.data.length).toBeLessThanOrEqual(5);
    });
  });
});
