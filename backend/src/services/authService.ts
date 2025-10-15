import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import * as auditService from './auditService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export const register = async (email: string, password: string, name: string, ipAddress?: string, userAgent?: string) => {
  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Insert user
  const result = await query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, role, created_at',
    [email, passwordHash, name]
  );

  const user = result.rows[0];

  // Log registration
  await auditService.logAction(user.id, 'auth.register', 'user', {
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  return user;
};

export const login = async (email: string, password: string, ipAddress?: string, userAgent?: string) => {
  // Find user
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    // Log failed login attempt
    await auditService.logAction('00000000-0000-0000-0000-000000000000', 'auth.login', 'user', {
      ipAddress,
      userAgent,
      status: 'failure',
      errorMessage: 'Invalid credentials',
    });
    throw new Error('Invalid credentials');
  }

  const user = result.rows[0];

  // Check if user is active
  if (!user.is_active) {
    await auditService.logAction(user.id, 'auth.login', 'user', {
      entityId: user.id,
      ipAddress,
      userAgent,
      status: 'failure',
      errorMessage: 'Account is deactivated',
    });
    throw new Error('Account is deactivated');
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await auditService.logAction(user.id, 'auth.login', 'user', {
      entityId: user.id,
      ipAddress,
      userAgent,
      status: 'failure',
      errorMessage: 'Invalid credentials',
    });
    throw new Error('Invalid credentials');
  }

  // Update last login
  await query(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [user.id]
  );

  // Log successful login
  await auditService.logAction(user.id, 'auth.login', 'user', {
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  // Generate token
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  };
};

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
};
