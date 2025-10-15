import request from 'supertest';
import app from '../../app.js';

describe('User Management Integration Tests', () => {
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    // Register and login
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `testuser_${Date.now()}@example.com`,
        password: 'TestPass123!',
        name: 'Test User',
      });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: registerRes.body.email,
        password: 'TestPass123!',
      });

    authToken = loginRes.body.token;
    userId = loginRes.body.user.id;
  });

  describe('GET /api/v1/users/me', () => {
    it('should return current user profile', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('email');
      expect(res.body).toHaveProperty('name');
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('should return 401 without token', async () => {
      await request(app).get('/api/v1/users/me').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('PUT /api/v1/users/me', () => {
    it('should update user profile', async () => {
      const res = await request(app)
        .put('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Name',
          phone: '+46701234567',
        })
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
      expect(res.body.phone).toBe('+46701234567');
    });

    it('should update only provided fields', async () => {
      const res = await request(app)
        .put('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          phone: '+46709876543',
        })
        .expect(200);

      expect(res.body.phone).toBe('+46709876543');
      expect(res.body.name).toBe('Updated Name'); // Previous value
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .put('/api/v1/users/me')
        .send({ name: 'Test' })
        .expect(401);
    });
  });

  describe('POST /api/v1/users/me/change-password', () => {
    it('should change password', async () => {
      await request(app)
        .post('/api/v1/users/me/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          current_password: 'TestPass123!',
          new_password: 'NewPass123!',
        })
        .expect(200);

      // Verify can login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: (await request(app)
            .get('/api/v1/users/me')
            .set('Authorization', `Bearer ${authToken}`)).body.email,
          password: 'NewPass123!',
        })
        .expect(200);

      expect(loginRes.body).toHaveProperty('token');

      // Update authToken for subsequent tests
      authToken = loginRes.body.token;
    });

    it('should reject incorrect current password', async () => {
      await request(app)
        .post('/api/v1/users/me/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          current_password: 'WrongPassword',
          new_password: 'NewPass456!',
        })
        .expect(400);
    });

    it('should reject short password', async () => {
      await request(app)
        .post('/api/v1/users/me/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          current_password: 'NewPass123!',
          new_password: 'short',
        })
        .expect(400);
    });

    it('should require both passwords', async () => {
      await request(app)
        .post('/api/v1/users/me/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          current_password: 'NewPass123!',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/users/:id (admin only)', () => {
    it('should return 403 for non-admin users', async () => {
      await request(app)
        .get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/users (admin only)', () => {
    it('should return 403 for non-admin users', async () => {
      await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });
});
