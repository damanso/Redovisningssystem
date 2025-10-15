import express from 'express';
import { register, login } from '../services/authService.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password and name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.get('user-agent');

    const user = await register(email, password, name, ipAddress, userAgent);
    res.status(201).json(user);
  } catch (error: any) {
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error('Register error:', error);
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.get('user-agent');

    const result = await login(email, password, ipAddress, userAgent);
    res.json(result);
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || 'Authentication failed' });
  }
});

export default router;
