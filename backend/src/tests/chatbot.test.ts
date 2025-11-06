import request from 'supertest';
import app from '../app';

describe('Chatbot API', () => {
  let authToken: string;
  let testCompanyId: number;
  let conversationId: string;

  // Login before tests
  beforeAll(async () => {
    // This assumes you have test user/company setup
    // Adjust according to your test setup
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    if (loginResponse.status === 200) {
      authToken = loginResponse.body.token;
      testCompanyId = 1; // Use appropriate test company ID
    }
  });

  describe('POST /api/v1/chatbot/conversations', () => {
    it('should create a new conversation', async () => {
      if (!authToken) {
        return; // Skip if no auth token
      }

      const response = await request(app)
        .post('/api/v1/chatbot/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          companyId: testCompanyId,
          message: 'Vad är BAS-kontot för kontorsmaterial?'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('conversationId');
      expect(response.body).toHaveProperty('message');

      conversationId = response.body.conversationId;
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/chatbot/conversations')
        .send({
          companyId: testCompanyId,
          message: 'Test message'
        });

      expect(response.status).toBe(401);
    });

    it('should return 400 without required fields', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .post('/api/v1/chatbot/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          companyId: testCompanyId
          // Missing message
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/chatbot/conversations', () => {
    it('should get all conversations for a company', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .get(`/api/v1/chatbot/conversations?companyId=${testCompanyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/v1/chatbot/conversations?companyId=${testCompanyId}`);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/chatbot/conversations/:conversationId/messages', () => {
    it('should send a message to existing conversation', async () => {
      if (!authToken || !conversationId) {
        return;
      }

      const response = await request(app)
        .post(`/api/v1/chatbot/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Kan du förklara mer om moms?'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
    });

    it('should return 404 for non-existent conversation', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .post('/api/v1/chatbot/conversations/000000000000000000000000/messages')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Test message'
        });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/v1/chatbot/conversations/:conversationId', () => {
    it('should get a single conversation', async () => {
      if (!authToken || !conversationId) {
        return;
      }

      const response = await request(app)
        .get(`/api/v1/chatbot/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('_id');
      expect(response.body).toHaveProperty('messages');
      expect(Array.isArray(response.body.messages)).toBe(true);
    });

    it('should return 404 for non-existent conversation', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .get('/api/v1/chatbot/conversations/000000000000000000000000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/chatbot/conversations/:conversationId', () => {
    it('should delete a conversation', async () => {
      if (!authToken || !conversationId) {
        return;
      }

      const response = await request(app)
        .delete(`/api/v1/chatbot/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
    });

    it('should return 404 when deleting non-existent conversation', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .delete('/api/v1/chatbot/conversations/000000000000000000000000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });
});
