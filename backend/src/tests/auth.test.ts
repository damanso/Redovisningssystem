import request from 'supertest';
import app from '../app.js';

describe('Auth API', () => {
  const testUser = {
    email: `test${Date.now()}@example.com`,
    password: 'SecurePass123!',
    name: 'Test User'
  };

  describe('POST /api/v1/auth/register', () => {
    it('should create a new user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe(testUser.email);
      expect(res.body.name).toBe(testUser.name);
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('should reject registration without email', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ password: 'test123', name: 'Test' })
        .expect(400);
    });

    it('should reject registration with short password', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'short', name: 'Test' })
        .expect(400);
    });

    it('should reject duplicate email', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return token for valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        })
        .expect(200);

      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(testUser.email);
    });

    it('should reject invalid credentials', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword'
        })
        .expect(401);
    });

    it('should reject non-existent user', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        })
        .expect(401);
    });

    it('should reject login without email', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ password: 'password123' })
        .expect(400);
    });
  });

  describe('Health check', () => {
    it('should return OK status', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('timestamp');
    });
  });
});
