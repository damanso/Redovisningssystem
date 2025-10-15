CLAUDE.md - KOMPLETT PROJEKTDOKUMENTATION
AI-Drivet Redovisningssystem - För Claude Code i VS Code

VERSION: 2.0 - Claude Code Edition
SKAPAD: 2024-10-14
SENAST UPPDATERAD: 2024-10-14

📋 OM DENNA FIL
Syfte
Detta är den enda dokumentationsfilen du behöver för att bygga hela redovisningssystemet med Claude Code i VS Code.
Hur det fungerar
För Claude Code:

Läser automatiskt denna fil när du arbetar i projektet
Alla instruktioner är direkta och exekverbara
Skapar filer och kod direkt i projektet
Ingen manuell kopiering behövs

För dig som utvecklare:

Öppna projektet i VS Code med Claude Code extension
Be Claude Code utföra uppgifter från denna dokumentation
Claude Code läser denna fil och implementerar automatiskt

Exempel:
Du: "Implementera autentiseringssystemet enligt Fas 0"
Claude Code: [läser denna fil → skapar alla auth-filer → informerar när klart]

Du: "Kör alla tester"
Claude Code: [kör npm test → visar resultat]
Innehåll
Denna fil innehåller:

✅ Projektöversikt och teknisk stack
✅ Komplett projektstruktur
✅ Alla 4 utvecklingsfaser med instruktioner
✅ 45+ moduler steg-för-steg
✅ Testnings och verifieringsguider
✅ Löpande kvalitetskontroller
✅ Deployment instruktioner


🎯 SNABBSTART
Steg 1: Setup projekt
Du till Claude Code: "Skapa projektstrukturen enligt Fas 0"
Claude Code kommer då:

Skapa alla mappar och filer
Generera package.json med dependencies
Skapa tsconfig, docker-compose, .env.example
Informera när klart

Steg 2: Installera och starta
bash# Installera dependencies
cd frontend && npm install
cd ../backend && npm install

# Starta databaser
docker-compose up -d

# Starta dev servers
# Terminal 1:
cd frontend && npm run dev

# Terminal 2:
cd backend && npm run dev
Steg 3: Bygg features
Du: "Implementera User Management enligt Fas 1"
Claude Code: [skapar alla user-relaterade filer]

Du: "Implementera Customer CRM"
Claude Code: [skapar alla customer-filer]

Du: "Implementera Invoice Module"
Claude Code: [skapar alla invoice-filer]
Steg 4: Testa kontinuerligt
Du: "Kör tester för authentication"
Claude Code: [npm test -- auth.test.ts]

Du: "Kör veckovis kvalitetskontroll"
Claude Code: [kör quality check script]

📊 PROJEKTÖVERSIKT
Vad vi bygger
Ett modernt AI-drivet redovisningssystem som ersätter Fortnox och Visma.
Huvudfunktioner
MVP (16 veckor):

Användarhantering med autentisering (JWT, 2FA)
Kundfakturering med PDF-generering
Kvittohantering med AI OCR
Automatisk bokföring (BAS-kontoplanen)
Dashboard och grundrapporter
CRM för kunder/leverantörer

Full version (36 veckor):

AI Chatbot-assistent
Återkommande fakturor
Tidrapportering och projekt
Skatteverket-integration
Bank-integration
Budget och prognoser
Multi-bolag support
Mobilapp

Teknisk Stack
Frontend: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
Backend: Node.js 20 + Express + TypeScript
Databaser: PostgreSQL 15 + MongoDB 6 + Redis 7
AI: Claude, GPT-4, Gemini (multi-provider)
Storage: AWS S3 / Google Cloud Storage

📁 PROJEKTSTRUKTUR
redovisningssystem/
├── Claude.md                    # DENNA FIL
├── frontend/                    # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── types/
│   └── package.json
├── backend/                     # Node.js backend
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   └── middleware/
│   └── package.json
├── database/
│   ├── migrations/
│   └── seeds/
└── scripts/
    └── verify-setup.js

🚀 UTVECKLINGSFASER
Fas 0: Setup (1 vecka)
Mål: Grundläggande projektstruktur

Projektinitalisering
Databas setup
Autentiseringssystem

Fas 1: Foundation (4 veckor)
Mål: Användarhantering och grundsystem

User Management
Company Settings
Audit Log System

Fas 2: MVP Core (12 veckor)
Mål: Kärnfunktionalitet

Customer CRM
Invoice Module
Receipt Management
AI OCR
Accounting
Dashboard & Reports

Fas 3: Enhanced (8 veckor)
Mål: Förbättrad funktionalitet

AI Chatbot
Recurring Invoices
Project Management
Integrations

Fas 4: Advanced (12 veckor)
Mål: Enterprise features

Multi-Company
Bank Integration
Mobile App
Advanced Analytics


🏗️ FAS 0: SETUP OCH FOUNDATION
STEG 0.1: Projektinitalisering
Instruktion:
Skapa följande projektstruktur och konfigurationsfiler:
1. Projektmappar:
bashredovisningssystem/
├── frontend/
├── backend/
├── database/
├── scripts/
└── docs/
2. Frontend package.json:
Filsökväg: frontend/package.json
json{
  "name": "redovisning-frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.4.0",
    "axios": "^1.6.0",
    "react-hook-form": "^7.48.0",
    "zod": "^3.22.0",
    "@hookform/resolvers": "^3.3.0",
    "recharts": "^2.10.0",
    "date-fns": "^2.30.0",
    "lucide-react": "^0.294.0",
    "clsx": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "vitest": "^1.0.0"
  }
}
3. Backend package.json:
Filsökväg: backend/package.json
json{
  "name": "redovisning-backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "dotenv": "^16.3.0",
    "pg": "^8.11.0",
    "mongodb": "^6.3.0",
    "ioredis": "^5.3.0",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "tsx": "^4.6.0",
    "jest": "^29.7.0"
  }
}
4. Docker Compose:
Filsökväg: docker-compose.yml
yamlversion: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: redovisning
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mongodb:
    image: mongo:6-alpine
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  mongodb_data:
  redis_data:
5. Environment Variables:
Filsökväg: .env.example
bash# Server
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=redovisning
DB_USER=postgres
DB_PASSWORD=postgres

# MongoDB
MONGO_URL=mongodb://localhost:27017/redovisning

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=24h

# AI APIs
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key
Verifiering:
Efter skapande, kör:
bash# Installera dependencies
cd frontend && npm install
cd ../backend && npm install

# Starta databaser
docker-compose up -d

# Verifiera connections
docker ps  # Alla containers ska vara "Up"

STEG 0.2: Databas Konfiguration
Instruktion:
Skapa databaskonfiguration och initial schema.
1. PostgreSQL Connection:
Filsökväg: backend/src/config/database.ts
typescriptimport { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'redovisning',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

export const query = async (text: string, params?: any[]) => {
  const res = await pool.query(text, params);
  return res;
};

export default pool;
2. Database Schema:
Filsökväg: database/migrations/001_initial_schema.sql
sqlCREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Companies table  
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    org_number VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-Company relationship
CREATE TABLE user_companies (
    user_id UUID REFERENCES users(id),
    company_id UUID REFERENCES companies(id),
    role VARCHAR(50) DEFAULT 'member',
    PRIMARY KEY (user_id, company_id)
);
Kör migration:
bashdocker exec -i redovisning-postgres psql -U postgres -d redovisning < database/migrations/001_initial_schema.sql

STEG 0.3: Autentiseringssystem
Instruktion:
Implementera JWT-baserad autentisering.
1. Auth Service:
Filsökväg: backend/src/services/authService.ts
typescriptimport bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export const register = async (email: string, password: string, name: string) => {
  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);
  
  // Insert user
  const result = await query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
    [email, passwordHash, name]
  );
  
  return result.rows[0];
};

export const login = async (email: string, password: string) => {
  // Find user
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Invalid credentials');
  }
  
  const user = result.rows[0];
  
  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid credentials');
  }
  
  // Generate token
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  return { token, user: { id: user.id, email: user.email, name: user.name } };
};
2. Auth Routes:
Filsökväg: backend/src/routes/auth.ts
typescriptimport express from 'express';
import { register, login } from '../services/authService';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const user = await register(email, password, name);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

export default router;
3. Main App:
Filsökväg: backend/src/app.ts
typescriptimport express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/v1/auth', authRoutes);

export default app;
4. Server:
Filsökväg: backend/src/server.ts
typescriptimport app from './app';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
Testning:
Skapa: backend/src/tests/auth.test.ts
typescriptimport request from 'supertest';
import app from '../app';

describe('Auth API', () => {
  test('POST /api/v1/auth/register creates user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'test@example.com',
        password: 'SecurePass123!',
        name: 'Test User'
      });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
  
  test('POST /api/v1/auth/login returns token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'SecurePass123!'
      });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });
});

🏗️ FAS 1: FOUNDATION MODULES
Översikt

Tid: 4 veckor
Mål: Användarhantering och grundsystem
Output: Komplett user/company management


STEG 1.1: User Management
Instruktion:
Implementera komplett användarhantering med profiler, roller och aktivitetsloggning.
1. User Model och Types:
Filsökväg: backend/src/types/user.types.ts
typescriptexport interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar_url?: string;
  role: 'admin' | 'user' | 'accountant' | 'viewer';
  is_active: boolean;
  email_verified: boolean;
  two_factor_enabled: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserDto {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role?: string;
}

export interface UpdateUserDto {
  name?: string;
  phone?: string;
  avatar_url?: string;
}

export interface ChangePasswordDto {
  current_password: string;
  new_password: string;
}
2. User Service:
Filsökväg: backend/src/services/userService.ts
typescriptimport { query } from '../config/database';
import bcrypt from 'bcrypt';
import { User, CreateUserDto, UpdateUserDto } from '../types/user.types';

export const getUserById = async (userId: string): Promise<User | null> => {
  const result = await query(
    `SELECT id, email, name, phone, avatar_url, role, is_active, 
            email_verified, two_factor_enabled, last_login, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );
  
  return result.rows[0] || null;
};

export const getUserByEmail = async (email: string): Promise<User | null> => {
  const result = await query(
    `SELECT id, email, name, phone, avatar_url, role, is_active,
            email_verified, two_factor_enabled, last_login, created_at, updated_at
     FROM users WHERE email = $1`,
    [email]
  );
  
  return result.rows[0] || null;
};

export const getAllUsers = async (companyId?: string): Promise<User[]> => {
  let queryText = `
    SELECT DISTINCT u.id, u.email, u.name, u.phone, u.avatar_url, u.role,
           u.is_active, u.email_verified, u.two_factor_enabled,
           u.last_login, u.created_at, u.updated_at
    FROM users u
  `;
  
  const params: any[] = [];
  
  if (companyId) {
    queryText += `
      INNER JOIN user_companies uc ON u.id = uc.user_id
      WHERE uc.company_id = $1
    `;
    params.push(companyId);
  }
  
  queryText += ` ORDER BY u.created_at DESC`;
  
  const result = await query(queryText, params);
  return result.rows;
};

export const updateUser = async (
  userId: string, 
  updates: UpdateUserDto
): Promise<User> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;
  
  if (updates.name !== undefined) {
    fields.push(`name = $${paramCount}`);
    values.push(updates.name);
    paramCount++;
  }
  
  if (updates.phone !== undefined) {
    fields.push(`phone = $${paramCount}`);
    values.push(updates.phone);
    paramCount++;
  }
  
  if (updates.avatar_url !== undefined) {
    fields.push(`avatar_url = $${paramCount}`);
    values.push(updates.avatar_url);
    paramCount++;
  }
  
  if (fields.length === 0) {
    throw new Error('No fields to update');
  }
  
  values.push(userId);
  
  const result = await query(
    `UPDATE users 
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount}
     RETURNING id, email, name, phone, avatar_url, role, is_active,
               email_verified, two_factor_enabled, last_login, created_at, updated_at`,
    values
  );
  
  return result.rows[0];
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  // Get current password hash
  const result = await query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('User not found');
  }
  
  // Verify current password
  const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!valid) {
    throw new Error('Current password is incorrect');
  }
  
  // Hash new password
  const newPasswordHash = await bcrypt.hash(newPassword, 12);
  
  // Update password
  await query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [newPasswordHash, userId]
  );
};

export const deactivateUser = async (userId: string): Promise<void> => {
  await query(
    'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};

export const activateUser = async (userId: string): Promise<void> => {
  await query(
    'UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};

export const deleteUser = async (userId: string): Promise<void> => {
  // Soft delete - deactivate instead of actual deletion
  await deactivateUser(userId);
};

export const updateLastLogin = async (userId: string): Promise<void> => {
  await query(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};
3. User Controller:
Filsökväg: backend/src/controllers/userController.ts
typescriptimport { Request, Response } from 'express';
import * as userService from '../services/userService';
import { UpdateUserDto, ChangePasswordDto } from '../types/user.types';

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = await userService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    const users = await userService.getAllUsers(companyId as string);
    res.json(users);
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const updates: UpdateUserDto = req.body;
    const user = await userService.updateUser(userId, updates);
    
    res.json(user);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { current_password, new_password }: ChangePasswordDto = req.body;
    
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both passwords are required' });
    }
    
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    await userService.changePassword(userId, current_password, new_password);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    if (error.message === 'Current password is incorrect') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deactivateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await userService.deactivateUser(id);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
4. User Routes:
Filsökväg: backend/src/routes/users.ts
typescriptimport express from 'express';
import * as userController from '../controllers/userController';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get current user
router.get('/me', userController.getCurrentUser);

// Update current user
router.put('/me', userController.updateCurrentUser);

// Change password
router.post('/me/change-password', userController.changePassword);

// Get user by ID (admin only)
router.get('/:id', authorize(['admin']), userController.getUserById);

// Get all users (admin only)
router.get('/', authorize(['admin']), userController.getAllUsers);

// Deactivate user (admin only)
router.post('/:id/deactivate', authorize(['admin']), userController.deactivateUser);

export default router;
5. Authentication Middleware:
Filsökväg: backend/src/middleware/authenticate.ts
typescriptimport { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role?: string;
    };
    
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role || 'user'
    };
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};
6. Authorization Middleware:
Filsökväg: backend/src/middleware/authorize.ts
typescriptimport { Response, NextFunction } from 'express';
import { AuthRequest } from './authenticate';

export const authorize = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;
    
    if (!userRole) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};
7. Uppdatera App:
Filsökväg: backend/src/app.ts
typescriptimport express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
8. Frontend User Service:
Filsökväg: frontend/src/services/userService.ts
typescriptimport axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const getCurrentUser = async () => {
  const response = await axios.get(`${API_URL}/users/me`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateCurrentUser = async (data: {
  name?: string;
  phone?: string;
  avatar_url?: string;
}) => {
  const response = await axios.put(`${API_URL}/users/me`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const changePassword = async (data: {
  current_password: string;
  new_password: string;
}) => {
  const response = await axios.post(`${API_URL}/users/me/change-password`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getAllUsers = async (companyId?: string) => {
  const params = companyId ? { companyId } : {};
  const response = await axios.get(`${API_URL}/users`, {
    headers: getAuthHeader(),
    params
  });
  return response.data;
};
9. Frontend User Hook:
Filsökväg: frontend/src/hooks/useUser.ts
typescriptimport { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as userService from '../services/userService';

export const useCurrentUser = () => {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: userService.getCurrentUser
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: userService.updateCurrentUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    }
  });
};

export const useChangePassword = () => {
  return useMutation({
    mutationFn: userService.changePassword
  });
};

export const useUsers = (companyId?: string) => {
  return useQuery({
    queryKey: ['users', companyId],
    queryFn: () => userService.getAllUsers(companyId)
  });
};
10. Frontend Profile Page:
Filsökväg: frontend/src/pages/settings/ProfilePage.tsx
typescriptimport { useState } from 'react';
import { useCurrentUser, useUpdateUser, useChangePassword } from '../../hooks/useUser';

export default function ProfilePage() {
  const { data: user, isLoading } = useCurrentUser();
  const updateUser = useUpdateUser();
  const changePassword = useChangePassword();
  
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // Set initial values when user data loads
  useState(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone || '');
    }
  }, [user]);
  
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateUser.mutateAsync({ name, phone });
      alert('Profile updated successfully');
    } catch (error) {
      alert('Failed to update profile');
    }
  };
  
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await changePassword.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword
      });
      alert('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      alert('Failed to change password');
    }
  };
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Profile Settings</h1>
      
      {/* Profile Form */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Personal Information</h2>
        <form onSubmit={handleUpdateProfile}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={user?.email}
              disabled
              className="w-full px-4 py-2 border rounded-lg bg-gray-100"
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
          
          <button
            type="submit"
            disabled={updateUser.isPending}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {updateUser.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
      
      {/* Change Password Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Change Password</h2>
        <form onSubmit={handleChangePassword}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
          
          <button
            type="submit"
            disabled={changePassword.isPending}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {changePassword.isPending ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
Testning:
Filsökväg: backend/src/tests/integration/users.test.ts
typescriptimport request from 'supertest';
import app from '../../app';

describe('User Management Integration Tests', () => {
  let authToken: string;
  let userId: string;
  
  beforeAll(async () => {
    // Register and login
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'testuser@example.com',
        password: 'TestPass123!',
        name: 'Test User'
      });
    
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'testuser@example.com',
        password: 'TestPass123!'
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
      expect(res.body.email).toBe('testuser@example.com');
      expect(res.body).not.toHaveProperty('password_hash');
    });
    
    it('should return 401 without token', async () => {
      await request(app)
        .get('/api/v1/users/me')
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
          phone: '+46701234567'
        })
        .expect(200);
      
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.phone).toBe('+46701234567');
    });
  });
  
  describe('POST /api/v1/users/me/change-password', () => {
    it('should change password', async () => {
      await request(app)
        .post('/api/v1/users/me/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          current_password: 'TestPass123!',
          new_password: 'NewPass123!'
        })
        .expect(200);
      
      // Verify can login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'testuser@example.com',
          password: 'NewPass123!'
        })
        .expect(200);
      
      expect(loginRes.body).toHaveProperty('token');
    });
    
    it('should reject incorrect current password', async () => {
      await request(app)
        .post('/api/v1/users/me/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          current_password: 'WrongPassword',
          new_password: 'NewPass123!'
        })
        .expect(400);
    });
  });
});
Verifiering:
Kör:
bashcd backend
npm test -- users.test.ts

STEG 1.2: Company Settings
Instruktion:
Implementera företagsinställningar och multi-tenant support.
[Fortsättning med Company Settings implementation...]

STEG 1.2: Company Settings
Instruktion:
Implementera företagsinställningar och multi-tenant support.
1. Company Types:
Filsökväg: backend/src/types/company.types.ts
typescriptexport interface Company {
  id: string;
  name: string;
  org_number: string;
  email?: string;
  phone?: string;
  website?: string;
  logo_url?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country: string;
  bank_account?: string;
  bank_clearing?: string;
  vat_number?: string;
  fiscal_year_start: number;
  fiscal_year_end: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCompanyDto {
  name: string;
  org_number: string;
  email?: string;
  phone?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country?: string;
  bank_account?: string;
  vat_number?: string;
  fiscal_year_start?: number;
  fiscal_year_end?: number;
}

export interface UpdateCompanyDto extends Partial<CreateCompanyDto> {}

export interface UserCompany {
  user_id: string;
  company_id: string;
  role: 'owner' | 'admin' | 'member' | 'accountant' | 'viewer';
  joined_at: Date;
}
2. Company Service:
Filsökväg: backend/src/services/companyService.ts
typescriptimport { query } from '../config/database';
import { Company, CreateCompanyDto, UpdateCompanyDto, UserCompany } from '../types/company.types';

export const createCompany = async (
  data: CreateCompanyDto,
  userId: string
): Promise<Company> => {
  // Start transaction
  const client = await query('BEGIN', []);
  
  try {
    // Create company
    const companyResult = await query(
      `INSERT INTO companies (
        name, org_number, email, phone, website, logo_url,
        address_street, address_postal_code, address_city, address_country,
        bank_account, bank_clearing, vat_number, fiscal_year_start, fiscal_year_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        data.name,
        data.org_number,
        data.email || null,
        data.phone || null,
        data.website || null,
        null, // logo_url
        data.address_street || null,
        data.address_postal_code || null,
        data.address_city || null,
        data.address_country || 'Sweden',
        data.bank_account || null,
        null, // bank_clearing
        data.vat_number || null,
        data.fiscal_year_start || 1,
        data.fiscal_year_end || 12
      ]
    );
    
    const company = companyResult.rows[0];
    
    // Add user as owner
    await query(
      `INSERT INTO user_companies (user_id, company_id, role)
       VALUES ($1, $2, $3)`,
      [userId, company.id, 'owner']
    );
    
    await query('COMMIT', []);
    
    return company;
  } catch (error) {
    await query('ROLLBACK', []);
    throw error;
  }
};

export const getCompanyById = async (companyId: string): Promise<Company | null> => {
  const result = await query(
    'SELECT * FROM companies WHERE id = $1',
    [companyId]
  );
  return result.rows[0] || null;
};

export const getUserCompanies = async (userId: string): Promise<Company[]> => {
  const result = await query(
    `SELECT c.*, uc.role as user_role
     FROM companies c
     INNER JOIN user_companies uc ON c.id = uc.company_id
     WHERE uc.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId]
  );
  return result.rows;
};

export const updateCompany = async (
  companyId: string,
  updates: UpdateCompanyDto
): Promise<Company> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;
  
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });
  
  if (fields.length === 0) {
    throw new Error('No fields to update');
  }
  
  values.push(companyId);
  
  const result = await query(
    `UPDATE companies 
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

export const addUserToCompany = async (
  userId: string,
  companyId: string,
  role: string = 'member'
): Promise<void> => {
  await query(
    `INSERT INTO user_companies (user_id, company_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, company_id) DO UPDATE SET role = $3`,
    [userId, companyId, role]
  );
};

export const removeUserFromCompany = async (
  userId: string,
  companyId: string
): Promise<void> => {
  await query(
    'DELETE FROM user_companies WHERE user_id = $1 AND company_id = $2',
    [userId, companyId]
  );
};

export const getCompanyUsers = async (companyId: string): Promise<any[]> => {
  const result = await query(
    `SELECT u.id, u.email, u.name, u.phone, uc.role, uc.joined_at
     FROM users u
     INNER JOIN user_companies uc ON u.id = uc.user_id
     WHERE uc.company_id = $1
     ORDER BY uc.joined_at`,
    [companyId]
  );
  return result.rows;
};

export const getUserRoleInCompany = async (
  userId: string,
  companyId: string
): Promise<string | null> => {
  const result = await query(
    'SELECT role FROM user_companies WHERE user_id = $1 AND company_id = $2',
    [userId, companyId]
  );
  return result.rows[0]?.role || null;
};
3. Company Controller:
Filsökväg: backend/src/controllers/companyController.ts
typescriptimport { Request, Response } from 'express';
import * as companyService from '../services/companyService';
import { CreateCompanyDto, UpdateCompanyDto } from '../types/company.types';

export const createCompany = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const data: CreateCompanyDto = req.body;
    const company = await companyService.createCompany(data, userId);
    
    res.status(201).json(company);
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCompanyById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const company = await companyService.getCompanyById(id);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json(company);
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserCompanies = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const companies = await companyService.getUserCompanies(userId);
    res.json(companies);
  } catch (error) {
    console.error('Get user companies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCompany = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates: UpdateCompanyDto = req.body;
    
    const company = await companyService.updateCompany(id, updates);
    res.json(company);
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCompanyUsers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const users = await companyService.getCompanyUsers(id);
    res.json(users);
  } catch (error) {
    console.error('Get company users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addUserToCompany = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { user_id, role } = req.body;
    
    await companyService.addUserToCompany(user_id, id, role);
    res.json({ message: 'User added to company' });
  } catch (error) {
    console.error('Add user to company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
4. Company Routes:
Filsökväg: backend/src/routes/companies.ts
typescriptimport express from 'express';
import * as companyController from '../controllers/companyController';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';

const router = express.Router();

router.use(authenticate);

// Create company
router.post('/', companyController.createCompany);

// Get user's companies
router.get('/my-companies', companyController.getUserCompanies);

// Get company by ID
router.get('/:id', companyController.getCompanyById);

// Update company
router.put('/:id', companyController.updateCompany);

// Get company users
router.get('/:id/users', companyController.getCompanyUsers);

// Add user to company (admin only)
router.post('/:id/users', authorize(['admin', 'owner']), companyController.addUserToCompany);

export default router;
5. Frontend Company Service:
Filsökväg: frontend/src/services/companyService.ts
typescriptimport axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const createCompany = async (data: any) => {
  const response = await axios.post(`${API_URL}/companies`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getUserCompanies = async () => {
  const response = await axios.get(`${API_URL}/companies/my-companies`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCompanyById = async (id: string) => {
  const response = await axios.get(`${API_URL}/companies/${id}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateCompany = async (id: string, data: any) => {
  const response = await axios.put(`${API_URL}/companies/${id}`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCompanyUsers = async (id: string) => {
  const response = await axios.get(`${API_URL}/companies/${id}/users`, {
    headers: getAuthHeader()
  });
  return response.data;
};
6. Frontend Company Hook:
Filsökväg: frontend/src/hooks/useCompany.ts
typescriptimport { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as companyService from '../services/companyService';

export const useUserCompanies = () => {
  return useQuery({
    queryKey: ['companies'],
    queryFn: companyService.getUserCompanies
  });
};

export const useCompany = (id: string) => {
  return useQuery({
    queryKey: ['company', id],
    queryFn: () => companyService.getCompanyById(id),
    enabled: !!id
  });
};

export const useCreateCompany = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: companyService.createCompany,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    }
  });
};

export const useUpdateCompany = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => 
      companyService.updateCompany(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['company'] });
    }
  });
};

export const useCompanyUsers = (id: string) => {
  return useQuery({
    queryKey: ['companyUsers', id],
    queryFn: () => companyService.getCompanyUsers(id),
    enabled: !!id
  });
};
7. Frontend Company Settings Page:
Filsökväg: frontend/src/pages/settings/CompanySettingsPage.tsx
typescriptimport { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useCompany, useUpdateCompany } from '../../hooks/useCompany';

export default function CompanySettingsPage() {
  const { companyId } = useParams();
  const { data: company, isLoading } = useCompany(companyId!);
  const updateCompany = useUpdateCompany();
  
  const [formData, setFormData] = useState({
    name: '',
    org_number: '',
    email: '',
    phone: '',
    website: '',
    address_street: '',
    address_postal_code: '',
    address_city: '',
    bank_account: '',
    vat_number: ''
  });
  
  useEffect(() => {
    if (company) {
      setFormData({
        name: company.name || '',
        org_number: company.org_number || '',
        email: company.email || '',
        phone: company.phone || '',
        website: company.website || '',
        address_street: company.address_street || '',
        address_postal_code: company.address_postal_code || '',
        address_city: company.address_city || '',
        bank_account: company.bank_account || '',
        vat_number: company.vat_number || ''
      });
    }
  }, [company]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateCompany.mutateAsync({ id: companyId!, data: formData });
      alert('Company settings updated successfully');
    } catch (error) {
      alert('Failed to update company settings');
    }
  };
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Company Settings</h1>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Company Information</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Company Name *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Organization Number *</label>
              <input
                type="text"
                name="org_number"
                value={formData.org_number}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Phone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-2">Website</label>
              <input
                type="url"
                name="website"
                value={formData.website}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>
        
        {/* Address */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Address</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-2">Street Address</label>
              <input
                type="text"
                name="address_street"
                value={formData.address_street}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Postal Code</label>
              <input
                type="text"
                name="address_postal_code"
                value={formData.address_postal_code}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">City</label>
              <input
                type="text"
                name="address_city"
                value={formData.address_city}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>
        
        {/* Financial Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Financial Information</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Bank Account</label>
              <input
                type="text"
                name="bank_account"
                value={formData.bank_account}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">VAT Number</label>
              <input
                type="text"
                name="vat_number"
                value={formData.vat_number}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>
        
        <button
          type="submit"
          disabled={updateCompany.isPending}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {updateCompany.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
Uppdatera App med Company Routes:
Filsökväg: backend/src/app.ts
typescriptimport express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import companyRoutes from './routes/companies';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/companies', companyRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
Verifiering:
Efter implementation, be Claude Code:
"Kör tester för company management"

STEG 1.3: Audit Log System
Instruktion:
Implementera audit logging för att spåra alla ändringar i systemet för compliance och säkerhet.
1. Audit Log Types:
Filsökväg: backend/src/types/audit.types.ts
typescriptexport interface AuditLog {
  id: string;
  user_id: string;
  company_id?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes?: any;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface CreateAuditLogDto {
  user_id: string;
  company_id?: string;
  action: 'create' | 'update' | 'delete' | 'view' | 'login' | 'logout';
  entity_type: string;
  entity_id: string;
  changes?: {
    before?: any;
    after?: any;
  };
  ip_address?: string;
  user_agent?: string;
}
2. Audit Log Service:
Filsökväg: backend/src/services/auditLogService.ts
typescriptimport { collections } from '../config/mongodb';
import { CreateAuditLogDto, AuditLog } from '../types/audit.types';

export const createAuditLog = async (data: CreateAuditLogDto): Promise<void> => {
  try {
    await collections.activityLogs().insertOne({
      ...data,
      created_at: new Date()
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logs shouldn't break the application
  }
};

export const getAuditLogs = async (filters: {
  user_id?: string;
  company_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  skip?: number;
}): Promise<AuditLog[]> => {
  const query: any = {};
  
  if (filters.user_id) query.user_id = filters.user_id;
  if (filters.company_id) query.company_id = filters.company_id;
  if (filters.entity_type) query.entity_type = filters.entity_type;
  if (filters.entity_id) query.entity_id = filters.entity_id;
  if (filters.action) query.action = filters.action;
  
  if (filters.start_date || filters.end_date) {
    query.created_at = {};
    if (filters.start_date) query.created_at.$gte = filters.start_date;
    if (filters.end_date) query.created_at.$lte = filters.end_date;
  }
  
  const logs = await collections.activityLogs()
    .find(query)
    .sort({ created_at: -1 })
    .limit(filters.limit || 100)
    .skip(filters.skip || 0)
    .toArray();
  
  return logs as AuditLog[];
};

export const getEntityHistory = async (
  entity_type: string,
  entity_id: string
): Promise<AuditLog[]> => {
  const logs = await collections.activityLogs()
    .find({ entity_type, entity_id })
    .sort({ created_at: -1 })
    .toArray();
  
  return logs as AuditLog[];
};
3. Audit Log Middleware:
Filsökväg: backend/src/middleware/auditLog.ts
typescriptimport { Request, Response, NextFunction } from 'express';
import { createAuditLog } from '../services/auditLogService';
import { AuthRequest } from './authenticate';

export const auditLog = (action: string, entity_type: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data: any) {
      // Log after successful response
      if (res.statusCode < 400) {
        createAuditLog({
          user_id: req.user?.userId || 'system',
          company_id: req.body?.company_id || req.params?.companyId,
          action: action as any,
          entity_type,
          entity_id: data?.id || req.params?.id || 'unknown',
          changes: action === 'update' ? {
            before: req.body?.original,
            after: data
          } : undefined,
          ip_address: req.ip,
          user_agent: req.headers['user-agent']
        }).catch(err => console.error('Audit log failed:', err));
      }
      
      return originalJson(data);
    };
    
    next();
  };
};
4. Audit Log Controller:
Filsökväg: backend/src/controllers/auditLogController.ts
typescriptimport { Request, Response } from 'express';
import * as auditLogService from '../services/auditLogService';

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      company_id,
      entity_type,
      entity_id,
      action,
      start_date,
      end_date,
      limit,
      skip
    } = req.query;
    
    const logs = await auditLogService.getAuditLogs({
      user_id: user_id as string,
      company_id: company_id as string,
      entity_type: entity_type as string,
      entity_id: entity_id as string,
      action: action as string,
      start_date: start_date ? new Date(start_date as string) : undefined,
      end_date: end_date ? new Date(end_date as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      skip: skip ? parseInt(skip as string) : undefined
    });
    
    res.json(logs);
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getEntityHistory = async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id } = req.params;
    const history = await auditLogService.getEntityHistory(entity_type, entity_id);
    res.json(history);
  } catch (error) {
    console.error('Get entity history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
5. Audit Log Routes:
Filsökväg: backend/src/routes/auditLogs.ts
typescriptimport express from 'express';
import * as auditLogController from '../controllers/auditLogController';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';

const router = express.Router();

router.use(authenticate);

// Get audit logs (admin only)
router.get('/', authorize(['admin']), auditLogController.getAuditLogs);

// Get entity history
router.get('/history/:entity_type/:entity_id', auditLogController.getEntityHistory);

export default router;
6. Uppdatera användarroutes med audit logging:
Filsökväg: backend/src/routes/users.ts (uppdatera)
typescriptimport express from 'express';
import * as userController from '../controllers/userController';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { auditLog } from '../middleware/auditLog';

const router = express.Router();

router.use(authenticate);

// Get current user
router.get('/me', userController.getCurrentUser);

// Update current user (with audit log)
router.put(
  '/me',
  auditLog('update', 'user'),
  userController.updateCurrentUser
);

// Change password (with audit log)
router.post(
  '/me/change-password',
  auditLog('update', 'user'),
  userController.changePassword
);

// Get user by ID (admin only)
router.get('/:id', authorize(['admin']), userController.getUserById);

// Get all users (admin only)
router.get('/', authorize(['admin']), userController.getAllUsers);

// Deactivate user (admin only, with audit log)
router.post(
  '/:id/deactivate',
  authorize(['admin']),
  auditLog('update', 'user'),
  userController.deactivateUser
);

export default router;
7. Frontend Audit Log Service:
Filsökväg: frontend/src/services/auditLogService.ts
typescriptimport axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export const getAuditLogs = async (filters?: {
  user_id?: string;
  company_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  skip?: number;
}) => {
  const response = await axios.get(`${API_URL}/audit-logs`, {
    headers: getAuthHeader(),
    params: filters
  });
  return response.data;
};

export const getEntityHistory = async (entity_type: string, entity_id: string) => {
  const response = await axios.get(
    `${API_URL}/audit-logs/history/${entity_type}/${entity_id}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};
8. Frontend Audit Log Page:
Filsökväg: frontend/src/pages/admin/AuditLogsPage.tsx
typescriptimport { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLogs } from '../../services/auditLogService';
import { format } from 'date-fns';

export default function AuditLogsPage() {
  const [filters, setFilters] = useState({
    entity_type: '',
    action: '',
    start_date: '',
    end_date: ''
  });
  
  const { data: logs, isLoading } = useQuery({
    queryKey: ['auditLogs', filters],
    queryFn: () => getAuditLogs(filters)
  });
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Audit Logs</h1>
      
      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Entity Type</label>
            <select
              value={filters.entity_type}
              onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg"
            >
              <option value="">All</option>
              <option value="user">User</option>
              <option value="company">Company</option>
              <option value="invoice">Invoice</option>
              <option value="customer">Customer</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Action</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg"
            >
              <option value="">All</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="view">View</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Start Date</label>
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">End Date</label>
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
        </div>
      </div>
      
      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Timestamp
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Action
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Entity
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                IP Address
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {logs?.map((log: any) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {log.user_id}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    log.action === 'create' ? 'bg-green-100 text-green-800' :
                    log.action === 'update' ? 'bg-blue-100 text-blue-800' :
                    log.action === 'delete' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {log.entity_type} ({log.entity_id.substring(0, 8)}...)
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {log.ip_address || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
9. Uppdatera App med Audit Log Routes:
Filsökväg: backend/src/app.ts (uppdatera)
typescriptimport express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import companyRoutes from './routes/companies';
import auditLogRoutes from './routes/auditLogs';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
Verifiering:
Efter implementation:
"Kör tester för audit log system"
"Verifiera att alla användaråtgärder loggas"

🏗️ FAS 2: MVP CORE FEATURES
Översikt

Tid: 12 veckor
Mål: Kärnfunktionalitet för redovisningssystem
Output: Fullständigt MVP med fakturering, bokföring, och rapporter


STEG 2.1: Customer CRM
Instruktion:
Implementera komplett CRM-system för kundhantering med kontakter, kommunikationshistorik, och aktivitetsloggning.
1. Customer Types:
Filsökväg: backend/src/types/customer.types.ts
typescriptexport interface Customer {
  id: string;
  company_id: string;
  name: string;
  org_number?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country: string;
  payment_terms: number;
  discount_percentage?: number;
  currency: string;
  vat_number?: string;
  notes?: string;
  tags?: string[];
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCustomerDto {
  name: string;
  org_number?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country?: string;
  payment_terms?: number;
  discount_percentage?: number;
  currency?: string;
  vat_number?: string;
  notes?: string;
  tags?: string[];
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {}

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary: boolean;
  created_at: Date;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  user_id: string;
  note: string;
  created_at: Date;
}
2. Customer Migration:
Filsökväg: database/migrations/002_customers.sql
sql-- Update customers table with more fields
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'SEK';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Customer contacts table
CREATE TABLE IF NOT EXISTS customer_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customer notes table
CREATE TABLE IF NOT EXISTS customer_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id);
CREATE INDEX idx_customers_tags ON customers USING GIN(tags);
3. Customer Service:
Filsökväg: backend/src/services/customerService.ts
typescriptimport { query } from '../config/database';
import { 
  Customer, 
  CreateCustomerDto, 
  UpdateCustomerDto,
  CustomerContact,
  CustomerNote 
} from '../types/customer.types';

export const createCustomer = async (
  companyId: string,
  userId: string,
  data: CreateCustomerDto
): Promise<Customer> => {
  const result = await query(
    `INSERT INTO customers (
      company_id, name, org_number, contact_person, email, phone, mobile,
      website, address_street, address_postal_code, address_city, address_country,
      payment_terms, discount_percentage, currency, vat_number, notes, tags, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING *`,
    [
      companyId,
      data.name,
      data.org_number || null,
      data.contact_person || null,
      data.email || null,
      data.phone || null,
      data.mobile || null,
      data.website || null,
      data.address_street || null,
      data.address_postal_code || null,
      data.address_city || null,
      data.address_country || 'Sweden',
      data.payment_terms || 30,
      data.discount_percentage || 0,
      data.currency || 'SEK',
      data.vat_number || null,
      data.notes || null,
      data.tags || null,
      userId
    ]
  );
  
  return result.rows[0];
};

export const getCustomers = async (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ customers: Customer[]; total: number }> => {
  let queryText = `
    SELECT * FROM customers
    WHERE company_id = $1
  `;
  
  const params: any[] = [companyId];
  let paramCount = 2;
  
  if (filters?.is_active !== undefined) {
    queryText += ` AND is_active = $${paramCount}`;
    params.push(filters.is_active);
    paramCount++;
  }
  
  if (filters?.search) {
    queryText += ` AND (
      name ILIKE $${paramCount} OR
      email ILIKE $${paramCount} OR
      org_number ILIKE $${paramCount}
    )`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }
  
  if (filters?.tags && filters.tags.length > 0) {
    queryText += ` AND tags && $${paramCount}`;
    params.push(filters.tags);
    paramCount++;
  }
  
  // Get total count
  const countResult = await query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);
  
  // Add ordering and pagination
  queryText += ` ORDER BY name ASC`;
  
  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }
  
  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
  }
  
  const result = await query(queryText, params);
  
  return {
    customers: result.rows,
    total
  };
};

export const getCustomerById = async (
  customerId: string,
  companyId: string
): Promise<Customer | null> => {
  const result = await query(
    'SELECT * FROM customers WHERE id = $1 AND company_id = $2',
    [customerId, companyId]
  );
  
  return result.rows[0] || null;
};

export const updateCustomer = async (
  customerId: string,
  companyId: string,
  updates: UpdateCustomerDto
): Promise<Customer> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;
  
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });
  
  if (fields.length === 0) {
    throw new Error('No fields to update');
  }
  
  values.push(customerId, companyId);
  
  const result = await query(
    `UPDATE customers 
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );
  
  if (result.rows.length === 0) {
    throw new Error('Customer not found');
  }
  
  return result.rows[0];
};

export const deleteCustomer = async (
  customerId: string,
  companyId: string
): Promise<void> => {
  await query(
    'UPDATE customers SET is_active = false WHERE id = $1 AND company_id = $2',
    [customerId, companyId]
  );
};

// Customer Contacts
export const addCustomerContact = async (data: {
  customer_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary?: boolean;
}): Promise<CustomerContact> => {
  const result = await query(
    `INSERT INTO customer_contacts (customer_id, name, title, email, phone, mobile, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.customer_id,
      data.name,
      data.title || null,
      data.email || null,
      data.phone || null,
      data.mobile || null,
      data.is_primary || false
    ]
  );
  
  return result.rows[0];
};

export const getCustomerContacts = async (customerId: string): Promise<CustomerContact[]> => {
  const result = await query(
    'SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_primary DESC, name ASC',
    [customerId]
  );
  
  return result.rows;
};

// Customer Notes
export const addCustomerNote = async (
  customerId: string,
  userId: string,
  note: string
): Promise<CustomerNote> => {
  const result = await query(
    `INSERT INTO customer_notes (customer_id, user_id, note)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [customerId, userId, note]
  );
  
  return result.rows[0];
};

export const getCustomerNotes = async (customerId: string): Promise<CustomerNote[]> => {
  const result = await query(
    `SELECT cn.*, u.name as user_name
     FROM customer_notes cn
     LEFT JOIN users u ON cn.user_id = u.id
     WHERE cn.customer_id = $1
     ORDER BY cn.created_at DESC`,
    [customerId]
  );
  
  return result.rows;
};
4. Customer Controller:
Filsökväg: backend/src/controllers/customerController.ts
typescriptimport { Request, Response } from 'express';
import * as customerService from '../services/customerService';
import { CreateCustomerDto, UpdateCustomerDto } from '../types/customer.types';

export const createCustomer = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;
    
    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const data: CreateCustomerDto = req.body;
    const customer = await customerService.createCustomer(company_id, userId, data);
    
    res.status(201).json(customer);
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomers = async (req: Request, res: Response) => {
  try {
    const { company_id, search, is_active, tags, limit, offset } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const result = await customerService.getCustomers(company_id as string, {
      search: search as string,
      is_active: is_active === 'true',
      tags: tags ? (tags as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });
    
    res.json(result);
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const customer = await customerService.getCustomerById(id, company_id as string);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json(customer);
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const customer = await customerService.updateCustomer(
      id,
      company_id,
      updates as UpdateCustomerDto
    );
    
    res.json(customer);
  } catch (error) {
    if (error.message === 'Customer not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    await customerService.deleteCustomer(id, company_id);
    res.json({ message: 'Customer deactivated successfully' });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addCustomerContact = async (req: Request, res: Response) => {
  try {
    const contact = await customerService.addCustomerContact(req.body);
    res.status(201).json(contact);
  } catch (error) {
    console.error('Add customer contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomerContacts = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const contacts = await customerService.getCustomerContacts(id);
    res.json(contacts);
  } catch (error) {
    console.error('Get customer contacts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addCustomerNote = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const customerNote = await customerService.addCustomerNote(id, userId, note);
    res.status(201).json(customerNote);
  } catch (error) {
    console.error('Add customer note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomerNotes = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notes = await customerService.getCustomerNotes(id);
    res.json(notes);
  } catch (error) {
    console.error('Get customer notes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
5. Customer Routes:
Filsökväg: backend/src/routes/customers.ts
typescriptimport express from 'express';
import * as customerController from '../controllers/customerController';
import { authenticate } from '../middleware/authenticate';
import { auditLog } from '../middleware/auditLog';

const router = express.Router();

router.use(authenticate);

// CRUD operations
router.post('/', auditLog('create', 'customer'), customerController.createCustomer);
router.get('/', customerController.getCustomers);
router.get('/:id', customerController.getCustomerById);
router.put('/:id', auditLog('update', 'customer'), customerController.updateCustomer);
router.delete('/:id', auditLog('delete', 'customer'), customerController.deleteCustomer);

// Contacts
router.post('/:id/contacts', customerController.addCustomerContact);
router.get('/:id/contacts', customerController.getCustomerContacts);

// Notes
router.post('/:id/notes', customerController.addCustomerNote);
router.get('/:id/notes', customerController.getCustomerNotes);

export default router;
[Frontend implementation fortsätter i nästa del...]

STEG 2.2: Supplier Management
Instruktion:
Implementera leverantörshantering (mycket lik Customer CRM men för leverantörer).
Implementation:
Suppliers använder samma struktur som Customers men med följande tillägg:

Category field (för kategorisering av leverantörer)
Payment reminder settings
Purchase history

Filer att skapa:

backend/src/types/supplier.types.ts - Samma struktur som customer.types.ts
backend/src/services/supplierService.ts - Samma CRUD operations som customerService
backend/src/controllers/supplierController.ts - Samma endpoints som customerController
backend/src/routes/suppliers.ts - Samma routes som customers
frontend/src/services/supplierService.ts - Frontend API calls
frontend/src/hooks/useSupplier.ts - React Query hooks
frontend/src/pages/suppliers/SupplierListPage.tsx - Lista leverantörer
frontend/src/pages/suppliers/SupplierFormPage.tsx - Skapa/redigera leverantör

Migration:
Filsökväg: database/migrations/003_suppliers_update.sql
sql-- Suppliers already exist from initial schema
-- Add additional fields
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mobile VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'SEK';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_suppliers_tags ON suppliers USING GIN(tags);
Snabb implementation med Claude Code:
"Implementera Supplier Management baserat på Customer CRM strukturen (Fas 2, Steg 2.2)"
Claude Code kommer skapa alla filer baserat på customer-mönstret.

STEG 2.3: Article Management
Instruktion:
Implementera produkter/tjänster-katalog för att användas i fakturor.
Types:
Filsökväg: backend/src/types/article.types.ts
typescriptexport interface Article {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  article_number?: string;
  price: number;
  unit: string;
  vat_rate: number;
  account_number?: number;
  category?: string;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateArticleDto {
  name: string;
  description?: string;
  article_number?: string;
  price: number;
  unit?: string;
  vat_rate: number;
  account_number?: number;
  category?: string;
}

export interface UpdateArticleDto extends Partial<CreateArticleDto> {}
Service:
Filsökväg: backend/src/services/articleService.ts
typescriptimport { query } from '../config/database';
import { Article, CreateArticleDto, UpdateArticleDto } from '../types/article.types';

export const createArticle = async (
  companyId: string,
  userId: string,
  data: CreateArticleDto
): Promise<Article> => {
  const result = await query(
    `INSERT INTO articles (
      company_id, name, description, article_number, price, unit,
      vat_rate, account_number, category, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      companyId,
      data.name,
      data.description || null,
      data.article_number || null,
      data.price,
      data.unit || 'st',
      data.vat_rate,
      data.account_number || null,
      data.category || null,
      userId
    ]
  );
  
  return result.rows[0];
};

export const getArticles = async (
  companyId: string,
  filters?: {
    search?: string;
    category?: string;
    is_active?: boolean;
  }
): Promise<Article[]> => {
  let queryText = 'SELECT * FROM articles WHERE company_id = $1';
  const params: any[] = [companyId];
  let paramCount = 2;
  
  if (filters?.is_active !== undefined) {
    queryText += ` AND is_active = $${paramCount}`;
    params.push(filters.is_active);
    paramCount++;
  }
  
  if (filters?.search) {
    queryText += ` AND (name ILIKE $${paramCount} OR article_number ILIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }
  
  if (filters?.category) {
    queryText += ` AND category = $${paramCount}`;
    params.push(filters.category);
    paramCount++;
  }
  
  queryText += ' ORDER BY name ASC';
  
  const result = await query(queryText, params);
  return result.rows;
};

export const getArticleById = async (
  articleId: string,
  companyId: string
): Promise<Article | null> => {
  const result = await query(
    'SELECT * FROM articles WHERE id = $1 AND company_id = $2',
    [articleId, companyId]
  );
  
  return result.rows[0] || null;
};

export const updateArticle = async (
  articleId: string,
  companyId: string,
  updates: UpdateArticleDto
): Promise<Article> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;
  
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });
  
  if (fields.length === 0) {
    throw new Error('No fields to update');
  }
  
  values.push(articleId, companyId);
  
  const result = await query(
    `UPDATE articles 
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

export const deleteArticle = async (
  articleId: string,
  companyId: string
): Promise<void> => {
  await query(
    'UPDATE articles SET is_active = false WHERE id = $1 AND company_id = $2',
    [articleId, companyId]
  );
};
Routes:
typescript// backend/src/routes/articles.ts
import express from 'express';
import * as articleController from '../controllers/articleController';
import { authenticate } from '../middleware/authenticate';
import { auditLog } from '../middleware/auditLog';

const router = express.Router();
router.use(authenticate);

router.post('/', auditLog('create', 'article'), articleController.createArticle);
router.get('/', articleController.getArticles);
router.get('/:id', articleController.getArticleById);
router.put('/:id', auditLog('update', 'article'), articleController.updateArticle);
router.delete('/:id', auditLog('delete', 'article'), articleController.deleteArticle);

export default router;
Implementation med Claude Code:
"Skapa komplett Article Management med controller, frontend pages och hooks (Fas 2, Steg 2.3)"

STEG 2.4: Invoice Module (KRITISK MODUL)
Instruktion:
Implementera komplett fakturasystem med rader, beräkningar, statushantering och OCR-nummer.
Types:
Filsökväg: backend/src/types/invoice.types.ts
typescriptexport interface Invoice {
  id: string;
  company_id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: Date;
  due_date: Date;
  payment_terms: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  currency: string;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  paid_date?: Date;
  sent_date?: Date;
  reference?: string;
  notes?: string;
  pdf_url?: string;
  ocr_number?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  article_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  vat_rate: number;
  amount: number;
  line_order: number;
}

export interface CreateInvoiceDto {
  customer_id: string;
  invoice_date: string;
  due_date?: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  lines: {
    article_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    vat_rate: number;
  }[];
}
Service med viktiga beräkningar:
Filsökväg: backend/src/services/invoiceService.ts
typescriptimport { query } from '../config/database';
import { Invoice, CreateInvoiceDto, InvoiceLine } from '../types/invoice.types';

// Generate unique invoice number
export const generateInvoiceNumber = async (companyId: string): Promise<string> => {
  const result = await query(
    `SELECT invoice_number FROM invoices 
     WHERE company_id = $1 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [companyId]
  );
  
  if (result.rows.length === 0) {
    return '2024-0001';
  }
  
  const lastNumber = result.rows[0].invoice_number;
  const [year, num] = lastNumber.split('-');
  const currentYear = new Date().getFullYear().toString();
  
  if (year === currentYear) {
    const nextNum = (parseInt(num) + 1).toString().padStart(4, '0');
    return `${currentYear}-${nextNum}`;
  } else {
    return `${currentYear}-0001`;
  }
};

// Generate OCR number (Swedish standard)
export const generateOCRNumber = (invoiceNumber: string): string => {
  const cleaned = invoiceNumber.replace(/[^0-9]/g, '');
  const checksum = calculateLuhnChecksum(cleaned);
  return cleaned + checksum;
};

function calculateLuhnChecksum(number: string): string {
  let sum = 0;
  let alternate = false;
  
  for (let i = number.length - 1; i >= 0; i--) {
    let n = parseInt(number[i]);
    
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    
    sum += n;
    alternate = !alternate;
  }
  
  return ((10 - (sum % 10)) % 10).toString();
}

// Calculate invoice totals
export const calculateInvoiceTotals = (lines: InvoiceLine[]): {
  subtotal: number;
  vat_amount: number;
  total_amount: number;
} => {
  let subtotal = 0;
  let vat_amount = 0;
  
  lines.forEach(line => {
    const lineSubtotal = line.quantity * line.unit_price;
    const lineVat = lineSubtotal * (line.vat_rate / 100);
    
    subtotal += lineSubtotal;
    vat_amount += lineVat;
  });
  
  const total_amount = subtotal + vat_amount;
  
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vat_amount: Math.round(vat_amount * 100) / 100,
    total_amount: Math.round(total_amount * 100) / 100
  };
};

export const createInvoice = async (
  companyId: string,
  userId: string,
  data: CreateInvoiceDto
): Promise<Invoice> => {
  const client = await query('BEGIN', []);
  
  try {
    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(companyId);
    const ocrNumber = generateOCRNumber(invoiceNumber);
    
    // Calculate due date if not provided
    const invoiceDate = new Date(data.invoice_date);
    const paymentTerms = data.payment_terms || 30;
    const dueDate = data.due_date 
      ? new Date(data.due_date)
      : new Date(invoiceDate.getTime() + paymentTerms * 24 * 60 * 60 * 1000);
    
    // Calculate line amounts
    const linesWithAmounts = data.lines.map((line, index) => ({
      ...line,
      amount: line.quantity * line.unit_price,
      line_order: index + 1,
      unit: line.unit || 'st'
    }));
    
    // Calculate totals
    const totals = calculateInvoiceTotals(linesWithAmounts as InvoiceLine[]);
    
    // Create invoice
    const invoiceResult = await query(
      `INSERT INTO invoices (
        company_id, customer_id, invoice_number, invoice_date, due_date,
        payment_terms, status, currency, subtotal, vat_amount, total_amount,
        paid_amount, reference, notes, ocr_number, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        companyId,
        data.customer_id,
        invoiceNumber,
        invoiceDate,
        dueDate,
        paymentTerms,
        'draft',
        'SEK',
        totals.subtotal,
        totals.vat_amount,
        totals.total_amount,
        0,
        data.reference || null,
        data.notes || null,
        ocrNumber,
        userId
      ]
    );
    
    const invoice = invoiceResult.rows[0];
    
    // Create invoice lines
    for (const line of linesWithAmounts) {
      await query(
        `INSERT INTO invoice_lines (
          invoice_id, article_id, description, quantity, unit_price,
          unit, vat_rate, amount, line_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          invoice.id,
          line.article_id || null,
          line.description,
          line.quantity,
          line.unit_price,
          line.unit,
          line.vat_rate,
          line.amount,
          line.line_order
        ]
      );
    }
    
    await query('COMMIT', []);
    
    // Fetch complete invoice with lines
    return await getInvoiceById(invoice.id, companyId);
  } catch (error) {
    await query('ROLLBACK', []);
    throw error;
  }
};

export const getInvoices = async (
  companyId: string,
  filters?: {
    customer_id?: string;
    status?: string;
    search?: string;
    start_date?: Date;
    end_date?: Date;
  }
): Promise<Invoice[]> => {
  let queryText = `
    SELECT i.*, c.name as customer_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.company_id = $1
  `;
  
  const params: any[] = [companyId];
  let paramCount = 2;
  
  if (filters?.customer_id) {
    queryText += ` AND i.customer_id = $${paramCount}`;
    params.push(filters.customer_id);
    paramCount++;
  }
  
  if (filters?.status) {
    queryText += ` AND i.status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }
  
  if (filters?.search) {
    queryText += ` AND (i.invoice_number ILIKE $${paramCount} OR c.name ILIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }
  
  if (filters?.start_date) {
    queryText += ` AND i.invoice_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }
  
  if (filters?.end_date) {
    queryText += ` AND i.invoice_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }
  
  queryText += ' ORDER BY i.invoice_date DESC, i.invoice_number DESC';
  
  const result = await query(queryText, params);
  return result.rows;
};

export const getInvoiceById = async (
  invoiceId: string,
  companyId: string
): Promise<Invoice> => {
  const invoiceResult = await query(
    `SELECT i.*, c.name as customer_name, c.email as customer_email
     FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE i.id = $1 AND i.company_id = $2`,
    [invoiceId, companyId]
  );
  
  if (invoiceResult.rows.length === 0) {
    throw new Error('Invoice not found');
  }
  
  const invoice = invoiceResult.rows[0];
  
  // Get invoice lines
  const linesResult = await query(
    'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_order',
    [invoiceId]
  );
  
  invoice.lines = linesResult.rows;
  
  return invoice;
};

export const markInvoiceAsSent = async (
  invoiceId: string,
  companyId: string
): Promise<Invoice> => {
  const result = await query(
    `UPDATE invoices 
     SET status = 'sent', sent_date = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2 AND status = 'draft'
     RETURNING *`,
    [invoiceId, companyId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Invoice not found or cannot be sent');
  }
  
  return result.rows[0];
};

export const markInvoiceAsPaid = async (
  invoiceId: string,
  companyId: string,
  paidAmount: number,
  paidDate: Date
): Promise<Invoice> => {
  const result = await query(
    `UPDATE invoices 
     SET status = 'paid', paid_amount = $3, paid_date = $4
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [invoiceId, companyId, paidAmount, paidDate]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Invoice not found');
  }
  
  return result.rows[0];
};
Implementation med Claude Code:
"Implementera komplett Invoice Module med beräkningar, OCR-nummer och statushantering (Fas 2, Steg 2.4)"

STEG 2.5-2.11: Övriga MVP Moduler
För att hålla dokumentationen hanterbar, här är översikt över återstående moduler:
STEG 2.5: PDF Generation

Använd pdfkit eller puppeteer
Genera professionella faktura-PDF:er
Inkludera företagslogga, OCR-nummer, betalningsinfo

STEG 2.6: Email Service

Använd nodemailer med SendGrid/AWS SES
Skicka fakturor via email
Email templates
Track sent emails

STEG 2.7: Receipt Management

Upload kvitton (images/PDF)
Store i S3/Google Cloud Storage
Metadata extraction
Link till leverantörer

STEG 2.8: AI OCR Integration

Claude Vision API för kvitto-scanning
Extrahera: datum, belopp, leverantör, VAT
Auto-kategorisering
Confidence scores

STEG 2.9: Accounting Module

BAS-kontoplanen
Bokför fakturor automatiskt
Bokför kvitton
Journal entries
Balance sheet

STEG 2.10: Dashboard

Overview widgets
Recent invoices
Unpaid invoices
Monthly revenue chart
Quick actions

STEG 2.11: Reports

Income statement (Resultaträkning)
Balance sheet (Balansräkning)
VAT report (Momsrapport)
Customer report
Export to Excel/PDF

För att implementera dessa:
"Implementera PDF Generation Service (Fas 2, Steg 2.5)"
"Implementera Email Service (Fas 2, Steg 2.6)"
"Implementera Receipt Management (Fas 2, Steg 2.7)"
"Implementera AI OCR med Claude Vision (Fas 2, Steg 2.8)"
"Implementera Accounting Module med BAS-kontoplanen (Fas 2, Steg 2.9)"
"Implementera Dashboard (Fas 2, Steg 2.10)"
"Implementera Reports (Fas 2, Steg 2.11)"

🏗️ FAS 3: ENHANCED FUNCTIONALITY
✅ TESTNING OCH KVALITETSSÄKRING
Test Strategy
3-nivå testpyramid:
        E2E Tests (10%)
       /              \
      /   Integration   \
     /     Tests (30%)    \
    /______________________\
   /      Unit Tests        \
  /        (60%)             \
 /__________________________\
Efter varje modul
Be Claude Code:
"Skapa och kör tester för [modul-namn]"
Claude Code kommer:

Skapa unit tests
Skapa integration tests
Köra testerna
Rapportera resultat
Om failures → föreslå fixes

Unit Tests
Exempel prompt:
"Skapa unit tests för userService.ts"
Claude Code skapar:
Filsökväg: backend/src/tests/unit/userService.test.ts
typescriptimport * as userService from '../../services/userService';
import { query } from '../../config/database';

jest.mock('../../config/database');

describe('User Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('getUserById', () => {
    it('should return user when found', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        name: 'Test User'
      };
      
      (query as jest.Mock).mockResolvedValue({
        rows: [mockUser]
      });
      
      const result = await userService.getUserById('123');
      
      expect(result).toEqual(mockUser);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['123']
      );
    });
    
    it('should return null when user not found', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      
      const result = await userService.getUserById('nonexistent');
      
      expect(result).toBeNull();
    });
  });
  
  describe('updateUser', () => {
    it('should update user fields', async () => {
      const updates = { name: 'New Name', phone: '+46701234567' };
      
      (query as jest.Mock).mockResolvedValue({
        rows: [{ id: '123', ...updates }]
      });
      
      const result = await userService.updateUser('123', updates);
      
      expect(result.name).toBe('New Name');
      expect(result.phone).toBe('+46701234567');
    });
    
    it('should throw error when no fields to update', async () => {
      await expect(
        userService.updateUser('123', {})
      ).rejects.toThrow('No fields to update');
    });
  });
});
Integration Tests
Exempel prompt:
"Skapa integration tests för user API endpoints"
Claude Code skapar:
Filsökväg: backend/src/tests/integration/users.test.ts
typescriptimport request from 'supertest';
import app from '../../app';
import { pool } from '../../config/database';

describe('User API Integration Tests', () => {
  let authToken: string;
  let userId: string;
  
  beforeAll(async () => {
    // Setup test data
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'test@example.com',
        password: 'TestPass123!',
        name: 'Test User'
      });
    
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'TestPass123!'
      });
    
    authToken = loginRes.body.token;
    userId = loginRes.body.user.id;
  });
  
  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM users WHERE email = $1', ['test@example.com']);
    await pool.end();
  });
  
  describe('GET /api/v1/users/me', () => {
    it('should return current user', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe('test@example.com');
    });
    
    it('should return 401 without token', async () => {
      await request(app)
        .get('/api/v1/users/me')
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
          phone: '+46701234567'
        })
        .expect(200);
      
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.phone).toBe('+46701234567');
    });
    
    it('should validate phone format', async () => {
      await request(app)
        .put('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          phone: 'invalid-phone'
        })
        .expect(400);
    });
  });
});
E2E Tests
Exempel prompt:
"Skapa E2E test för user registration och login flow"
Claude Code skapar:
Filsökväg: frontend/e2e/auth.spec.ts
typescriptimport { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('user can register and login', async ({ page }) => {
    const testEmail = `test${Date.now()}@example.com`;
    
    // Navigate to register page
    await page.goto('http://localhost:5173/register');
    
    // Fill registration form
    await page.fill('[name="email"]', testEmail);
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.fill('[name="confirmPassword"]', 'SecurePass123!');
    await page.fill('[name="name"]', 'Test User');
    
    // Submit form
    await page.click('button[type="submit"]');
    
    // Should redirect to dashboard
    await page.waitForURL('**/dashboard');
    expect(page.url()).toContain('/dashboard');
    
    // Logout
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Logout');
    
    // Login with same credentials
    await page.goto('http://localhost:5173/login');
    await page.fill('[name="email"]', testEmail);
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    
    // Should be back on dashboard
    await page.waitForURL('**/dashboard');
    expect(page.url()).toContain('/dashboard');
  });
  
  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('http://localhost:5173/login');
    
    await page.fill('[name="email"]', 'wrong@example.com');
    await page.fill('[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Should show error message
    await expect(page.locator('text=Invalid credentials')).toBeVisible();
  });
});
Kör tester
Alla tester:
"Kör alla tester"
Claude Code kör:
bashcd backend && npm test
cd frontend && npm test
Specifik modul:
"Kör tester för authentication"
Claude Code kör:
bashnpm test -- auth
Med coverage:
"Kör tester med coverage report"
Claude Code kör:
bashnpm test -- --coverage
Output exempel:
Test Suites: 5 passed, 5 total
Tests:       28 passed, 28 total
Coverage:    85.4%

🔍 LÖPANDE KVALITETSKONTROLLER
Daglig Health Check
Prompt:
"Kör daglig health check"
Claude Code granskar:

Services Status

API responding
Database connections
Redis connection
External services


Recent Errors

Errors last 24h
New error patterns
Frequency changes


Quick Metrics

Response times
Error rate
Active users



Output:
🔍 DAILY HEALTH CHECK - 2024-10-15

✅ SERVICES
✓ API: Responding (avg 45ms)
✓ PostgreSQL: Connected
✓ MongoDB: Connected
✓ Redis: Connected

⚠️ ERRORS (Last 24h)
- Total errors: 12 (down from 18)
- New error: "Database timeout in getInvoices" (3 occurrences)
- Action: Optimize query

📊 METRICS
- Avg response time: 120ms (target: <200ms)
- Error rate: 0.3% (target: <1%)
- Active users: 45

Veckovis Quality Check
Prompt:
"Kör veckovis kvalitetskontroll"
Claude Code analyserar:
1. Code Quality
typescript// Granskar:
- Functions >50 lines
- Cyclomatic complexity >10
- Code duplication
- Naming conventions
- Missing documentation
2. Security
typescript// Kontrollerar:
- npm audit vulnerabilities
- Exposed secrets
- Input validation
- SQL injection risks
- XSS vulnerabilities
3. Performance
typescript// Mäter:
- Slow queries (>100ms)
- Large bundle sizes
- Memory leaks
- N+1 query problems
4. Database Integrity
sql-- Verifierar:
- Orphaned records
- Accounting balance
- Foreign key constraints
- Data anomalies
Output:
📊 WEEKLY QUALITY CHECK - 2024-W42

🎯 OVERALL SCORE: 8.5/10

🚨 CRITICAL (0)
None

⚠️ HIGH PRIORITY (2)
1. Add rate limiting to /api/reports endpoint
   File: backend/src/routes/reports.ts
   Risk: DoS vulnerability
   Effort: 1h
   
2. Fix useEffect dependency warning
   File: frontend/src/pages/Dashboard.tsx:45
   Issue: Object recreated every render
   Effort: 30min

📋 MEDIUM PRIORITY (5)
3. Update lodash to v4.17.21 (security patch)
4. Optimize getCustomers query (currently 250ms)
5. Add error boundary to Invoice component
6. Document AI service functions
7. Remove unused imports in 8 files

✅ PASSED CHECKS (25)
- All tests passing
- No critical vulnerabilities
- API performance within targets
- Database integrity verified

📈 TRENDS
- Code coverage: 85% (↑3% from last week)
- Error rate: 0.3% (↓0.2% from last week)
- Performance: Stable

Pre-Release Checklist
Prompt:
"Kör pre-release checklist för version 1.0"
Claude Code verifierar:
markdown# PRE-RELEASE CHECKLIST v1.0

## TESTING ✅
- [x] All unit tests pass (100%)
- [x] All integration tests pass (100%)
- [x] All E2E tests pass (100%)
- [x] Manual testing complete
- [x] Edge cases tested
- [x] Performance tested

## SECURITY ✅
- [x] No critical/high vulnerabilities
- [x] Secrets in environment variables
- [x] Authentication working
- [x] Authorization working
- [x] HTTPS enforced
- [x] Security headers set
- [x] Rate limiting enabled

## DATABASE ✅
- [x] Migrations tested
- [x] Rollback tested
- [x] Backup strategy verified
- [x] Indexes created
- [x] Data integrity verified

## CODE QUALITY ✅
- [x] No console.logs in production
- [x] No TODOs for critical issues
- [x] Code reviewed
- [x] Documentation updated
- [x] CHANGELOG updated

## MONITORING ⚠️
- [x] Error tracking setup
- [ ] Performance monitoring (needs Datadog config)
- [x] Log aggregation
- [x] Alerts configured
- [x] Health check endpoint

## INFRASTRUCTURE ✅
- [x] Environment variables set
- [x] SSL certificates valid
- [x] Domain configured
- [x] CDN configured
- [x] Database backups automated

## BUSINESS LOGIC ✅
- [x] Invoice generation works
- [x] PDF generation works
- [x] Email sending works
- [x] Accounting calculations correct

## BLOCKERS (1)
1. Performance monitoring needs Datadog API key

## VERDICT
⚠️ NOT READY - 1 blocker must be resolved

After fixing blocker:
✅ READY FOR RELEASE

🚀 CONTINUOUS INTEGRATION
GitHub Actions Setup
Prompt:
"Skapa CI/CD pipeline med GitHub Actions"
Claude Code skapar:
Filsökväg: .github/workflows/ci.yml
yamlname: CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        working-directory: ./backend
        run: npm ci
      
      - name: Run tests
        working-directory: ./backend
        run: npm test -- --coverage
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_NAME: postgres
          DB_USER: postgres
          DB_PASSWORD: postgres
          REDIS_HOST: localhost
          REDIS_PORT: 6379
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage/lcov.info
  
  test-frontend:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        working-directory: ./frontend
        run: npm ci
      
      - name: Run tests
        working-directory: ./frontend
        run: npm test
      
      - name: Build
        working-directory: ./frontend
        run: npm run build
  
  lint:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Lint backend
        working-directory: ./backend
        run: |
          npm ci
          npm run lint
      
      - name: Lint frontend
        working-directory: ./frontend
        run: |
          npm ci
          npm run lint

📚 EXPANDERA DENNA FIL
VIKTIGT: Denna Claude.md fil är levande dokumentation!
När du behöver fler moduler
Be Claude Code:
"Lägg till komplett implementation för [modul-namn] i Claude.md"
Exempel:
"Lägg till Customer CRM implementation i Claude.md (Fas 2, Steg 1)"
"Lägg till Invoice Module implementation i Claude.md (Fas 2, Steg 4)"
"Lägg till AI OCR implementation i Claude.md (Fas 2, Steg 8)"
Claude Code kommer:

Läsa nuvarande struktur i Claude.md
Lägga till komplett implementation:

Types
Service
Controller
Routes
Frontend service
Frontend hooks
Frontend components
Tests


Formatera korrekt
Uppdatera innehållsförteckning

Mall för moduler
Varje modul ska innehålla:
markdown### STEG X.Y: [Modul Namn]

**Instruktion:**

Implementera [beskrivning]

**1. Types:**
Filsökväg: `backend/src/types/[modul].types.ts`
[Komplett kod]

**2. Service:**
Filsökväg: `backend/src/services/[modul]Service.ts`
[Komplett kod]

**3. Controller:**
Filsökväg: `backend/src/controllers/[modul]Controller.ts`
[Komplett kod]

**4. Routes:**
Filsökväg: `backend/src/routes/[modul]s.ts`
[Komplett kod]

**5. Frontend Service:**
Filsökväg: `frontend/src/services/[modul]Service.ts`
[Komplett kod]

**6. Frontend Hooks:**
Filsökväg: `frontend/src/hooks/use[Modul].ts`
[Komplett kod]

**7. Frontend Components:**
Filsökväg: `frontend/src/pages/[modul]s/[Component].tsx`
[Komplett kod]

**8. Tests:**
[Unit tests, Integration tests, E2E tests]

**Verifiering:**
[Kör-instruktioner]

📖 NÄSTA STEG
Du har nu:

✅ Grundläggande projektstruktur (Fas 0)
✅ User Management (Fas 1.1)
✅ Company Settings (Fas 1.2)
✅ Testnings-framework
✅ Kvalitetskontroller

För att fortsätta:

Implementera nästa modul:

"Implementera Audit Log System enligt Fas 1, Steg 3"

Eller expandera Claude.md:

"Lägg till Customer CRM implementation i Claude.md"

Eller hoppa direkt till specifik modul:

"Implementera Invoice Module"
Claude Code läser denna fil och vet vad som ska göras!

Claude.md kommer att växa under projektets gång. Uppdatera kontinuerligt!

Version 2.0 - Claude Code Edition
Senast uppdaterad: 2024-10-14