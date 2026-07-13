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
Status: ✅ FULLSTÄNDIG (Backend + Frontend)

Backend Implementation ✅ (Redan klar i Claude.md)
Innehåller:

Types (Customer, CreateCustomerDto, UpdateCustomerDto, CustomerContact, CustomerNote)
Migration (002_customers.sql)
Service (createCustomer, getCustomers, updateCustomer, contacts, notes)
Controller
Routes


Frontend Implementation ✅ (NYA TILLÄGG)
4. Frontend Service
Filsökväg: frontend/src/services/customerService.ts
typescriptimport axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export interface Customer {
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
  created_at: string;
  updated_at: string;
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

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary: boolean;
  created_at: string;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  user_id: string;
  user_name?: string;
  note: string;
  created_at: string;
}

export const getCustomers = async (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
) => {
  const params = new URLSearchParams();
  params.append('company_id', companyId);
  
  if (filters?.search) params.append('search', filters.search);
  if (filters?.is_active !== undefined) params.append('is_active', String(filters.is_active));
  if (filters?.tags?.length) params.append('tags', filters.tags.join(','));
  if (filters?.limit) params.append('limit', String(filters.limit));
  if (filters?.offset) params.append('offset', String(filters.offset));
  
  const response = await axios.get(`${API_URL}/customers?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCustomerById = async (id: string, companyId: string) => {
  const response = await axios.get(`${API_URL}/customers/${id}?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createCustomer = async (companyId: string, data: CreateCustomerDto) => {
  const response = await axios.post(
    `${API_URL}/customers`,
    { ...data, company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const updateCustomer = async (
  id: string,
  companyId: string,
  data: Partial<CreateCustomerDto>
) => {
  const response = await axios.put(
    `${API_URL}/customers/${id}`,
    { ...data, company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const deleteCustomer = async (id: string, companyId: string) => {
  const response = await axios.delete(`${API_URL}/customers/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
  return response.data;
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
}) => {
  const response = await axios.post(
    `${API_URL}/customers/${data.customer_id}/contacts`,
    data,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getCustomerContacts = async (customerId: string) => {
  const response = await axios.get(`${API_URL}/customers/${customerId}/contacts`, {
    headers: getAuthHeader()
  });
  return response.data;
};

// Customer Notes
export const addCustomerNote = async (customerId: string, note: string) => {
  const response = await axios.post(
    `${API_URL}/customers/${customerId}/notes`,
    { note },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getCustomerNotes = async (customerId: string) => {
  const response = await axios.get(`${API_URL}/customers/${customerId}/notes`, {
    headers: getAuthHeader()
  });
  return response.data;
};

5. Frontend Hooks
Filsökväg: frontend/src/hooks/useCustomer.ts
typescriptimport { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as customerService from '../services/customerService';
import type { CreateCustomerDto } from '../services/customerService';

export const useCustomers = (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    tags?: string[];
  }
) => {
  return useQuery({
    queryKey: ['customers', companyId, filters],
    queryFn: () => customerService.getCustomers(companyId, filters),
    enabled: !!companyId
  });
};

export const useCustomer = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => customerService.getCustomerById(id, companyId),
    enabled: !!id && !!companyId
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: CreateCustomerDto }) =>
      customerService.createCustomer(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      id,
      companyId,
      data
    }: {
      id: string;
      companyId: string;
      data: Partial<CreateCustomerDto>;
    }) => customerService.updateCustomer(id, companyId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', variables.id] });
    }
  });
};

export const useDeleteCustomer = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      customerService.deleteCustomer(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
  });
};

// Customer Contacts
export const useCustomerContacts = (customerId: string) => {
  return useQuery({
    queryKey: ['customerContacts', customerId],
    queryFn: () => customerService.getCustomerContacts(customerId),
    enabled: !!customerId
  });
};

export const useAddCustomerContact = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: customerService.addCustomerContact,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customerContacts', variables.customer_id] });
    }
  });
};

// Customer Notes
export const useCustomerNotes = (customerId: string) => {
  return useQuery({
    queryKey: ['customerNotes', customerId],
    queryFn: () => customerService.getCustomerNotes(customerId),
    enabled: !!customerId
  });
};

export const useAddCustomerNote = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ customerId, note }: { customerId: string; note: string }) =>
      customerService.addCustomerNote(customerId, note),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customerNotes', variables.customerId] });
    }
  });
};

6. Frontend Komponenter
6.1 CustomerListPage
Filsökväg: frontend/src/pages/customers/CustomerListPage.tsx
typescriptimport { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCustomers, useDeleteCustomer } from '../../hooks/useCustomer';
import { Plus, Search, Edit, Trash2, Eye } from 'lucide-react';

export default function CustomerListPage() {
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  
  const { data, isLoading, error } = useCustomers(companyId, {
    search,
    is_active: !showInactive ? true : undefined
  });
  
  const deleteCustomer = useDeleteCustomer();
  
  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Är du säker på att du vill ta bort kunden "${name}"?`)) {
      try {
        await deleteCustomer.mutateAsync({ id, companyId });
        alert('Kund borttagen');
      } catch (error) {
        alert('Kunde inte ta bort kund');
      }
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar kunder...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Kunde inte ladda kunder</div>
      </div>
    );
  }
  
  const customers = data?.customers || [];
  const total = data?.total || 0;
  
  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Kunder</h1>
          <p className="text-gray-600 mt-1">{total} kunder totalt</p>
        </div>
        <Link
          to="/customers/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} />
          Ny kund
        </Link>
      </div>
      
      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Sök kunder..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Visa inaktiva</span>
          </label>
        </div>
      </div>
      
      {/* Customers Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Namn
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kontakt
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Org.nr
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Betalningsvillkor
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Åtgärder
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  {search ? 'Inga kunder hittades' : 'Inga kunder än. Skapa din första kund!'}
                </td>
              </tr>
            ) : (
              customers.map((customer: any) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{customer.name}</div>
                    {customer.contact_person && (
                      <div className="text-sm text-gray-500">{customer.contact_person}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">{customer.email || '-'}</div>
                    <div className="text-sm text-gray-500">{customer.phone || '-'}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {customer.org_number || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {customer.payment_terms} dagar
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        customer.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {customer.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        to={`/customers/${customer.id}`}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Visa detaljer"
                      >
                        <Eye size={18} />
                      </Link>
                      <Link
                        to={`/customers/${customer.id}/edit`}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Redigera"
                      >
                        <Edit size={18} />
                      </Link>
                      <button
                        onClick={() => handleDelete(customer.id, customer.name)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Ta bort"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

6.2 CustomerFormPage
Filsökväg: frontend/src/pages/customers/CustomerFormPage.tsx
typescriptimport { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCustomer, useCreateCustomer, useUpdateCustomer } from '../../hooks/useCustomer';
import { ArrowLeft, Save } from 'lucide-react';

export default function CustomerFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const companyId = localStorage.getItem('currentCompanyId') || '';
  
  const { data: customer, isLoading } = useCustomer(id || '', companyId);
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  
  const [formData, setFormData] = useState({
    name: '',
    org_number: '',
    contact_person: '',
    email: '',
    phone: '',
    mobile: '',
    website: '',
    address_street: '',
    address_postal_code: '',
    address_city: '',
    address_country: 'Sweden',
    payment_terms: 30,
    discount_percentage: 0,
    currency: 'SEK',
    vat_number: '',
    notes: ''
  });
  
  useEffect(() => {
    if (customer && isEditing) {
      setFormData({
        name: customer.name || '',
        org_number: customer.org_number || '',
        contact_person: customer.contact_person || '',
        email: customer.email || '',
        phone: customer.phone || '',
        mobile: customer.mobile || '',
        website: customer.website || '',
        address_street: customer.address_street || '',
        address_postal_code: customer.address_postal_code || '',
        address_city: customer.address_city || '',
        address_country: customer.address_country || 'Sweden',
        payment_terms: customer.payment_terms || 30,
        discount_percentage: customer.discount_percentage || 0,
        currency: customer.currency || 'SEK',
        vat_number: customer.vat_number || '',
        notes: customer.notes || ''
      });
    }
  }, [customer, isEditing]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'payment_terms' || name === 'discount_percentage' 
        ? parseFloat(value) || 0 
        : value
    }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isEditing) {
        await updateCustomer.mutateAsync({
          id: id!,
          companyId,
          data: formData
        });
        alert('Kund uppdaterad');
      } else {
        await createCustomer.mutateAsync({
          companyId,
          data: formData
        });
        alert('Kund skapad');
      }
      navigate('/customers');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ett fel uppstod');
    }
  };
  
  if (isLoading && isEditing) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar kund...</div>
      </div>
    );
  }
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/customers')}
          className="p-2 hover:bg-gray-100 rounded"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-3xl font-bold">
          {isEditing ? 'Redigera kund' : 'Ny kund'}
        </h1>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Grundinformation</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Företagsnamn *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Organisationsnummer
              </label>
              <input
                type="text"
                name="org_number"
                value={formData.org_number}
                onChange={handleChange}
                placeholder="XXXXXX-XXXX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                VAT-nummer
              </label>
              <input
                type="text"
                name="vat_number"
                value={formData.vat_number}
                onChange={handleChange}
                placeholder="SE..."
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Kontaktperson
              </label>
              <input
                type="text"
                name="contact_person"
                value={formData.contact_person}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Webbplats
              </label>
              <input
                type="url"
                name="website"
                value={formData.website}
                onChange={handleChange}
                placeholder="https://..."
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        
        {/* Contact Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Kontaktinformation</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                E-post
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Telefon
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+46 XX XXX XX XX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mobil
              </label>
              <input
                type="tel"
                name="mobile"
                value={formData.mobile}
                onChange={handleChange}
                placeholder="+46 XX XXX XX XX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        
        {/* Address */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Adress</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gatuadress
              </label>
              <input
                type="text"
                name="address_street"
                value={formData.address_street}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Postnummer
              </label>
              <input
                type="text"
                name="address_postal_code"
                value={formData.address_postal_code}
                onChange={handleChange}
                placeholder="XXX XX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Stad
              </label>
              <input
                type="text"
                name="address_city"
                value={formData.address_city}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Land
              </label>
              <select
                name="address_country"
                value={formData.address_country}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Sweden">Sverige</option>
                <option value="Norway">Norge</option>
                <option value="Denmark">Danmark</option>
                <option value="Finland">Finland</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Payment & Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Betalning & Inställningar</h2>
          
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Betalningsvillkor (dagar)
              </label>
              <input
                type="number"
                name="payment_terms"
                value={formData.payment_terms}
                onChange={handleChange}
                min="0"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rabatt (%)
              </label>
              <input
                type="number"
                name="discount_percentage"
                value={formData.discount_percentage}
                onChange={handleChange}
                min="0"
                max="100"
                step="0.1"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valuta
              </label>
              <select
                name="currency"
                value={formData.currency}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="SEK">SEK</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="NOK">NOK</option>
                <option value="DKK">DKK</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Notes */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Anteckningar</h2>
          
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={4}
            placeholder="Interna anteckningar om kunden..."
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => navigate('/customers')}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={createCustomer.isPending || updateCustomer.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={20} />
            {createCustomer.isPending || updateCustomer.isPending ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </form>
    </div>
  );
}

6.3 CustomerDetailPage
Filsökväg: frontend/src/pages/customers/CustomerDetailPage.tsx
typescriptimport { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useCustomer,
  useCustomerContacts,
  useCustomerNotes,
  useAddCustomerContact,
  useAddCustomerNote
} from '../../hooks/useCustomer';
import { 
  ArrowLeft, 
  Edit, 
  Mail, 
  Phone, 
  MapPin, 
  Building, 
  FileText,
  Plus,
  User
} from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const companyId = localStorage.getItem('currentCompanyId') || '';
  
  const { data: customer, isLoading } = useCustomer(id || '', companyId);
  const { data: contacts } = useCustomerContacts(id || '');
  const { data: notes } = useCustomerNotes(id || '');
  
  const addContact = useAddCustomerContact();
  const addNote = useAddCustomerNote();
  
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    mobile: '',
    is_primary: false
  });
  
  const [newNote, setNewNote] = useState('');
  
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addContact.mutateAsync({
        customer_id: id!,
        ...newContact
      });
      setNewContact({ name: '', title: '', email: '', phone: '', mobile: '', is_primary: false });
      setShowAddContact(false);
      alert('Kontakt tillagd');
    } catch (error) {
      alert('Kunde inte lägga till kontakt');
    }
  };
  
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    
    try {
      await addNote.mutateAsync({
        customerId: id!,
        note: newNote
      });
      setNewNote('');
      alert('Anteckning tillagd');
    } catch (error) {
      alert('Kunde inte lägga till anteckning');
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar kund...</div>
      </div>
    );
  }
  
  if (!customer) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Kunde inte hitta kund</div>
      </div>
    );
  }
  
  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/customers')}
            className="p-2 hover:bg-gray-100 rounded"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-3xl font-bold">{customer.name}</h1>
            <p className="text-gray-600">{customer.org_number || 'Inget org.nr'}</p>
          </div>
        </div>
        <Link
          to={`/customers/${id}/edit`}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Edit size={20} />
          Redigera
        </Link>
      </div>
      
      <div className="grid grid-cols-3 gap-6">
        {/* Left Column - Main Info */}
        <div className="col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Grundinformation</h2>
            
            <div className="grid grid-cols-2 gap-4">
              {customer.contact_person && (
                <div className="flex items-start gap-3">
                  <User className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Kontaktperson</div>
                    <div className="font-medium">{customer.contact_person}</div>
                  </div>
                </div>
              )}
              
              {customer.email && (
                <div className="flex items-start gap-3">
                  <Mail className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">E-post</div>
                    <a href={`mailto:${customer.email}`} className="font-medium text-blue-600 hover:underline">
                      {customer.email}
                    </a>
                  </div>
                </div>
              )}
              
              {customer.phone && (
                <div className="flex items-start gap-3">
                  <Phone className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Telefon</div>
                    <a href={`tel:${customer.phone}`} className="font-medium text-blue-600 hover:underline">
                      {customer.phone}
                    </a>
                  </div>
                </div>
              )}
              
              {customer.mobile && (
                <div className="flex items-start gap-3">
                  <Phone className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Mobil</div>
                    <a href={`tel:${customer.mobile}`} className="font-medium text-blue-600 hover:underline">
                      {customer.mobile}
                    </a>
                  </div>
                </div>
              )}
              
              {(customer.address_street || customer.address_city) && (
                <div className="flex items-start gap-3">
                  <MapPin className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Adress</div>
                    <div className="font-medium">
                      {customer.address_street && <div>{customer.address_street}</div>}
                      {(customer.address_postal_code || customer.address_city) && (
                        <div>{customer.address_postal_code} {customer.address_city}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {customer.vat_number && (
                <div className="flex items-start gap-3">
                  <Building className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">VAT-nummer</div>
                    <div className="font-medium">{customer.vat_number}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Contacts */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Kontakter</h2>
              <button
                onClick={() => setShowAddContact(!showAddContact)}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Plus size={16} />
                Lägg till
              </button>
            </div>
            
            {showAddContact && (
              <form onSubmit={handleAddContact} className="mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Namn *"
                    value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    required
                    className="px-3 py-2 border rounded"
                  />
                  <input
                    type="text"
                    placeholder="Titel"
                    value={newContact.title}
                    onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                    className="px-3 py-2 border rounded"
                  />
                  <input
                    type="email"
                    placeholder="E-post"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className="px-3 py-2 border rounded"
                  />
                  <input
                    type="tel"
                    placeholder="Telefon"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="px-3 py-2 border rounded"
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="submit"
                    disabled={addContact.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addContact.isPending ? 'Sparar...' : 'Spara'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddContact(false)}
                    className="px-4 py-2 border rounded hover:bg-gray-50"
                  >
                    Avbryt
                  </button>
                </div>
              </form>
            )}
            
            {contacts && contacts.length > 0 ? (
              <div className="space-y-3">
                {contacts.map((contact: any) => (
                  <div key={contact.id} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{contact.name}</div>
                        {contact.title && <div className="text-sm text-gray-500">{contact.title}</div>}
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} className="text-sm text-blue-600 hover:underline">
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && (
                          <div className="text-sm text-gray-600">{contact.phone}</div>
                        )}
                      </div>
                      {contact.is_primary && (
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                          Primär
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Inga kontakter tillagda
              </div>
            )}
          </div>
          
          {/* Notes */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Anteckningar</h2>
            
            <form onSubmit={handleAddNote} className="mb-4">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Skriv en ny anteckning..."
                rows={3}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={addNote.isPending || !newNote.trim()}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {addNote.isPending ? 'Sparar...' : 'Lägg till anteckning'}
              </button>
            </form>
            
            {notes && notes.length > 0 ? (
              <div className="space-y-3">
                {notes.map((note: any) => (
                  <div key={note.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium text-sm">{note.user_name || 'Användare'}</div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(note.created_at), 'PPp', { locale: sv })}
                      </div>
                    </div>
                    <div className="text-gray-700">{note.note}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Inga anteckningar ännu
              </div>
            )}
          </div>
        </div>
        
        {/* Right Column - Stats & Settings */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Snabbinfo</h2>
            
            <div className="space-y-3">
              <div>
                <div className="text-sm text-gray-500">Betalningsvillkor</div>
                <div className="font-medium">{customer.payment_terms} dagar</div>
              </div>
              
              {customer.discount_percentage > 0 && (
                <div>
                  <div className="text-sm text-gray-500">Rabatt</div>
                  <div className="font-medium">{customer.discount_percentage}%</div>
                </div>
              )}
              
              <div>
                <div className="text-sm text-gray-500">Valuta</div>
                <div className="font-medium">{customer.currency}</div>
              </div>
              
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    customer.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {customer.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
              </div>
              
              <div>
                <div className="text-sm text-gray-500">Skapad</div>
                <div className="text-sm">
                  {format(new Date(customer.created_at), 'PPP', { locale: sv })}
                </div>
              </div>
            </div>
          </div>
          
          {/* Internal Notes */}
          {customer.notes && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="text-gray-400" size={20} />
                <h2 className="text-xl font-semibold">Interna anteckningar</h2>
              </div>
              <p className="text-gray-700 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
          
          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Åtgärder</h2>
            
            <div className="space-y-2">
              <Link
                to={`/invoices/new?customer=${id}`}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                <Plus size={18} />
                Skapa faktura
              </Link>
              
              <Link
                to={`/invoices?customer=${id}`}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 border rounded hover:bg-gray-50"
              >
                <FileText size={18} />
                Visa fakturor
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

7. Installation av Dependencies
Lägg till dessa i frontend/package.json om de inte redan finns:
bashcd frontend
npm install date-fns lucide-react

8. Router Setup
Uppdatera din router för att inkludera customer routes:
Filsökväg: frontend/src/App.tsx (eller där din router är)
typescriptimport { BrowserRouter, Routes, Route } from 'react-router-dom';
import CustomerListPage from './pages/customers/CustomerListPage';
import CustomerFormPage from './pages/customers/CustomerFormPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';

// ... andra imports

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ... andra routes */}
        
        {/* Customer Routes */}
        <Route path="/customers" element={<CustomerListPage />} />
        <Route path="/customers/new" element={<CustomerFormPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
        
        {/* ... andra routes */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;

✅ VERIFIERING
Starta applikationen:
bash# Backend
cd backend
npm run dev

# Frontend (ny terminal)
cd frontend
npm run dev
Testa funktionalitet:

Lista kunder: Gå till /customers
Skapa kund: Klicka "Ny kund" och fyll i formulär
Visa kund: Klicka på en kund i listan
Redigera kund: Klicka "Redigera" i detalj-vyn
Lägg till kontakt: I detalj-vyn, klicka "Lägg till" under Kontakter
Lägg till anteckning: Skriv en anteckning i textfältet

Kör tester:
bashcd backend
npm test -- customers

STEG 2.2: Supplier Management - KOMPLETT IMPLEMENTATION
Status: ✅ FULLSTÄNDIG (Backend + Frontend)

Översikt
Leverantörshantering följer samma struktur som Customer CRM men anpassad för leverantörer. Inkluderar kategorisering, kontakter, anteckningar och integration med kvitton/inköp.

1. Migration
Filsökväg: database/migrations/003_suppliers.sql
sql-- Suppliers table (update existing or create)
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    org_number VARCHAR(50),
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    website VARCHAR(255),
    address_street VARCHAR(255),
    address_postal_code VARCHAR(20),
    address_city VARCHAR(100),
    address_country VARCHAR(100) DEFAULT 'Sweden',
    payment_terms INTEGER DEFAULT 30,
    discount_percentage DECIMAL(5, 2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'SEK',
    vat_number VARCHAR(50),
    category VARCHAR(100),
    notes TEXT,
    tags TEXT[],
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier contacts table
CREATE TABLE IF NOT EXISTS supplier_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier notes table
CREATE TABLE IF NOT EXISTS supplier_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_org_number ON suppliers(org_number);
CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category);
CREATE INDEX IF NOT EXISTS idx_suppliers_tags ON suppliers USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_notes_supplier ON supplier_notes(supplier_id);

2. Backend Types
Filsökväg: backend/src/types/supplier.types.ts
typescriptexport interface Supplier {
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
  category?: string;
  notes?: string;
  tags?: string[];
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSupplierDto {
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
  category?: string;
  notes?: string;
  tags?: string[];
}

export interface UpdateSupplierDto extends Partial<CreateSupplierDto> {}

export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary: boolean;
  created_at: Date;
}

export interface SupplierNote {
  id: string;
  supplier_id: string;
  user_id: string;
  note: string;
  created_at: Date;
}

// Supplier categories
export enum SupplierCategory {
  MATERIALS = 'Råvaror',
  SERVICES = 'Tjänster',
  IT = 'IT & Teknik',
  OFFICE = 'Kontorsmaterial',
  CONSULTING = 'Konsulttjänster',
  MARKETING = 'Marknadsföring',
  TRANSPORT = 'Transport & Logistik',
  FACILITIES = 'Lokaler & Fastighet',
  OTHER = 'Övrigt'
}

3. Backend Service
Filsökväg: backend/src/services/supplierService.ts
typescriptimport { query } from '../config/database';
import { 
  Supplier, 
  CreateSupplierDto, 
  UpdateSupplierDto,
  SupplierContact,
  SupplierNote 
} from '../types/supplier.types';

export const createSupplier = async (
  companyId: string,
  userId: string,
  data: CreateSupplierDto
): Promise<Supplier> => {
  const result = await query(
    `INSERT INTO suppliers (
      company_id, name, org_number, contact_person, email, phone, mobile,
      website, address_street, address_postal_code, address_city, address_country,
      payment_terms, discount_percentage, currency, vat_number, category, notes, tags, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
      data.category || null,
      data.notes || null,
      data.tags || null,
      userId
    ]
  );
  
  return result.rows[0];
};

export const getSuppliers = async (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    category?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ suppliers: Supplier[]; total: number }> => {
  let queryText = `
    SELECT * FROM suppliers
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
  
  if (filters?.category) {
    queryText += ` AND category = $${paramCount}`;
    params.push(filters.category);
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
    suppliers: result.rows,
    total
  };
};

export const getSupplierById = async (
  supplierId: string,
  companyId: string
): Promise<Supplier | null> => {
  const result = await query(
    'SELECT * FROM suppliers WHERE id = $1 AND company_id = $2',
    [supplierId, companyId]
  );
  
  return result.rows[0] || null;
};

export const updateSupplier = async (
  supplierId: string,
  companyId: string,
  updates: UpdateSupplierDto
): Promise<Supplier> => {
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
  
  values.push(supplierId, companyId);
  
  const result = await query(
    `UPDATE suppliers 
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );
  
  if (result.rows.length === 0) {
    throw new Error('Supplier not found');
  }
  
  return result.rows[0];
};

export const deleteSupplier = async (
  supplierId: string,
  companyId: string
): Promise<void> => {
  await query(
    'UPDATE suppliers SET is_active = false WHERE id = $1 AND company_id = $2',
    [supplierId, companyId]
  );
};

// Supplier Contacts
export const addSupplierContact = async (data: {
  supplier_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary?: boolean;
}): Promise<SupplierContact> => {
  const result = await query(
    `INSERT INTO supplier_contacts (supplier_id, name, title, email, phone, mobile, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.supplier_id,
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

export const getSupplierContacts = async (supplierId: string): Promise<SupplierContact[]> => {
  const result = await query(
    'SELECT * FROM supplier_contacts WHERE supplier_id = $1 ORDER BY is_primary DESC, name ASC',
    [supplierId]
  );
  
  return result.rows;
};

// Supplier Notes
export const addSupplierNote = async (
  supplierId: string,
  userId: string,
  note: string
): Promise<SupplierNote> => {
  const result = await query(
    `INSERT INTO supplier_notes (supplier_id, user_id, note)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [supplierId, userId, note]
  );
  
  return result.rows[0];
};

export const getSupplierNotes = async (supplierId: string): Promise<SupplierNote[]> => {
  const result = await query(
    `SELECT sn.*, u.name as user_name
     FROM supplier_notes sn
     LEFT JOIN users u ON sn.user_id = u.id
     WHERE sn.supplier_id = $1
     ORDER BY sn.created_at DESC`,
    [supplierId]
  );
  
  return result.rows;
};

4. Backend Controller
Filsökväg: backend/src/controllers/supplierController.ts
typescriptimport { Request, Response } from 'express';
import * as supplierService from '../services/supplierService';
import { CreateSupplierDto, UpdateSupplierDto } from '../types/supplier.types';

export const createSupplier = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;
    
    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const data: CreateSupplierDto = req.body;
    const supplier = await supplierService.createSupplier(company_id, userId, data);
    
    res.status(201).json(supplier);
  } catch (error) {
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSuppliers = async (req: Request, res: Response) => {
  try {
    const { company_id, search, is_active, category, tags, limit, offset } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const result = await supplierService.getSuppliers(company_id as string, {
      search: search as string,
      is_active: is_active === 'true',
      category: category as string,
      tags: tags ? (tags as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });
    
    res.json(result);
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSupplierById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const supplier = await supplierService.getSupplierById(id, company_id as string);
    
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    
    res.json(supplier);
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateSupplier = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const supplier = await supplierService.updateSupplier(
      id,
      company_id,
      updates as UpdateSupplierDto
    );
    
    res.json(supplier);
  } catch (error) {
    if (error.message === 'Supplier not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteSupplier = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    await supplierService.deleteSupplier(id, company_id);
    res.json({ message: 'Supplier deactivated successfully' });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addSupplierContact = async (req: Request, res: Response) => {
  try {
    const contact = await supplierService.addSupplierContact(req.body);
    res.status(201).json(contact);
  } catch (error) {
    console.error('Add supplier contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSupplierContacts = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const contacts = await supplierService.getSupplierContacts(id);
    res.json(contacts);
  } catch (error) {
    console.error('Get supplier contacts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addSupplierNote = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const supplierNote = await supplierService.addSupplierNote(id, userId, note);
    res.status(201).json(supplierNote);
  } catch (error) {
    console.error('Add supplier note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSupplierNotes = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notes = await supplierService.getSupplierNotes(id);
    res.json(notes);
  } catch (error) {
    console.error('Get supplier notes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

5. Backend Routes
Filsökväg: backend/src/routes/suppliers.ts
typescriptimport express from 'express';
import * as supplierController from '../controllers/supplierController';
import { authenticate } from '../middleware/authenticate';
import { auditLog } from '../middleware/auditLog';

const router = express.Router();

router.use(authenticate);

// CRUD operations
router.post('/', auditLog('create', 'supplier'), supplierController.createSupplier);
router.get('/', supplierController.getSuppliers);
router.get('/:id', supplierController.getSupplierById);
router.put('/:id', auditLog('update', 'supplier'), supplierController.updateSupplier);
router.delete('/:id', auditLog('delete', 'supplier'), supplierController.deleteSupplier);

// Contacts
router.post('/:id/contacts', supplierController.addSupplierContact);
router.get('/:id/contacts', supplierController.getSupplierContacts);

// Notes
router.post('/:id/notes', supplierController.addSupplierNote);
router.get('/:id/notes', supplierController.getSupplierNotes);

export default router;

6. Uppdatera App.ts
Filsökväg: backend/src/app.ts (lägg till supplier routes)
typescriptimport express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import companyRoutes from './routes/companies';
import auditLogRoutes from './routes/auditLogs';
import customerRoutes from './routes/customers';
import supplierRoutes from './routes/suppliers'; // NY RAD

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/suppliers', supplierRoutes); // NY RAD

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;

7. Frontend Service
Filsökväg: frontend/src/services/supplierService.ts
typescriptimport axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export interface Supplier {
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
  category?: string;
  notes?: string;
  tags?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSupplierDto {
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
  category?: string;
  notes?: string;
  tags?: string[];
}

export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary: boolean;
  created_at: string;
}

export interface SupplierNote {
  id: string;
  supplier_id: string;
  user_id: string;
  user_name?: string;
  note: string;
  created_at: string;
}

export const SUPPLIER_CATEGORIES = [
  'Råvaror',
  'Tjänster',
  'IT & Teknik',
  'Kontorsmaterial',
  'Konsulttjänster',
  'Marknadsföring',
  'Transport & Logistik',
  'Lokaler & Fastighet',
  'Övrigt'
];

export const getSuppliers = async (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    category?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
) => {
  const params = new URLSearchParams();
  params.append('company_id', companyId);
  
  if (filters?.search) params.append('search', filters.search);
  if (filters?.is_active !== undefined) params.append('is_active', String(filters.is_active));
  if (filters?.category) params.append('category', filters.category);
  if (filters?.tags?.length) params.append('tags', filters.tags.join(','));
  if (filters?.limit) params.append('limit', String(filters.limit));
  if (filters?.offset) params.append('offset', String(filters.offset));
  
  const response = await axios.get(`${API_URL}/suppliers?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getSupplierById = async (id: string, companyId: string) => {
  const response = await axios.get(`${API_URL}/suppliers/${id}?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createSupplier = async (companyId: string, data: CreateSupplierDto) => {
  const response = await axios.post(
    `${API_URL}/suppliers`,
    { ...data, company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const updateSupplier = async (
  id: string,
  companyId: string,
  data: Partial<CreateSupplierDto>
) => {
  const response = await axios.put(
    `${API_URL}/suppliers/${id}`,
    { ...data, company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const deleteSupplier = async (id: string, companyId: string) => {
  const response = await axios.delete(`${API_URL}/suppliers/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
  return response.data;
};

// Supplier Contacts
export const addSupplierContact = async (data: {
  supplier_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary?: boolean;
}) => {
  const response = await axios.post(
    `${API_URL}/suppliers/${data.supplier_id}/contacts`,
    data,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getSupplierContacts = async (supplierId: string) => {
  const response = await axios.get(`${API_URL}/suppliers/${supplierId}/contacts`, {
    headers: getAuthHeader()
  });
  return response.data;
};

// Supplier Notes
export const addSupplierNote = async (supplierId: string, note: string) => {
  const response = await axios.post(
    `${API_URL}/suppliers/${supplierId}/notes`,
    { note },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getSupplierNotes = async (supplierId: string) => {
  const response = await axios.get(`${API_URL}/suppliers/${supplierId}/notes`, {
    headers: getAuthHeader()
  });
  return response.data;
};

8. Frontend Hooks
Filsökväg: frontend/src/hooks/useSupplier.ts
typescriptimport { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as supplierService from '../services/supplierService';
import type { CreateSupplierDto } from '../services/supplierService';

export const useSuppliers = (
  companyId: string,
  filters?: {
    search?: string;
    is_active?: boolean;
    category?: string;
    tags?: string[];
  }
) => {
  return useQuery({
    queryKey: ['suppliers', companyId, filters],
    queryFn: () => supplierService.getSuppliers(companyId, filters),
    enabled: !!companyId
  });
};

export const useSupplier = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getSupplierById(id, companyId),
    enabled: !!id && !!companyId
  });
};

export const useCreateSupplier = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: CreateSupplierDto }) =>
      supplierService.createSupplier(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    }
  });
};

export const useUpdateSupplier = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      id,
      companyId,
      data
    }: {
      id: string;
      companyId: string;
      data: Partial<CreateSupplierDto>;
    }) => supplierService.updateSupplier(id, companyId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier', variables.id] });
    }
  });
};

export const useDeleteSupplier = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      supplierService.deleteSupplier(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    }
  });
};

// Supplier Contacts
export const useSupplierContacts = (supplierId: string) => {
  return useQuery({
    queryKey: ['supplierContacts', supplierId],
    queryFn: () => supplierService.getSupplierContacts(supplierId),
    enabled: !!supplierId
  });
};

export const useAddSupplierContact = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: supplierService.addSupplierContact,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supplierContacts', variables.supplier_id] });
    }
  });
};

// Supplier Notes
export const useSupplierNotes = (supplierId: string) => {
  return useQuery({
    queryKey: ['supplierNotes', supplierId],
    queryFn: () => supplierService.getSupplierNotes(supplierId),
    enabled: !!supplierId
  });
};

export const useAddSupplierNote = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ supplierId, note }: { supplierId: string; note: string }) =>
      supplierService.addSupplierNote(supplierId, note),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supplierNotes', variables.supplierId] });
    }
  });
};

9. Frontend Komponenter
9.1 SupplierListPage
Filsökväg: frontend/src/pages/suppliers/SupplierListPage.tsx
typescriptimport { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSuppliers, useDeleteSupplier } from '../../hooks/useSupplier';
import { SUPPLIER_CATEGORIES } from '../../services/supplierService';
import { Plus, Search, Edit, Trash2, Eye, Filter } from 'lucide-react';

export default function SupplierListPage() {
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  
  const { data, isLoading, error } = useSuppliers(companyId, {
    search,
    category: category || undefined,
    is_active: !showInactive ? true : undefined
  });
  
  const deleteSupplier = useDeleteSupplier();
  
  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Är du säker på att du vill ta bort leverantören "${name}"?`)) {
      try {
        await deleteSupplier.mutateAsync({ id, companyId });
        alert('Leverantör borttagen');
      } catch (error) {
        alert('Kunde inte ta bort leverantör');
      }
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar leverantörer...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Kunde inte ladda leverantörer</div>
      </div>
    );
  }
  
  const suppliers = data?.suppliers || [];
  const total = data?.total || 0;
  
  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Leverantörer</h1>
          <p className="text-gray-600 mt-1">{total} leverantörer totalt</p>
        </div>
        <Link
          to="/suppliers/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} />
          Ny leverantör
        </Link>
      </div>
      
      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Sök leverantörer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter size={20} className="text-gray-400" />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Alla kategorier</option>
              {SUPPLIER_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Visa inaktiva</span>
          </label>
        </div>
      </div>
      
      {/* Suppliers Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Namn
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kontakt
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kategori
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Org.nr
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Åtgärder
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  {search ? 'Inga leverantörer hittades' : 'Inga leverantörer än. Skapa din första leverantör!'}
                </td>
              </tr>
            ) : (
              suppliers.map((supplier: any) => (
                <tr key={supplier.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{supplier.name}</div>
                    {supplier.contact_person && (
                      <div className="text-sm text-gray-500">{supplier.contact_person}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">{supplier.email || '-'}</div>
                    <div className="text-sm text-gray-500">{supplier.phone || '-'}</div>
                  </td>
                  <td className="px-6 py-4">
                    {supplier.category ? (
                      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                        {supplier.category}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {supplier.org_number || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        supplier.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {supplier.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        to={`/suppliers/${supplier.id}`}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Visa detaljer"
                      >
                        <Eye size={18} />
                      </Link>
                      <Link
                        to={`/suppliers/${supplier.id}/edit`}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Redigera"
                      >
                        <Edit size={18} />
                      </Link>
                      <button
                        onClick={() => handleDelete(supplier.id, supplier.name)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Ta bort"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

9.2 SupplierFormPage
Filsökväg: frontend/src/pages/suppliers/SupplierFormPage.tsx
typescriptimport { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSupplier, useCreateSupplier, useUpdateSupplier } from '../../hooks/useSupplier';
import { SUPPLIER_CATEGORIES } from '../../services/supplierService';
import { ArrowLeft, Save } from 'lucide-react';

export default function SupplierFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const companyId = localStorage.getItem('currentCompanyId') || '';
  
  const { data: supplier, isLoading } = useSupplier(id || '', companyId);
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  
  const [formData, setFormData] = useState({
    name: '',
    org_number: '',
    contact_person: '',
    email: '',
    phone: '',
    mobile: '',
    website: '',
    address_street: '',
    address_postal_code: '',
    address_city: '',
    address_country: 'Sweden',
    payment_terms: 30,
    discount_percentage: 0,
    currency: 'SEK',
    vat_number: '',
    category: '',
    notes: ''
  });
  
  useEffect(() => {
    if (supplier && isEditing) {
      setFormData({
        name: supplier.name || '',
        org_number: supplier.org_number || '',
        contact_person: supplier.contact_person || '',
        email: supplier.email || '',
        phone: supplier.phone || '',
        mobile: supplier.mobile || '',
        website: supplier.website || '',
        address_street: supplier.address_street || '',
        address_postal_code: supplier.address_postal_code || '',
        address_city: supplier.address_city || '',
        address_country: supplier.address_country || 'Sweden',
        payment_terms: supplier.payment_terms || 30,
        discount_percentage: supplier.discount_percentage || 0,
        currency: supplier.currency || 'SEK',
        vat_number: supplier.vat_number || '',
        category: supplier.category || '',
        notes: supplier.notes || ''
      });
    }
  }, [supplier, isEditing]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'payment_terms' || name === 'discount_percentage' 
        ? parseFloat(value) || 0 
        : value
    }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isEditing) {
        await updateSupplier.mutateAsync({
          id: id!,
          companyId,
          data: formData
        });
        alert('Leverantör uppdaterad');
      } else {
        await createSupplier.mutateAsync({
          companyId,
          data: formData
        });
        alert('Leverantör skapad');
      }
      navigate('/suppliers');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ett fel uppstod');
    }
  };
  
  if (isLoading && isEditing) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar leverantör...</div>
      </div>
    );
  }
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/suppliers')}
          className="p-2 hover:bg-gray-100 rounded"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-3xl font-bold">
          {isEditing ? 'Redigera leverantör' : 'Ny leverantör'}
        </h1>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Grundinformation</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Företagsnamn *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Organisationsnummer
              </label>
              <input
                type="text"
                name="org_number"
                value={formData.org_number}
                onChange={handleChange}
                placeholder="XXXXXX-XXXX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                VAT-nummer
              </label>
              <input
                type="text"
                name="vat_number"
                value={formData.vat_number}
                onChange={handleChange}
                placeholder="SE..."
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Kontaktperson
              </label>
              <input
                type="text"
                name="contact_person"
                value={formData.contact_person}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Kategori
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Välj kategori</option>
                {SUPPLIER_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Webbplats
              </label>
              <input
                type="url"
                name="website"
                value={formData.website}
                onChange={handleChange}
                placeholder="https://..."
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        
        {/* Contact Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Kontaktinformation</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                E-post
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Telefon
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+46 XX XXX XX XX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mobil
              </label>
              <input
                type="tel"
                name="mobile"
                value={formData.mobile}
                onChange={handleChange}
                placeholder="+46 XX XXX XX XX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        
        {/* Address */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Adress</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gatuadress
              </label>
              <input
                type="text"
                name="address_street"
                value={formData.address_street}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Postnummer
              </label>
              <input
                type="text"
                name="address_postal_code"
                value={formData.address_postal_code}
                onChange={handleChange}
                placeholder="XXX XX"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Stad
              </label>
              <input
                type="text"
                name="address_city"
                value={formData.address_city}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Land
              </label>
              <select
                name="address_country"
                value={formData.address_country}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Sweden">Sverige</option>
                <option value="Norway">Norge</option>
                <option value="Denmark">Danmark</option>
                <option value="Finland">Finland</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Payment & Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Betalning & Inställningar</h2>
          
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Betalningsvillkor (dagar)
              </label>
              <input
                type="number"
                name="payment_terms"
                value={formData.payment_terms}
                onChange={handleChange}
                min="0"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rabatt (%)
              </label>
              <input
                type="number"
                name="discount_percentage"
                value={formData.discount_percentage}
                onChange={handleChange}
                min="0"
                max="100"
                step="0.1"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valuta
              </label>
              <select
                name="currency"
                value={formData.currency}
                onChange={handleChange}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="SEK">SEK</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="NOK">NOK</option>
                <option value="DKK">DKK</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Notes */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Anteckningar</h2>
          
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={4}
            placeholder="Interna anteckningar om leverantören..."
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => navigate('/suppliers')}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={createSupplier.isPending || updateSupplier.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={20} />
            {createSupplier.isPending || updateSupplier.isPending ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </form>
    </div>
  );
}

9.3 SupplierDetailPage
Filsökväg: frontend/src/pages/suppliers/SupplierDetailPage.tsx
typescriptimport { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useSupplier,
  useSupplierContacts,
  useSupplierNotes,
  useAddSupplierContact,
  useAddSupplierNote
} from '../../hooks/useSupplier';
import { 
  ArrowLeft, 
  Edit, 
  Mail, 
  Phone, 
  MapPin, 
  Building, 
  FileText,
  Plus,
  User,
  Package
} from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

export default function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const companyId = localStorage.getItem('currentCompanyId') || '';
  
  const { data: supplier, isLoading } = useSupplier(id || '', companyId);
  const { data: contacts } = useSupplierContacts(id || '');
  const { data: notes } = useSupplierNotes(id || '');
  
  const addContact = useAddSupplierContact();
  const addNote = useAddSupplierNote();
  
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    mobile: '',
    is_primary: false
  });
  
  const [newNote, setNewNote] = useState('');
  
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addContact.mutateAsync({
        supplier_id: id!,
        ...newContact
      });
      setNewContact({ name: '', title: '', email: '', phone: '', mobile: '', is_primary: false });
      setShowAddContact(false);
      alert('Kontakt tillagd');
    } catch (error) {
      alert('Kunde inte lägga till kontakt');
    }
  };
  
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    
    try {
      await addNote.mutateAsync({
        supplierId: id!,
        note: newNote
      });
      setNewNote('');
      alert('Anteckning tillagd');
    } catch (error) {
      alert('Kunde inte lägga till anteckning');
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar leverantör...</div>
      </div>
    );
  }
  
  if (!supplier) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Kunde inte hitta leverantör</div>
      </div>
    );
  }
  
  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/suppliers')}
            className="p-2 hover:bg-gray-100 rounded"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-3xl font-bold">{supplier.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-gray-600">{supplier.org_number || 'Inget org.nr'}</p>
              {supplier.category && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                    {supplier.category}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <Link
          to={`/suppliers/${id}/edit`}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Edit size={20} />
          Redigera
        </Link>
      </div>
      
      <div className="grid grid-cols-3 gap-6">
        {/* Left Column - Main Info */}
        <div className="col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Grundinformation</h2>
            
            <div className="grid grid-cols-2 gap-4">
              {supplier.contact_person && (
                <div className="flex items-start gap-3">
                  <User className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Kontaktperson</div>
                    <div className="font-medium">{supplier.contact_person}</div>
                  </div>
                </div>
              )}
              
              {supplier.email && (
                <div className="flex items-start gap-3">
                  <Mail className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">E-post</div>
                    <a href={`mailto:${supplier.email}`} className="font-medium text-blue-600 hover:underline">
                      {supplier.email}
                    </a>
                  </div>
                </div>
              )}
              
              {supplier.phone && (
                <div className="flex items-start gap-3">
                  <Phone className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Telefon</div>
                    <a href={`tel:${supplier.phone}`} className="font-medium text-blue-600 hover:underline">
                      {supplier.phone}
                    </a>
                  </div>
                </div>
              )}
              
              {supplier.mobile && (
                <div className="flex items-start gap-3">
                  <Phone className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Mobil</div>
                    <a href={`tel:${supplier.mobile}`} className="font-medium text-blue-600 hover:underline">
                      {supplier.mobile}
                    </a>
                  </div>
                </div>
              )}
              
              {(supplier.address_street || supplier.address_city) && (
                <div className="flex items-start gap-3">
                  <MapPin className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">Adress</div>
                    <div className="font-medium">
                      {supplier.address_street && <div>{supplier.address_street}</div>}
                      {(supplier.address_postal_code || supplier.address_city) && (
                        <div>{supplier.address_postal_code} {supplier.address_city}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {supplier.vat_number && (
                <div className="flex items-start gap-3">
                  <Building className="text-gray-400 mt-1" size={20} />
                  <div>
                    <div className="text-sm text-gray-500">VAT-nummer</div>
                    <div className="font-medium">{supplier.vat_number}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Contacts */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Kontakter</h2>
              <button
                onClick={() => setShowAddContact(!showAddContact)}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Plus size={16} />
                Lägg till
              </button>
            </div>
            
            {showAddContact && (
              <form onSubmit={handleAddContact} className="mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Namn *"
                    value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    required
                    className="px-3 py-2 border rounded"
                  />
                  <input
                    type="text"
                    placeholder="Titel"
                    value={newContact.title}
                    onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                    className="px-3 py-2 border rounded"
                  />
                  <input
                    type="email"
                    placeholder="E-post"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className="px-3 py-2 border rounded"
                  />
                  <input
                    type="tel"
                    placeholder="Telefon"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="px-3 py-2 border rounded"
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="submit"
                    disabled={addContact.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addContact.isPending ? 'Sparar...' : 'Spara'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddContact(false)}
                    className="px-4 py-2 border rounded hover:bg-gray-50"
                  >
                    Avbryt
                  </button>
                </div>
              </form>
            )}
            
            {contacts && contacts.length > 0 ? (
              <div className="space-y-3">
                {contacts.map((contact: any) => (
                  <div key={contact.id} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{contact.name}</div>
                        {contact.title && <div className="text-sm text-gray-500">{contact.title}</div>}
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} className="text-sm text-blue-600 hover:underline">
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && (
                          <div className="text-sm text-gray-600">{contact.phone}</div>
                        )}
                      </div>
                      {contact.is_primary && (
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                          Primär
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Inga kontakter tillagda
              </div>
            )}
          </div>
          
          {/* Notes */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Anteckningar</h2>
            
            <form onSubmit={handleAddNote} className="mb-4">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Skriv en ny anteckning..."
                rows={3}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={addNote.isPending || !newNote.trim()}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {addNote.isPending ? 'Sparar...' : 'Lägg till anteckning'}
              </button>
            </form>
            
            {notes && notes.length > 0 ? (
              <div className="space-y-3">
                {notes.map((note: any) => (
                  <div key={note.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium text-sm">{note.user_name || 'Användare'}</div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(note.created_at), 'PPp', { locale: sv })}
                      </div>
                    </div>
                    <div className="text-gray-700">{note.note}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Inga anteckningar ännu
              </div>
            )}
          </div>
        </div>
        
        {/* Right Column - Stats & Settings */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Snabbinfo</h2>
            
            <div className="space-y-3">
              <div>
                <div className="text-sm text-gray-500">Betalningsvillkor</div>
                <div className="font-medium">{supplier.payment_terms} dagar</div>
              </div>
              
              {supplier.discount_percentage > 0 && (
                <div>
                  <div className="text-sm text-gray-500">Rabatt</div>
                  <div className="font-medium">{supplier.discount_percentage}%</div>
                </div>
              )}
              
              <div>
                <div className="text-sm text-gray-500">Valuta</div>
                <div className="font-medium">{supplier.currency}</div>
              </div>
              
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    supplier.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {supplier.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
              </div>
              
              <div>
                <div className="text-sm text-gray-500">Skapad</div>
                <div className="text-sm">
                  {format(new Date(supplier.created_at), 'PPP', { locale: sv })}
                </div>
              </div>
            </div>
          </div>
          
          {/* Internal Notes */}
          {supplier.notes && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="text-gray-400" size={20} />
                <h2 className="text-xl font-semibold">Interna anteckningar</h2>
              </div>
              <p className="text-gray-700 whitespace-pre-wrap">{supplier.notes}</p>
            </div>
          )}
          
          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Åtgärder</h2>
            
            <div className="space-y-2">
              <Link
                to={`/receipts?supplier=${id}`}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 border rounded hover:bg-gray-50"
              >
                <Package size={18} />
                Visa kvitton
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

10. Router Setup
Filsökväg: frontend/src/App.tsx (lägg till supplier routes)
typescriptimport { BrowserRouter, Routes, Route } from 'react-router-dom';
import SupplierListPage from './pages/suppliers/SupplierListPage';
import SupplierFormPage from './pages/suppliers/SupplierFormPage';
import SupplierDetailPage from './pages/suppliers/SupplierDetailPage';

// ... andra imports

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ... andra routes */}
        
        {/* Supplier Routes */}
        <Route path="/suppliers" element={<SupplierListPage />} />
        <Route path="/suppliers/new" element={<SupplierFormPage />} />
        <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="/suppliers/:id/edit" element={<SupplierFormPage />} />
        
        {/* ... andra routes */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;

11. Tests
Unit Tests
Filsökväg: backend/src/tests/unit/supplierService.test.ts
typescriptimport * as supplierService from '../../services/supplierService';
import { query } from '../../config/database';

jest.mock('../../config/database');

describe('Supplier Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('getSupplierById', () => {
    it('should return supplier when found', async () => {
      const mockSupplier = {
        id: '123',
        name: 'Test Supplier',
        company_id: 'abc'
      };
      
      (query as jest.Mock).mockResolvedValue({
        rows: [mockSupplier]
      });
      
      const result = await supplierService.getSupplierById('123', 'abc');
      
      expect(result).toEqual(mockSupplier);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['123', 'abc']
      );
    });
    
    it('should return null when supplier not found', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      
      const result = await supplierService.getSupplierById('nonexistent', 'abc');
      
      expect(result).toBeNull();
    });
  });
});
Integration Tests
Filsökväg: backend/src/tests/integration/suppliers.test.ts
typescriptimport request from 'supertest';
import app from '../../app';
import { pool } from '../../config/database';

describe('Supplier API Integration Tests', () => {
  let authToken: string;
  let companyId: string;
  let supplierId: string;
  
  beforeAll(async () => {
    // Setup test data
    // ... (samma som customer tests)
  });
  
  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM suppliers WHERE company_id = $1', [companyId]);
    await pool.end();
  });
  
  describe('POST /api/v1/suppliers', () => {
    it('should create supplier', async () => {
      const res = await request(app)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          company_id: companyId,
          name: 'Test Supplier',
          email: 'supplier@example.com',
          category: 'IT & Teknik'
        })
        .expect(201);
      
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Supplier');
      expect(res.body.category).toBe('IT & Teknik');
      
      supplierId = res.body.id;
    });
  });
  
  describe('GET /api/v1/suppliers', () => {
    it('should return suppliers list', async () => {
      const res = await request(app)
        .get(`/api/v1/suppliers?company_id=${companyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).toHaveProperty('suppliers');
      expect(res.body).toHaveProperty('total');
      expect(res.body.suppliers.length).toBeGreaterThan(0);
    });
  });
});

✅ VERIFIERING
Starta applikationen:
bash# Backend
cd backend
npm run dev

# Frontend (ny terminal)
cd frontend
npm run dev
Testa funktionalitet:

Lista leverantörer: Gå till /suppliers
Skapa leverantör: Klicka "Ny leverantör" och fyll i formulär
Filter per kategori: Använd kategori-dropdown
Visa leverantör: Klicka på en leverantör i listan
Redigera leverantör: Klicka "Redigera" i detalj-vyn
Lägg till kontakt: I detalj-vyn, klicka "Lägg till" under Kontakter
Lägg till anteckning: Skriv en anteckning i textfältet

Kör tester:
bashcd backend
npm test -- suppliers

📋 SAMMANFATTNING
✅ NYA FILER SKAPADE:
Backend (6 filer):

database/migrations/003_suppliers.sql - Migration (72 rader)
backend/src/types/supplier.types.ts - Types (64 rader)
backend/src/services/supplierService.ts - Service (294 rader)
backend/src/controllers/supplierController.ts - Controller (183 rader)
backend/src/routes/suppliers.ts - Routes (28 rader)
backend/src/app.ts - Update (2 rader)

Frontend (5 filer):
7. frontend/src/services/supplierService.ts - API calls (300 rader)
8. frontend/src/hooks/useSupplier.ts - React Query hooks (109 rader)
9. frontend/src/pages/suppliers/SupplierListPage.tsx - Lista (216 rader)
10. frontend/src/pages/suppliers/SupplierFormPage.tsx - Formulär (338 rader)
11. frontend/src/pages/suppliers/SupplierDetailPage.tsx - Detaljer (468 rader)
Tests (2 filer):
12. backend/src/tests/unit/supplierService.test.ts - Unit (34 rader)
13. backend/src/tests/integration/suppliers.test.ts - Integration (50 rader)

STEG 2.3: Article Management ✅ KOMPLETT
Instruktion:
Implementera produkter och tjänster som används i fakturor. Stöder SKU, priser, enheter, kategorier och marginalberäkning.

1. Database Migration
Filsökväg: database/migrations/004_articles.sql
sql-- Migration: Create articles table
-- Description: Stores products and services for invoicing
-- Author: AI Assistant
-- Date: 2025-10-20

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create article_type enum
CREATE TYPE article_type AS ENUM ('product', 'service', 'package');

-- Create unit enum
CREATE TYPE unit_type AS ENUM (
    'piece',      -- st (styck)
    'hour',       -- timme
    'day',        -- dag
    'month',      -- månad
    'kg',         -- kilogram
    'liter',      -- liter
    'meter',      -- meter
    'square_meter', -- kvadratmeter
    'cubic_meter'   -- kubikmeter
);

-- Create articles table
CREATE TABLE articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- Basic info
    article_number VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    article_type article_type NOT NULL DEFAULT 'product',
    
    -- SKU and inventory
    sku VARCHAR(100),
    barcode VARCHAR(100),
    
    -- Pricing
    unit unit_type NOT NULL DEFAULT 'piece',
    price DECIMAL(10, 2) NOT NULL,
    cost DECIMAL(10, 2),
    vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 25.00,
    
    -- Categorization
    category VARCHAR(100),
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(company_id, article_number),
    CONSTRAINT positive_price CHECK (price >= 0),
    CONSTRAINT positive_cost CHECK (cost IS NULL OR cost >= 0),
    CONSTRAINT valid_vat_rate CHECK (vat_rate >= 0 AND vat_rate <= 100)
);

-- Create indexes
CREATE INDEX idx_articles_company_id ON articles(company_id);
CREATE INDEX idx_articles_article_number ON articles(article_number);
CREATE INDEX idx_articles_sku ON articles(sku) WHERE sku IS NOT NULL;
CREATE INDEX idx_articles_category ON articles(category) WHERE category IS NOT NULL;
CREATE INDEX idx_articles_is_active ON articles(is_active);
CREATE INDEX idx_articles_created_at ON articles(created_at);

-- Create updated_at trigger
CREATE TRIGGER update_articles_updated_at
    BEFORE UPDATE ON articles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE articles IS 'Products and services used in invoicing';
COMMENT ON COLUMN articles.article_number IS 'Company-specific article number';
COMMENT ON COLUMN articles.sku IS 'Stock Keeping Unit identifier';
COMMENT ON COLUMN articles.price IS 'Sales price excluding VAT';
COMMENT ON COLUMN articles.cost IS 'Purchase/production cost';
COMMENT ON COLUMN articles.vat_rate IS 'VAT rate percentage (e.g., 25.00 for 25%)';

2. Backend Types
Filsökväg: backend/src/types/article.types.ts
typescriptexport type ArticleType = 'product' | 'service' | 'package';

export type UnitType = 
    | 'piece'          // st (styck)
    | 'hour'           // timme
    | 'day'            // dag
    | 'month'          // månad
    | 'kg'             // kilogram
    | 'liter'          // liter
    | 'meter'          // meter
    | 'square_meter'   // kvadratmeter
    | 'cubic_meter';   // kubikmeter

export interface Article {
    id: string;
    companyId: string;
    articleNumber: string;
    name: string;
    description: string | null;
    articleType: ArticleType;
    sku: string | null;
    barcode: string | null;
    unit: UnitType;
    price: number;
    cost: number | null;
    vatRate: number;
    category: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateArticleDto {
    articleNumber: string;
    name: string;
    description?: string;
    articleType?: ArticleType;
    sku?: string;
    barcode?: string;
    unit?: UnitType;
    price: number;
    cost?: number;
    vatRate?: number;
    category?: string;
    isActive?: boolean;
}

export interface UpdateArticleDto {
    name?: string;
    description?: string;
    articleType?: ArticleType;
    sku?: string;
    barcode?: string;
    unit?: UnitType;
    price?: number;
    cost?: number;
    vatRate?: number;
    category?: string;
    isActive?: boolean;
}

3. Backend Service
Filsökväg: backend/src/services/articleService.ts
typescriptimport pool from '../config/database';
import { Article, CreateArticleDto, UpdateArticleDto } from '../types/article.types';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler';

// Helper function to convert snake_case to camelCase
function toCamelCase(obj: any): Article {
    return {
        id: obj.id,
        companyId: obj.company_id,
        articleNumber: obj.article_number,
        name: obj.name,
        description: obj.description,
        articleType: obj.article_type,
        sku: obj.sku,
        barcode: obj.barcode,
        unit: obj.unit,
        price: parseFloat(obj.price),
        cost: obj.cost ? parseFloat(obj.cost) : null,
        vatRate: parseFloat(obj.vat_rate),
        category: obj.category,
        isActive: obj.is_active,
        createdAt: obj.created_at,
        updatedAt: obj.updated_at
    };
}

export const articleService = {
    /**
     * Create a new article
     */
    async createArticle(companyId: string, data: CreateArticleDto): Promise<Article> {
        // Check if article number already exists for this company
        const existingCheck = await pool.query(
            'SELECT id FROM articles WHERE company_id = $1 AND article_number = $2',
            [companyId, data.articleNumber]
        );

        if (existingCheck.rows.length > 0) {
            throw new BadRequestError('Article number already exists for this company');
        }

        const result = await pool.query(
            `INSERT INTO articles (
                company_id, article_number, name, description, article_type,
                sku, barcode, unit, price, cost, vat_rate, category, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *`,
            [
                companyId,
                data.articleNumber,
                data.name,
                data.description || null,
                data.articleType || 'product',
                data.sku || null,
                data.barcode || null,
                data.unit || 'piece',
                data.price,
                data.cost || null,
                data.vatRate || 25.00,
                data.category || null,
                data.isActive !== undefined ? data.isActive : true
            ]
        );

        return toCamelCase(result.rows[0]);
    },

    /**
     * Get all articles for a company
     */
    async getArticles(
        companyId: string,
        filters?: {
            search?: string;
            category?: string;
            articleType?: string;
            isActive?: boolean;
        }
    ): Promise<Article[]> {
        let query = 'SELECT * FROM articles WHERE company_id = $1';
        const params: any[] = [companyId];
        let paramCount = 1;

        if (filters?.search) {
            paramCount++;
            query += ` AND (
                name ILIKE $${paramCount} OR 
                article_number ILIKE $${paramCount} OR 
                sku ILIKE $${paramCount} OR
                description ILIKE $${paramCount}
            )`;
            params.push(`%${filters.search}%`);
        }

        if (filters?.category) {
            paramCount++;
            query += ` AND category = $${paramCount}`;
            params.push(filters.category);
        }

        if (filters?.articleType) {
            paramCount++;
            query += ` AND article_type = $${paramCount}`;
            params.push(filters.articleType);
        }

        if (filters?.isActive !== undefined) {
            paramCount++;
            query += ` AND is_active = $${paramCount}`;
            params.push(filters.isActive);
        }

        query += ' ORDER BY article_number ASC';

        const result = await pool.query(query, params);
        return result.rows.map(toCamelCase);
    },

    /**
     * Get article by ID
     */
    async getArticleById(companyId: string, articleId: string): Promise<Article> {
        const result = await pool.query(
            'SELECT * FROM articles WHERE id = $1 AND company_id = $2',
            [articleId, companyId]
        );

        if (result.rows.length === 0) {
            throw new NotFoundError('Article not found');
        }

        return toCamelCase(result.rows[0]);
    },

    /**
     * Update article
     */
    async updateArticle(
        companyId: string,
        articleId: string,
        data: UpdateArticleDto
    ): Promise<Article> {
        // Check if article exists
        await this.getArticleById(companyId, articleId);

        const fields: string[] = [];
        const values: any[] = [];
        let paramCount = 0;

        if (data.name !== undefined) {
            paramCount++;
            fields.push(`name = $${paramCount}`);
            values.push(data.name);
        }
        if (data.description !== undefined) {
            paramCount++;
            fields.push(`description = $${paramCount}`);
            values.push(data.description);
        }
        if (data.articleType !== undefined) {
            paramCount++;
            fields.push(`article_type = $${paramCount}`);
            values.push(data.articleType);
        }
        if (data.sku !== undefined) {
            paramCount++;
            fields.push(`sku = $${paramCount}`);
            values.push(data.sku);
        }
        if (data.barcode !== undefined) {
            paramCount++;
            fields.push(`barcode = $${paramCount}`);
            values.push(data.barcode);
        }
        if (data.unit !== undefined) {
            paramCount++;
            fields.push(`unit = $${paramCount}`);
            values.push(data.unit);
        }
        if (data.price !== undefined) {
            paramCount++;
            fields.push(`price = $${paramCount}`);
            values.push(data.price);
        }
        if (data.cost !== undefined) {
            paramCount++;
            fields.push(`cost = $${paramCount}`);
            values.push(data.cost);
        }
        if (data.vatRate !== undefined) {
            paramCount++;
            fields.push(`vat_rate = $${paramCount}`);
            values.push(data.vatRate);
        }
        if (data.category !== undefined) {
            paramCount++;
            fields.push(`category = $${paramCount}`);
            values.push(data.category);
        }
        if (data.isActive !== undefined) {
            paramCount++;
            fields.push(`is_active = $${paramCount}`);
            values.push(data.isActive);
        }

        if (fields.length === 0) {
            throw new BadRequestError('No fields to update');
        }

        values.push(articleId, companyId);
        const result = await pool.query(
            `UPDATE articles SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramCount + 1} AND company_id = $${paramCount + 2}
            RETURNING *`,
            values
        );

        return toCamelCase(result.rows[0]);
    },

    /**
     * Delete article
     */
    async deleteArticle(companyId: string, articleId: string): Promise<void> {
        const result = await pool.query(
            'DELETE FROM articles WHERE id = $1 AND company_id = $2 RETURNING id',
            [articleId, companyId]
        );

        if (result.rows.length === 0) {
            throw new NotFoundError('Article not found');
        }
    },

    /**
     * Get unique categories for a company
     */
    async getCategories(companyId: string): Promise<string[]> {
        const result = await pool.query(
            `SELECT DISTINCT category 
            FROM articles 
            WHERE company_id = $1 AND category IS NOT NULL
            ORDER BY category`,
            [companyId]
        );

        return result.rows.map(row => row.category);
    }
};

4. Backend Controller
Filsökväg: backend/src/controllers/articleController.ts
typescriptimport { Request, Response, NextFunction } from 'express';
import { articleService } from '../services/articleService';
import { CreateArticleDto, UpdateArticleDto } from '../types/article.types';

export const articleController = {
    /**
     * Create a new article
     * POST /api/articles
     */
    async createArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const data: CreateArticleDto = req.body;

            // Validation
            if (!data.articleNumber || !data.name || data.price === undefined) {
                res.status(400).json({ 
                    error: 'Article number, name, and price are required' 
                });
                return;
            }

            if (data.price < 0) {
                res.status(400).json({ error: 'Price must be non-negative' });
                return;
            }

            if (data.cost !== undefined && data.cost < 0) {
                res.status(400).json({ error: 'Cost must be non-negative' });
                return;
            }

            if (data.vatRate !== undefined && (data.vatRate < 0 || data.vatRate > 100)) {
                res.status(400).json({ error: 'VAT rate must be between 0 and 100' });
                return;
            }

            const article = await articleService.createArticle(companyId, data);
            res.status(201).json(article);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get all articles for the company
     * GET /api/articles
     */
    async getArticles(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { search, category, articleType, isActive } = req.query;

            const filters: any = {};
            if (search) filters.search = search as string;
            if (category) filters.category = category as string;
            if (articleType) filters.articleType = articleType as string;
            if (isActive !== undefined) filters.isActive = isActive === 'true';

            const articles = await articleService.getArticles(companyId, filters);
            res.json(articles);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get article by ID
     * GET /api/articles/:id
     */
    async getArticleById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;

            const article = await articleService.getArticleById(companyId, id);
            res.json(article);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Update article
     * PUT /api/articles/:id
     */
    async updateArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;
            const data: UpdateArticleDto = req.body;

            // Validation
            if (data.price !== undefined && data.price < 0) {
                res.status(400).json({ error: 'Price must be non-negative' });
                return;
            }

            if (data.cost !== undefined && data.cost < 0) {
                res.status(400).json({ error: 'Cost must be non-negative' });
                return;
            }

            if (data.vatRate !== undefined && (data.vatRate < 0 || data.vatRate > 100)) {
                res.status(400).json({ error: 'VAT rate must be between 0 and 100' });
                return;
            }

            const article = await articleService.updateArticle(companyId, id, data);
            res.json(article);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Delete article
     * DELETE /api/articles/:id
     */
    async deleteArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;

            await articleService.deleteArticle(companyId, id);
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get unique categories
     * GET /api/articles/categories/list
     */
    async getCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const categories = await articleService.getCategories(companyId);
            res.json(categories);
        } catch (error) {
            next(error);
        }
    }
};

5. Backend Routes
Filsökväg: backend/src/routes/articleRoutes.ts
typescriptimport { Router } from 'express';
import { articleController } from '../controllers/articleController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get categories (must be before /:id route)
router.get('/categories/list', articleController.getCategories);

// CRUD operations
router.post('/', articleController.createArticle);
router.get('/', articleController.getArticles);
router.get('/:id', articleController.getArticleById);
router.put('/:id', articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);

export default router;
Uppdatera: backend/src/app.ts - Lägg till routes
typescriptimport articleRoutes from './routes/articleRoutes';

// ... existing routes ...

app.use('/api/articles', articleRoutes);

6. Frontend Types
Filsökväg: frontend/src/types/article.types.ts
typescriptexport type ArticleType = 'product' | 'service' | 'package';

export type UnitType = 
    | 'piece'          // st (styck)
    | 'hour'           // timme
    | 'day'            // dag
    | 'month'          // månad
    | 'kg'             // kilogram
    | 'liter'          // liter
    | 'meter'          // meter
    | 'square_meter'   // kvadratmeter
    | 'cubic_meter';   // kubikmeter

export interface Article {
    id: string;
    companyId: string;
    articleNumber: string;
    name: string;
    description: string | null;
    articleType: ArticleType;
    sku: string | null;
    barcode: string | null;
    unit: UnitType;
    price: number;
    cost: number | null;
    vatRate: number;
    category: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateArticleDto {
    articleNumber: string;
    name: string;
    description?: string;
    articleType?: ArticleType;
    sku?: string;
    barcode?: string;
    unit?: UnitType;
    price: number;
    cost?: number;
    vatRate?: number;
    category?: string;
    isActive?: boolean;
}

export interface UpdateArticleDto {
    name?: string;
    description?: string;
    articleType?: ArticleType;
    sku?: string;
    barcode?: string;
    unit?: UnitType;
    price?: number;
    cost?: number;
    vatRate?: number;
    category?: string;
    isActive?: boolean;
}

7. Frontend Service
Filsökväg: frontend/src/services/articleService.ts
typescriptimport api from './api';
import { Article, CreateArticleDto, UpdateArticleDto } from '../types/article.types';

interface GetArticlesParams {
    search?: string;
    category?: string;
    articleType?: string;
    isActive?: boolean;
}

export const articleService = {
    /**
     * Create a new article
     */
    async createArticle(data: CreateArticleDto): Promise<Article> {
        const response = await api.post<Article>('/articles', data);
        return response.data;
    },

    /**
     * Get all articles with optional filters
     */
    async getArticles(params?: GetArticlesParams): Promise<Article[]> {
        const response = await api.get<Article[]>('/articles', { params });
        return response.data;
    },

    /**
     * Get article by ID
     */
    async getArticleById(id: string): Promise<Article> {
        const response = await api.get<Article>(`/articles/${id}`);
        return response.data;
    },

    /**
     * Update article
     */
    async updateArticle(id: string, data: UpdateArticleDto): Promise<Article> {
        const response = await api.put<Article>(`/articles/${id}`, data);
        return response.data;
    },

    /**
     * Delete article
     */
    async deleteArticle(id: string): Promise<void> {
        await api.delete(`/articles/${id}`);
    },

    /**
     * Get unique categories
     */
    async getCategories(): Promise<string[]> {
        const response = await api.get<string[]>('/articles/categories/list');
        return response.data;
    }
};

// Unit type labels for display
export const UNIT_LABELS: Record<string, string> = {
    piece: 'st',
    hour: 'timme',
    day: 'dag',
    month: 'månad',
    kg: 'kg',
    liter: 'liter',
    meter: 'm',
    square_meter: 'm²',
    cubic_meter: 'm³'
};

// Article type labels
export const ARTICLE_TYPE_LABELS: Record<string, string> = {
    product: 'Produkt',
    service: 'Tjänst',
    package: 'Paket'
};

// Common VAT rates
export const VAT_RATES = [
    { value: 0, label: '0%' },
    { value: 6, label: '6%' },
    { value: 12, label: '12%' },
    { value: 25, label: '25%' }
];

8. Frontend Hooks
Filsökväg: frontend/src/hooks/useArticle.ts
typescriptimport { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { articleService } from '../services/articleService';
import { CreateArticleDto, UpdateArticleDto, Article } from '../types/article.types';
import { toast } from 'react-hot-toast';

interface GetArticlesParams {
    search?: string;
    category?: string;
    articleType?: string;
    isActive?: boolean;
}

/**
 * Hook to fetch all articles
 */
export function useArticles(params?: GetArticlesParams) {
    return useQuery({
        queryKey: ['articles', params],
        queryFn: () => articleService.getArticles(params)
    });
}

/**
 * Hook to fetch a single article
 */
export function useArticle(id: string) {
    return useQuery({
        queryKey: ['articles', id],
        queryFn: () => articleService.getArticleById(id),
        enabled: !!id
    });
}

/**
 * Hook to fetch categories
 */
export function useArticleCategories() {
    return useQuery({
        queryKey: ['article-categories'],
        queryFn: () => articleService.getCategories()
    });
}

/**
 * Hook to create article
 */
export function useCreateArticle() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: CreateArticleDto) => articleService.createArticle(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['articles'] });
            queryClient.invalidateQueries({ queryKey: ['article-categories'] });
            toast.success('Artikel skapad');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Kunde inte skapa artikel');
        }
    });
}

/**
 * Hook to update article
 */
export function useUpdateArticle() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateArticleDto }) =>
            articleService.updateArticle(id, data),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['articles'] });
            queryClient.invalidateQueries({ queryKey: ['articles', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['article-categories'] });
            toast.success('Artikel uppdaterad');
        },
        onError: (error: any) {
            toast.error(error.response?.data?.error || 'Kunde inte uppdatera artikel');
        }
    });
}

/**
 * Hook to delete article
 */
export function useDeleteArticle() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => articleService.deleteArticle(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['articles'] });
            toast.success('Artikel raderad');
        },
        onError: (error: any) {
            toast.error(error.response?.data?.error || 'Kunde inte radera artikel');
        }
    });
}

/**
 * Hook for optimistic article updates
 */
export function useOptimisticArticleUpdate() {
    const queryClient = useQueryClient();

    return (id: string, updates: Partial<Article>) => {
        queryClient.setQueryData<Article>(
            ['articles', id],
            (old) => {
                if (!old) return old;
                return { ...old, ...updates };
            }
        );
    };
}

9. Frontend Components
Filsökväg: frontend/src/pages/ArticleListPage.tsx
typescriptimport React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
    Package, Plus, Search, Filter, Edit2, Trash2, 
    ChevronDown, Tag 
} from 'lucide-react';
import { useArticles, useDeleteArticle, useArticleCategories } from '../hooks/useArticle';
import { UNIT_LABELS, ARTICLE_TYPE_LABELS } from '../services/articleService';

export default function ArticleListPage() {
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [selectedType, setSelectedType] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);

    const { data: articles = [], isLoading } = useArticles({
        search,
        category: selectedCategory || undefined,
        articleType: selectedType || undefined
    });

    const { data: categories = [] } = useArticleCategories();
    const deleteArticle = useDeleteArticle();

    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`Är du säker på att du vill radera ${name}?`)) {
            await deleteArticle.mutateAsync(id);
        }
    };

    const formatPrice = (price: number) => {
        return new Intl.NumberFormat('sv-SE', {
            style: 'currency',
            currency: 'SEK'
        }).format(price);
    };

    const getMarginPercentage = (price: number, cost: number | null) => {
        if (!cost || cost === 0) return null;
        return ((price - cost) / price * 100).toFixed(1);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Package className="w-8 h-8" />
                        Artikelregister
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Hantera produkter och tjänster
                    </p>
                </div>
                <Link
                    to="/articles/new"
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-5 h-5" />
                    Ny Artikel
                </Link>
            </div>

            {/* Search and Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Sök artikelnr, namn, SKU..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                        <Filter className="w-5 h-5" />
                        Filter
                        <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </button>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                    <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Kategori
                            </label>
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Alla kategorier</option>
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Typ
                            </label>
                            <select
                                value={selectedType}
                                onChange={(e) => setSelectedType(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Alla typer</option>
                                <option value="product">Produkt</option>
                                <option value="service">Tjänst</option>
                                <option value="package">Paket</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Results Count */}
            <div className="text-sm text-gray-600">
                Visar {articles.length} artikel{articles.length !== 1 ? 'ar' : ''}
            </div>

            {/* Articles Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Artikelnr
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Namn
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Typ
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Kategori
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Pris
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Marginal
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Enhet
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Åtgärder
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {articles.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                                    <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                    <p className="text-lg font-medium">Inga artiklar hittades</p>
                                    <p className="text-sm mt-1">Skapa din första artikel för att komma igång</p>
                                </td>
                            </tr>
                        ) : (
                            articles.map((article) => {
                                const margin = getMarginPercentage(article.price, article.cost);
                                return (
                                    <tr key={article.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                {article.articleNumber}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">
                                                {article.name}
                                            </div>
                                            {article.sku && (
                                                <div className="text-xs text-gray-500">
                                                    SKU: {article.sku}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                                                {ARTICLE_TYPE_LABELS[article.articleType]}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {article.category && (
                                                <div className="flex items-center gap-1 text-sm text-gray-600">
                                                    <Tag className="w-3 h-3" />
                                                    {article.category}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <div className="text-sm font-medium text-gray-900">
                                                {formatPrice(article.price)}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                exkl. moms
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            {margin && (
                                                <span className={`text-sm font-medium ${
                                                    parseFloat(margin) > 30 ? 'text-green-600' :
                                                    parseFloat(margin) > 15 ? 'text-yellow-600' :
                                                    'text-red-600'
                                                }`}>
                                                    {margin}%
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            <span className="text-sm text-gray-600">
                                                {UNIT_LABELS[article.unit]}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex items-center justify-end gap-2">
                                                <Link
                                                    to={`/articles/${article.id}/edit`}
                                                    className="text-blue-600 hover:text-blue-900"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </Link>
                                                <button
                                                    onClick={() => handleDelete(article.id, article.name)}
                                                    className="text-red-600 hover:text-red-900"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
Filsökväg: frontend/src/pages/ArticleFormPage.tsx
typescriptimport React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Package, Save, X } from 'lucide-react';
import { useArticle, useCreateArticle, useUpdateArticle } from '../hooks/useArticle';
import { CreateArticleDto } from '../types/article.types';
import { UNIT_LABELS, ARTICLE_TYPE_LABELS, VAT_RATES } from '../services/articleService';

export default function ArticleFormPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditing = !!id;

    const { data: article, isLoading } = useArticle(id || '');
    const createArticle = useCreateArticle();
    const updateArticle = useUpdateArticle();

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
        watch
    } = useForm<CreateArticleDto>({
        defaultValues: {
            articleType: 'product',
            unit: 'piece',
            vatRate: 25.00,
            isActive: true
        }
    });

    useEffect(() => {
        if (article) {
            reset({
                articleNumber: article.articleNumber,
                name: article.name,
                description: article.description || '',
                articleType: article.articleType,
                sku: article.sku || '',
                barcode: article.barcode || '',
                unit: article.unit,
                price: article.price,
                cost: article.cost || undefined,
                vatRate: article.vatRate,
                category: article.category || '',
                isActive: article.isActive
            });
        }
    }, [article, reset]);

    const onSubmit = async (data: CreateArticleDto) => {
        try {
            if (isEditing) {
                await updateArticle.mutateAsync({ id: id!, data });
            } else {
                await createArticle.mutateAsync(data);
            }
            navigate('/articles');
        } catch (error) {
            // Error is handled by the hooks
        }
    };

    const price = watch('price');
    const cost = watch('cost');
    const vatRate = watch('vatRate');

    const calculatePriceWithVat = () => {
        if (!price) return 0;
        return price * (1 + (vatRate || 0) / 100);
    };

    const calculateMargin = () => {
        if (!price || !cost) return null;
        return ((price - cost) / price * 100).toFixed(1);
    };

    if (isLoading && isEditing) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Package className="w-8 h-8 text-blue-600" />
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {isEditing ? 'Redigera Artikel' : 'Ny Artikel'}
                    </h1>
                    <p className="text-gray-600">
                        {isEditing ? 'Uppdatera artikeluppgifter' : 'Skapa en ny produkt eller tjänst'}
                    </p>
                </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* Basic Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Grundläggande Information
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Artikelnummer *
                            </label>
                            <input
                                type="text"
                                {...register('articleNumber', { required: 'Artikelnummer krävs' })}
                                disabled={isEditing}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                            />
                            {errors.articleNumber && (
                                <p className="mt-1 text-sm text-red-600">{errors.articleNumber.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Artikeltyp
                            </label>
                            <select
                                {...register('articleType')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                {Object.entries(ARTICLE_TYPE_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Namn *
                            </label>
                            <input
                                type="text"
                                {...register('name', { required: 'Namn krävs' })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                            {errors.name && (
                                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                            )}
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Beskrivning
                            </label>
                            <textarea
                                {...register('description')}
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                SKU
                            </label>
                            <input
                                type="text"
                                {...register('sku')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Streckkod
                            </label>
                            <input
                                type="text"
                                {...register('barcode')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Kategori
                            </label>
                            <input
                                type="text"
                                {...register('category')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="t.ex. Elektronik, Tjänster"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Enhet
                            </label>
                            <select
                                {...register('unit')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                {Object.entries(UNIT_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Pricing */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Prissättning
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Försäljningspris (exkl. moms) *
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                {...register('price', { 
                                    required: 'Pris krävs',
                                    min: { value: 0, message: 'Pris måste vara positivt' }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                            {errors.price && (
                                <p className="mt-1 text-sm text-red-600">{errors.price.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Inköpspris
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                {...register('cost')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Momssats (%)
                            </label>
                            <select
                                {...register('vatRate')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                {VAT_RATES.map(rate => (
                                    <option key={rate.value} value={rate.value}>
                                        {rate.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Aktiv
                            </label>
                            <div className="flex items-center h-10">
                                <input
                                    type="checkbox"
                                    {...register('isActive')}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <label className="ml-2 text-sm text-gray-700">
                                    Artikel är aktiv
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Price Calculations */}
                    {price && (
                        <div className="mt-6 pt-4 border-t border-gray-200">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-600">Pris inkl. moms:</span>
                                    <span className="ml-2 font-medium text-gray-900">
                                        {calculatePriceWithVat().toFixed(2)} kr
                                    </span>
                                </div>
                                {cost && (
                                    <div>
                                        <span className="text-gray-600">Marginal:</span>
                                        <span className={`ml-2 font-medium ${
                                            parseFloat(calculateMargin()!) > 30 ? 'text-green-600' :
                                            parseFloat(calculateMargin()!) > 15 ? 'text-yellow-600' :
                                            'text-red-600'
                                        }`}>
                                            {calculateMargin()}%
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/articles')}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                        <X className="w-4 h-4" />
                        Avbryt
                    </button>
                    <button
                        type="submit"
                        disabled={createArticle.isPending || updateArticle.isPending}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Save className="w-4 h-4" />
                        {isEditing ? 'Uppdatera' : 'Skapa'}
                    </button>
                </div>
            </form>
        </div>
    );
}
Uppdatera: frontend/src/App.tsx - Lägg till routes
typescriptimport ArticleListPage from './pages/ArticleListPage';
import ArticleFormPage from './pages/ArticleFormPage';

// ... i routes:
<Route path="/articles" element={<ArticleListPage />} />
<Route path="/articles/new" element={<ArticleFormPage />} />
<Route path="/articles/:id/edit" element={<ArticleFormPage />} />

10. Tests
Filsökväg: backend/src/tests/unit/articleService.test.ts
typescriptimport { articleService } from '../../services/articleService';

describe('Article Service', () => {
    describe('createArticle', () => {
        it('should create article with required fields', async () => {
            const article = await articleService.createArticle('company-id', {
                articleNumber: 'ART001',
                name: 'Test Product',
                price: 100.00
            });

            expect(article).toMatchObject({
                articleNumber: 'ART001',
                name: 'Test Product',
                price: 100.00,
                unit: 'piece',
                vatRate: 25.00,
                isActive: true
            });
        });

        it('should throw error for duplicate article number', async () => {
            await expect(
                articleService.createArticle('company-id', {
                    articleNumber: 'ART001',
                    name: 'Duplicate',
                    price: 50.00
                })
            ).rejects.toThrow('Article number already exists');
        });
    });

    describe('getArticles', () => {
        it('should filter by category', async () => {
            const articles = await articleService.getArticles('company-id', {
                category: 'Electronics'
            });

            expect(articles.every(a => a.category === 'Electronics')).toBe(true);
        });

        it('should search by name and SKU', async () => {
            const articles = await articleService.getArticles('company-id', {
                search: 'laptop'
            });

            expect(articles.length).toBeGreaterThan(0);
        });
    });

    describe('updateArticle', () => {
        it('should update article price', async () => {
            const updated = await articleService.updateArticle('company-id', 'article-id', {
                price: 199.99
            });

            expect(updated.price).toBe(199.99);
        });
    });
});
Filsökväg: backend/src/tests/integration/articles.test.ts
typescriptimport request from 'supertest';
import app from '../../app';

describe('Article API', () => {
    let authToken: string;
    let articleId: string;

    beforeAll(async () => {
        // Login to get auth token
        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: 'test@example.com', password: 'password' });
        authToken = response.body.token;
    });

    describe('POST /api/articles', () => {
        it('should create new article', async () => {
            const response = await request(app)
                .post('/api/articles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    articleNumber: 'PROD001',
                    name: 'Test Product',
                    price: 149.99,
                    unit: 'piece',
                    vatRate: 25.00
                });

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('id');
            articleId = response.body.id;
        });

        it('should reject duplicate article number', async () => {
            const response = await request(app)
                .post('/api/articles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    articleNumber: 'PROD001',
                    name: 'Duplicate',
                    price: 99.99
                });

            expect(response.status).toBe(400);
        });
    });

    describe('GET /api/articles', () => {
        it('should return all articles', async () => {
            const response = await request(app)
                .get('/api/articles')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it('should filter by category', async () => {
            const response = await request(app)
                .get('/api/articles?category=Electronics')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.every((a: any) => a.category === 'Electronics')).toBe(true);
        });
    });

    describe('PUT /api/articles/:id', () => {
        it('should update article', async () => {
            const response = await request(app)
                .put(`/api/articles/${articleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ price: 199.99 });

            expect(response.status).toBe(200);
            expect(response.body.price).toBe(199.99);
        });
    });

    describe('DELETE /api/articles/:id', () => {
        it('should delete article', async () => {
            const response = await request(app)
                .delete(`/api/articles/${articleId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(204);
        });
    });
});

Verifiering
Kör följande steg för att verifiera implementationen:
bash# 1. Kör migration
docker exec -i redovisning-postgres psql -U postgres -d redovisning < database/migrations/004_articles.sql

# 2. Starta backend (om inte redan igång)
cd backend && npm run dev

# 3. Starta frontend (om inte redan igång)
cd frontend && npm run dev

# 4. Testa API endpoints
curl -X POST http://localhost:3000/api/articles \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "articleNumber": "ART001",
    "name": "Test Product",
    "price": 99.99,
    "unit": "piece",
    "vatRate": 25.00
  }'

# 5. Öppna frontend
# Navigera till http://localhost:5173/articles

# 6. Kör tester
cd backend && npm test -- articles

STEG 2.4: Invoice Module ✅ KOMPLETT
Instruktion:
Implementera komplett faktureringssystem med invoice lines, statushantering, OCR-nummer, automatiska beräkningar och PDF-generering.

1. Database Migration
Filsökväg: database/migrations/005_invoices.sql
sql-- Migration: Create invoices and invoice_lines tables
-- Description: Core invoicing functionality with OCR numbers and status tracking
-- Author: AI Assistant
-- Date: 2025-10-20

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create invoice_status enum
CREATE TYPE invoice_status AS ENUM (
    'draft',      -- Utkast
    'sent',       -- Skickad
    'paid',       -- Betald
    'overdue',    -- Förfallen
    'cancelled'   -- Makulerad
);

-- Create invoices table
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    
    -- Invoice numbers
    invoice_number VARCHAR(50) NOT NULL,
    ocr_number VARCHAR(50) NOT NULL,
    
    -- Dates
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    sent_date DATE,
    paid_date DATE,
    
    -- Status
    status invoice_status NOT NULL DEFAULT 'draft',
    
    -- Amounts (stored in öre/cents for precision)
    subtotal BIGINT NOT NULL DEFAULT 0,
    vat_amount BIGINT NOT NULL DEFAULT 0,
    total_amount BIGINT NOT NULL DEFAULT 0,
    
    -- Payment info
    payment_reference VARCHAR(100),
    
    -- Additional info
    notes TEXT,
    terms TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(company_id, invoice_number),
    UNIQUE(company_id, ocr_number),
    CONSTRAINT valid_amounts CHECK (
        subtotal >= 0 AND 
        vat_amount >= 0 AND 
        total_amount >= 0
    ),
    CONSTRAINT valid_dates CHECK (due_date >= invoice_date)
);

-- Create invoice_lines table
CREATE TABLE invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    article_id UUID REFERENCES articles(id) ON DELETE RESTRICT,
    
    -- Line details
    line_number INTEGER NOT NULL,
    description VARCHAR(500) NOT NULL,
    
    -- Quantities and pricing
    quantity DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    unit_price BIGINT NOT NULL,  -- In öre/cents
    
    -- VAT
    vat_rate DECIMAL(5, 2) NOT NULL,
    vat_amount BIGINT NOT NULL,
    
    -- Totals
    subtotal BIGINT NOT NULL,
    total BIGINT NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT positive_quantity CHECK (quantity > 0),
    CONSTRAINT valid_line_amounts CHECK (
        unit_price >= 0 AND
        vat_amount >= 0 AND
        subtotal >= 0 AND
        total >= 0
    ),
    UNIQUE(invoice_id, line_number)
);

-- Create indexes for performance
CREATE INDEX idx_invoices_company_id ON invoices(company_id);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_ocr_number ON invoices(ocr_number);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_created_at ON invoices(created_at);

CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_article_id ON invoice_lines(article_id);
CREATE INDEX idx_invoice_lines_line_number ON invoice_lines(line_number);

-- Create updated_at trigger for invoices
CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE invoices IS 'Customer invoices';
COMMENT ON TABLE invoice_lines IS 'Individual line items on invoices';
COMMENT ON COLUMN invoices.ocr_number IS 'OCR reference number with Luhn checksum';
COMMENT ON COLUMN invoices.subtotal IS 'Amount in öre (1 kr = 100 öre)';
COMMENT ON COLUMN invoices.vat_amount IS 'VAT amount in öre';
COMMENT ON COLUMN invoices.total_amount IS 'Total amount including VAT in öre';

2. Backend Types (Already Exists - For Reference)
Filsökväg: backend/src/types/invoice.types.ts
typescriptexport type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
    id: string;
    companyId: string;
    customerId: string;
    invoiceNumber: string;
    ocrNumber: string;
    invoiceDate: string;
    dueDate: string;
    sentDate: string | null;
    paidDate: string | null;
    status: InvoiceStatus;
    subtotal: number;  // In SEK (converted from öre)
    vatAmount: number;
    totalAmount: number;
    paymentReference: string | null;
    notes: string | null;
    terms: string | null;
    createdAt: string;
    updatedAt: string;
    
    // Relations
    customer?: any;  // Customer object when populated
    lines?: InvoiceLine[];
}

export interface InvoiceLine {
    id: string;
    invoiceId: string;
    articleId: string | null;
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;  // In SEK
    vatRate: number;
    vatAmount: number;
    subtotal: number;
    total: number;
    
    // Relations
    article?: any;  // Article object when populated
}

export interface CreateInvoiceDto {
    customerId: string;
    invoiceDate: string;
    dueDate: string;
    notes?: string;
    terms?: string;
    lines: CreateInvoiceLineDto[];
}

export interface CreateInvoiceLineDto {
    articleId?: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    vatRate: number;
}

export interface UpdateInvoiceDto {
    invoiceDate?: string;
    dueDate?: string;
    notes?: string;
    terms?: string;
    lines?: CreateInvoiceLineDto[];
}

export interface UpdateInvoiceStatusDto {
    status: InvoiceStatus;
    date?: string;  // For sent_date or paid_date
    paymentReference?: string;
}

3. Backend Service (Already Exists - For Reference)
Note: The service with OCR generation and calculations already exists. Here's the complete version for reference.
Filsökväg: backend/src/services/invoiceService.ts
typescriptimport pool from '../config/database';
import { Invoice, InvoiceLine, CreateInvoiceDto, UpdateInvoiceDto, UpdateInvoiceStatusDto } from '../types/invoice.types';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler';

// Helper: Convert öre to SEK
const oreToSek = (ore: number): number => ore / 100;

// Helper: Convert SEK to öre
const sekToOre = (sek: number): number => Math.round(sek * 100);

// Helper: Luhn checksum algorithm
function calculateLuhnChecksum(number: string): number {
    let sum = 0;
    let isEven = false;
    
    for (let i = number.length - 1; i >= 0; i--) {
        let digit = parseInt(number[i]);
        
        if (isEven) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        
        sum += digit;
        isEven = !isEven;
    }
    
    return (10 - (sum % 10)) % 10;
}

// Helper: Convert DB row to Invoice object
function toInvoice(row: any): Invoice {
    return {
        id: row.id,
        companyId: row.company_id,
        customerId: row.customer_id,
        invoiceNumber: row.invoice_number,
        ocrNumber: row.ocr_number,
        invoiceDate: row.invoice_date,
        dueDate: row.due_date,
        sentDate: row.sent_date,
        paidDate: row.paid_date,
        status: row.status,
        subtotal: oreToSek(row.subtotal),
        vatAmount: oreToSek(row.vat_amount),
        totalAmount: oreToSek(row.total_amount),
        paymentReference: row.payment_reference,
        notes: row.notes,
        terms: row.terms,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// Helper: Convert DB row to InvoiceLine object
function toInvoiceLine(row: any): InvoiceLine {
    return {
        id: row.id,
        invoiceId: row.invoice_id,
        articleId: row.article_id,
        lineNumber: row.line_number,
        description: row.description,
        quantity: parseFloat(row.quantity),
        unit: row.unit,
        unitPrice: oreToSek(row.unit_price),
        vatRate: parseFloat(row.vat_rate),
        vatAmount: oreToSek(row.vat_amount),
        subtotal: oreToSek(row.subtotal),
        total: oreToSek(row.total)
    };
}

export const invoiceService = {
    /**
     * Generate next invoice number for company
     */
    async generateInvoiceNumber(companyId: string): Promise<string> {
        const result = await pool.query(
            `SELECT invoice_number FROM invoices 
             WHERE company_id = $1 
             ORDER BY created_at DESC 
             LIMIT 1`,
            [companyId]
        );
        
        if (result.rows.length === 0) {
            return '1';
        }
        
        const lastNumber = parseInt(result.rows[0].invoice_number);
        return (lastNumber + 1).toString();
    },
    
    /**
     * Generate OCR number with Luhn checksum
     */
    generateOCRNumber(invoiceNumber: string): string {
        // Pad invoice number to at least 6 digits
        const paddedNumber = invoiceNumber.padStart(6, '0');
        
        // Calculate checksum
        const checksum = calculateLuhnChecksum(paddedNumber);
        
        // Return OCR number with checksum
        return `${paddedNumber}${checksum}`;
    },
    
    /**
     * Calculate invoice totals from lines
     */
    calculateInvoiceTotals(lines: CreateInvoiceLineDto[]): {
        subtotal: number;
        vatAmount: number;
        totalAmount: number;
    } {
        let subtotal = 0;
        let vatAmount = 0;
        
        for (const line of lines) {
            const lineSubtotal = line.quantity * line.unitPrice;
            const lineVat = lineSubtotal * (line.vatRate / 100);
            
            subtotal += lineSubtotal;
            vatAmount += lineVat;
        }
        
        const totalAmount = subtotal + vatAmount;
        
        return {
            subtotal: Math.round(subtotal * 100) / 100,
            vatAmount: Math.round(vatAmount * 100) / 100,
            totalAmount: Math.round(totalAmount * 100) / 100
        };
    },
    
    /**
     * Create new invoice
     */
    async createInvoice(companyId: string, data: CreateInvoiceDto): Promise<Invoice> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Generate invoice number and OCR
            const invoiceNumber = await this.generateInvoiceNumber(companyId);
            const ocrNumber = this.generateOCRNumber(invoiceNumber);
            
            // Calculate totals
            const totals = this.calculateInvoiceTotals(data.lines);
            
            // Create invoice
            const invoiceResult = await client.query(
                `INSERT INTO invoices (
                    company_id, customer_id, invoice_number, ocr_number,
                    invoice_date, due_date, status,
                    subtotal, vat_amount, total_amount,
                    notes, terms
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *`,
                [
                    companyId,
                    data.customerId,
                    invoiceNumber,
                    ocrNumber,
                    data.invoiceDate,
                    data.dueDate,
                    'draft',
                    sekToOre(totals.subtotal),
                    sekToOre(totals.vatAmount),
                    sekToOre(totals.totalAmount),
                    data.notes || null,
                    data.terms || null
                ]
            );
            
            const invoice = toInvoice(invoiceResult.rows[0]);
            
            // Create invoice lines
            const lines: InvoiceLine[] = [];
            for (let i = 0; i < data.lines.length; i++) {
                const line = data.lines[i];
                const lineSubtotal = line.quantity * line.unitPrice;
                const lineVat = lineSubtotal * (line.vatRate / 100);
                const lineTotal = lineSubtotal + lineVat;
                
                const lineResult = await client.query(
                    `INSERT INTO invoice_lines (
                        invoice_id, article_id, line_number,
                        description, quantity, unit, unit_price,
                        vat_rate, vat_amount, subtotal, total
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING *`,
                    [
                        invoice.id,
                        line.articleId || null,
                        i + 1,
                        line.description,
                        line.quantity,
                        line.unit,
                        sekToOre(line.unitPrice),
                        line.vatRate,
                        sekToOre(lineVat),
                        sekToOre(lineSubtotal),
                        sekToOre(lineTotal)
                    ]
                );
                
                lines.push(toInvoiceLine(lineResult.rows[0]));
            }
            
            await client.query('COMMIT');
            
            invoice.lines = lines;
            return invoice;
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },
    
    /**
     * Get all invoices for company
     */
    async getInvoices(
        companyId: string,
        filters?: {
            customerId?: string;
            status?: string;
            fromDate?: string;
            toDate?: string;
        }
    ): Promise<Invoice[]> {
        let query = `
            SELECT i.*, 
                   json_build_object(
                       'id', c.id,
                       'name', c.name,
                       'email', c.email
                   ) as customer
            FROM invoices i
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE i.company_id = $1
        `;
        const params: any[] = [companyId];
        let paramCount = 1;
        
        if (filters?.customerId) {
            paramCount++;
            query += ` AND i.customer_id = $${paramCount}`;
            params.push(filters.customerId);
        }
        
        if (filters?.status) {
            paramCount++;
            query += ` AND i.status = $${paramCount}`;
            params.push(filters.status);
        }
        
        if (filters?.fromDate) {
            paramCount++;
            query += ` AND i.invoice_date >= $${paramCount}`;
            params.push(filters.fromDate);
        }
        
        if (filters?.toDate) {
            paramCount++;
            query += ` AND i.invoice_date <= $${paramCount}`;
            params.push(filters.toDate);
        }
        
        query += ' ORDER BY i.invoice_date DESC, i.invoice_number DESC';
        
        const result = await pool.query(query, params);
        
        return result.rows.map(row => {
            const invoice = toInvoice(row);
            invoice.customer = row.customer;
            return invoice;
        });
    },
    
    /**
     * Get invoice by ID
     */
    async getInvoiceById(companyId: string, invoiceId: string): Promise<Invoice> {
        // Get invoice with customer
        const invoiceResult = await pool.query(
            `SELECT i.*, 
                    json_build_object(
                        'id', c.id,
                        'name', c.name,
                        'email', c.email,
                        'phone', c.phone,
                        'address', c.address,
                        'postalCode', c.postal_code,
                        'city', c.city,
                        'country', c.country,
                        'organizationNumber', c.organization_number
                    ) as customer
             FROM invoices i
             LEFT JOIN customers c ON i.customer_id = c.id
             WHERE i.id = $1 AND i.company_id = $2`,
            [invoiceId, companyId]
        );
        
        if (invoiceResult.rows.length === 0) {
            throw new NotFoundError('Invoice not found');
        }
        
        const invoice = toInvoice(invoiceResult.rows[0]);
        invoice.customer = invoiceResult.rows[0].customer;
        
        // Get invoice lines
        const linesResult = await pool.query(
            `SELECT il.*, 
                    json_build_object(
                        'id', a.id,
                        'articleNumber', a.article_number,
                        'name', a.name
                    ) as article
             FROM invoice_lines il
             LEFT JOIN articles a ON il.article_id = a.id
             WHERE il.invoice_id = $1
             ORDER BY il.line_number`,
            [invoiceId]
        );
        
        invoice.lines = linesResult.rows.map(row => {
            const line = toInvoiceLine(row);
            line.article = row.article;
            return line;
        });
        
        return invoice;
    },
    
    /**
     * Update invoice
     */
    async updateInvoice(
        companyId: string,
        invoiceId: string,
        data: UpdateInvoiceDto
    ): Promise<Invoice> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check if invoice exists and is in draft
            const checkResult = await client.query(
                'SELECT status FROM invoices WHERE id = $1 AND company_id = $2',
                [invoiceId, companyId]
            );
            
            if (checkResult.rows.length === 0) {
                throw new NotFoundError('Invoice not found');
            }
            
            if (checkResult.rows[0].status !== 'draft') {
                throw new BadRequestError('Only draft invoices can be updated');
            }
            
            // Update invoice
            const fields: string[] = [];
            const values: any[] = [];
            let paramCount = 0;
            
            if (data.invoiceDate) {
                paramCount++;
                fields.push(`invoice_date = $${paramCount}`);
                values.push(data.invoiceDate);
            }
            
            if (data.dueDate) {
                paramCount++;
                fields.push(`due_date = $${paramCount}`);
                values.push(data.dueDate);
            }
            
            if (data.notes !== undefined) {
                paramCount++;
                fields.push(`notes = $${paramCount}`);
                values.push(data.notes);
            }
            
            if (data.terms !== undefined) {
                paramCount++;
                fields.push(`terms = $${paramCount}`);
                values.push(data.terms);
            }
            
            // Update lines if provided
            if (data.lines) {
                // Recalculate totals
                const totals = this.calculateInvoiceTotals(data.lines);
                
                paramCount++;
                fields.push(`subtotal = $${paramCount}`);
                values.push(sekToOre(totals.subtotal));
                
                paramCount++;
                fields.push(`vat_amount = $${paramCount}`);
                values.push(sekToOre(totals.vatAmount));
                
                paramCount++;
                fields.push(`total_amount = $${paramCount}`);
                values.push(sekToOre(totals.totalAmount));
                
                // Delete old lines
                await client.query(
                    'DELETE FROM invoice_lines WHERE invoice_id = $1',
                    [invoiceId]
                );
                
                // Create new lines
                for (let i = 0; i < data.lines.length; i++) {
                    const line = data.lines[i];
                    const lineSubtotal = line.quantity * line.unitPrice;
                    const lineVat = lineSubtotal * (line.vatRate / 100);
                    const lineTotal = lineSubtotal + lineVat;
                    
                    await client.query(
                        `INSERT INTO invoice_lines (
                            invoice_id, article_id, line_number,
                            description, quantity, unit, unit_price,
                            vat_rate, vat_amount, subtotal, total
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                        [
                            invoiceId,
                            line.articleId || null,
                            i + 1,
                            line.description,
                            line.quantity,
                            line.unit,
                            sekToOre(line.unitPrice),
                            line.vatRate,
                            sekToOre(lineVat),
                            sekToOre(lineSubtotal),
                            sekToOre(lineTotal)
                        ]
                    );
                }
            }
            
            if (fields.length > 0) {
                values.push(invoiceId, companyId);
                await client.query(
                    `UPDATE invoices SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $${paramCount + 1} AND company_id = $${paramCount + 2}`,
                    values
                );
            }
            
            await client.query('COMMIT');
            
            // Return updated invoice
            return await this.getInvoiceById(companyId, invoiceId);
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },
    
    /**
     * Update invoice status
     */
    async updateInvoiceStatus(
        companyId: string,
        invoiceId: string,
        data: UpdateInvoiceStatusDto
    ): Promise<Invoice> {
        const fields: string[] = [`status = $1`];
        const values: any[] = [data.status];
        let paramCount = 1;
        
        // Set sent_date when marking as sent
        if (data.status === 'sent' && data.date) {
            paramCount++;
            fields.push(`sent_date = $${paramCount}`);
            values.push(data.date);
        }
        
        // Set paid_date when marking as paid
        if (data.status === 'paid') {
            if (data.date) {
                paramCount++;
                fields.push(`paid_date = $${paramCount}`);
                values.push(data.date);
            }
            if (data.paymentReference) {
                paramCount++;
                fields.push(`payment_reference = $${paramCount}`);
                values.push(data.paymentReference);
            }
        }
        
        values.push(invoiceId, companyId);
        
        const result = await pool.query(
            `UPDATE invoices 
             SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${paramCount + 1} AND company_id = $${paramCount + 2}
             RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            throw new NotFoundError('Invoice not found');
        }
        
        return await this.getInvoiceById(companyId, invoiceId);
    },
    
    /**
     * Delete invoice (only drafts)
     */
    async deleteInvoice(companyId: string, invoiceId: string): Promise<void> {
        const result = await pool.query(
            `DELETE FROM invoices 
             WHERE id = $1 AND company_id = $2 AND status = 'draft'
             RETURNING id`,
            [invoiceId, companyId]
        );
        
        if (result.rows.length === 0) {
            throw new BadRequestError('Only draft invoices can be deleted');
        }
    },
    
    /**
     * Get invoice statistics
     */
    async getInvoiceStats(companyId: string): Promise<any> {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_invoices,
                COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
                COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
                COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
                COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count,
                SUM(total_amount) FILTER (WHERE status = 'sent') as outstanding_amount,
                SUM(total_amount) FILTER (WHERE status = 'paid') as paid_amount
             FROM invoices
             WHERE company_id = $1`,
            [companyId]
        );
        
        const stats = result.rows[0];
        
        return {
            totalInvoices: parseInt(stats.total_invoices),
            draftCount: parseInt(stats.draft_count),
            sentCount: parseInt(stats.sent_count),
            paidCount: parseInt(stats.paid_count),
            overdueCount: parseInt(stats.overdue_count),
            outstandingAmount: stats.outstanding_amount ? oreToSek(stats.outstanding_amount) : 0,
            paidAmount: stats.paid_amount ? oreToSek(stats.paid_amount) : 0
        };
    }
};

4. Backend Controller (NEW - Complete Implementation)
Filsökväg: backend/src/controllers/invoiceController.ts
typescriptimport { Request, Response, NextFunction } from 'express';
import { invoiceService } from '../services/invoiceService';
import { CreateInvoiceDto, UpdateInvoiceDto, UpdateInvoiceStatusDto } from '../types/invoice.types';

export const invoiceController = {
    /**
     * Create a new invoice
     * POST /api/invoices
     */
    async createInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const data: CreateInvoiceDto = req.body;

            // Validation
            if (!data.customerId || !data.invoiceDate || !data.dueDate) {
                res.status(400).json({ 
                    error: 'Customer ID, invoice date, and due date are required' 
                });
                return;
            }

            if (!data.lines || data.lines.length === 0) {
                res.status(400).json({ error: 'At least one invoice line is required' });
                return;
            }

            // Validate dates
            const invoiceDate = new Date(data.invoiceDate);
            const dueDate = new Date(data.dueDate);
            
            if (dueDate < invoiceDate) {
                res.status(400).json({ error: 'Due date must be after invoice date' });
                return;
            }

            // Validate lines
            for (const line of data.lines) {
                if (!line.description || !line.unit) {
                    res.status(400).json({ 
                        error: 'Each line must have description and unit' 
                    });
                    return;
                }
                
                if (line.quantity <= 0) {
                    res.status(400).json({ error: 'Quantity must be positive' });
                    return;
                }
                
                if (line.unitPrice < 0) {
                    res.status(400).json({ error: 'Unit price must be non-negative' });
                    return;
                }
                
                if (line.vatRate < 0 || line.vatRate > 100) {
                    res.status(400).json({ error: 'VAT rate must be between 0 and 100' });
                    return;
                }
            }

            const invoice = await invoiceService.createInvoice(companyId, data);
            res.status(201).json(invoice);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get all invoices
     * GET /api/invoices
     */
    async getInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { customerId, status, fromDate, toDate } = req.query;

            const filters: any = {};
            if (customerId) filters.customerId = customerId as string;
            if (status) filters.status = status as string;
            if (fromDate) filters.fromDate = fromDate as string;
            if (toDate) filters.toDate = toDate as string;

            const invoices = await invoiceService.getInvoices(companyId, filters);
            res.json(invoices);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get invoice by ID
     * GET /api/invoices/:id
     */
    async getInvoiceById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;

            const invoice = await invoiceService.getInvoiceById(companyId, id);
            res.json(invoice);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Update invoice
     * PUT /api/invoices/:id
     */
    async updateInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;
            const data: UpdateInvoiceDto = req.body;

            // Validate dates if provided
            if (data.invoiceDate && data.dueDate) {
                const invoiceDate = new Date(data.invoiceDate);
                const dueDate = new Date(data.dueDate);
                
                if (dueDate < invoiceDate) {
                    res.status(400).json({ error: 'Due date must be after invoice date' });
                    return;
                }
            }

            // Validate lines if provided
            if (data.lines) {
                if (data.lines.length === 0) {
                    res.status(400).json({ error: 'At least one invoice line is required' });
                    return;
                }

                for (const line of data.lines) {
                    if (!line.description || !line.unit) {
                        res.status(400).json({ 
                            error: 'Each line must have description and unit' 
                        });
                        return;
                    }
                    
                    if (line.quantity <= 0) {
                        res.status(400).json({ error: 'Quantity must be positive' });
                        return;
                    }
                    
                    if (line.unitPrice < 0) {
                        res.status(400).json({ error: 'Unit price must be non-negative' });
                        return;
                    }
                }
            }

            const invoice = await invoiceService.updateInvoice(companyId, id, data);
            res.json(invoice);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Update invoice status
     * PATCH /api/invoices/:id/status
     */
    async updateInvoiceStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;
            const data: UpdateInvoiceStatusDto = req.body;

            if (!data.status) {
                res.status(400).json({ error: 'Status is required' });
                return;
            }

            const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
            if (!validStatuses.includes(data.status)) {
                res.status(400).json({ error: 'Invalid status' });
                return;
            }

            const invoice = await invoiceService.updateInvoiceStatus(companyId, id, data);
            res.json(invoice);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Delete invoice
     * DELETE /api/invoices/:id
     */
    async deleteInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const { id } = req.params;

            await invoiceService.deleteInvoice(companyId, id);
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get invoice statistics
     * GET /api/invoices/stats/summary
     */
    async getInvoiceStats(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const companyId = req.user!.companyId;
            const stats = await invoiceService.getInvoiceStats(companyId);
            res.json(stats);
        } catch (error) {
            next(error);
        }
    }
};

5. Backend Routes (NEW - Complete Implementation)
Filsökväg: backend/src/routes/invoiceRoutes.ts
typescriptimport { Router } from 'express';
import { invoiceController } from '../controllers/invoiceController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Statistics (must be before /:id routes)
router.get('/stats/summary', invoiceController.getInvoiceStats);

// CRUD operations
router.post('/', invoiceController.createInvoice);
router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.put('/:id', invoiceController.updateInvoice);
router.delete('/:id', invoiceController.deleteInvoice);

// Status updates
router.patch('/:id/status', invoiceController.updateInvoiceStatus);

export default router;
Uppdatera: backend/src/app.ts - Lägg till routes
typescriptimport invoiceRoutes from './routes/invoiceRoutes';

// ... existing routes ...

app.use('/api/invoices', invoiceRoutes);

6. Frontend Types
Filsökväg: frontend/src/types/invoice.types.ts
typescriptexport type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
    id: string;
    companyId: string;
    customerId: string;
    invoiceNumber: string;
    ocrNumber: string;
    invoiceDate: string;
    dueDate: string;
    sentDate: string | null;
    paidDate: string | null;
    status: InvoiceStatus;
    subtotal: number;
    vatAmount: number;
    totalAmount: number;
    paymentReference: string | null;
    notes: string | null;
    terms: string | null;
    createdAt: string;
    updatedAt: string;
    
    customer?: {
        id: string;
        name: string;
        email: string;
        phone?: string;
        address?: string;
        postalCode?: string;
        city?: string;
        country?: string;
        organizationNumber?: string;
    };
    lines?: InvoiceLine[];
}

export interface InvoiceLine {
    id: string;
    invoiceId: string;
    articleId: string | null;
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    vatRate: number;
    vatAmount: number;
    subtotal: number;
    total: number;
    
    article?: {
        id: string;
        articleNumber: string;
        name: string;
    };
}

export interface CreateInvoiceDto {
    customerId: string;
    invoiceDate: string;
    dueDate: string;
    notes?: string;
    terms?: string;
    lines: CreateInvoiceLineDto[];
}

export interface CreateInvoiceLineDto {
    articleId?: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    vatRate: number;
}

export interface UpdateInvoiceDto {
    invoiceDate?: string;
    dueDate?: string;
    notes?: string;
    terms?: string;
    lines?: CreateInvoiceLineDto[];
}

export interface UpdateInvoiceStatusDto {
    status: InvoiceStatus;
    date?: string;
    paymentReference?: string;
}

export interface InvoiceStats {
    totalInvoices: number;
    draftCount: number;
    sentCount: number;
    paidCount: number;
    overdueCount: number;
    outstandingAmount: number;
    paidAmount: number;
}

7. Frontend Service
Filsökväg: frontend/src/services/invoiceService.ts
typescriptimport api from './api';
import { 
    Invoice, 
    CreateInvoiceDto, 
    UpdateInvoiceDto, 
    UpdateInvoiceStatusDto,
    InvoiceStats 
} from '../types/invoice.types';

interface GetInvoicesParams {
    customerId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
}

export const invoiceService = {
    /**
     * Create a new invoice
     */
    async createInvoice(data: CreateInvoiceDto): Promise<Invoice> {
        const response = await api.post<Invoice>('/invoices', data);
        return response.data;
    },

    /**
     * Get all invoices with optional filters
     */
    async getInvoices(params?: GetInvoicesParams): Promise<Invoice[]> {
        const response = await api.get<Invoice[]>('/invoices', { params });
        return response.data;
    },

    /**
     * Get invoice by ID
     */
    async getInvoiceById(id: string): Promise<Invoice> {
        const response = await api.get<Invoice>(`/invoices/${id}`);
        return response.data;
    },

    /**
     * Update invoice
     */
    async updateInvoice(id: string, data: UpdateInvoiceDto): Promise<Invoice> {
        const response = await api.put<Invoice>(`/invoices/${id}`, data);
        return response.data;
    },

    /**
     * Update invoice status
     */
    async updateInvoiceStatus(id: string, data: UpdateInvoiceStatusDto): Promise<Invoice> {
        const response = await api.patch<Invoice>(`/invoices/${id}/status`, data);
        return response.data;
    },

    /**
     * Delete invoice
     */
    async deleteInvoice(id: string): Promise<void> {
        await api.delete(`/invoices/${id}`);
    },

    /**
     * Get invoice statistics
     */
    async getInvoiceStats(): Promise<InvoiceStats> {
        const response = await api.get<InvoiceStats>('/invoices/stats/summary');
        return response.data;
    }
};

// Status labels
export const INVOICE_STATUS_LABELS: Record<string, string> = {
    draft: 'Utkast',
    sent: 'Skickad',
    paid: 'Betald',
    overdue: 'Förfallen',
    cancelled: 'Makulerad'
};

// Status colors
export const INVOICE_STATUS_COLORS: Record<string, string> = {
    draft: 'gray',
    sent: 'blue',
    paid: 'green',
    overdue: 'red',
    cancelled: 'gray'
};

// Format currency
export const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK'
    }).format(amount);
};

// Format date
export const formatDate = (date: string): string => {
    return new Date(date).toLocaleDateString('sv-SE');
};

// Calculate days until due
export const daysUntilDue = (dueDate: string): number => {
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

8. Frontend Hooks
Filsökväg: frontend/src/hooks/useInvoice.ts
typescriptimport { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceService } from '../services/invoiceService';
import { 
    CreateInvoiceDto, 
    UpdateInvoiceDto, 
    UpdateInvoiceStatusDto 
} from '../types/invoice.types';
import { toast } from 'react-hot-toast';

interface GetInvoicesParams {
    customerId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
}

/**
 * Hook to fetch all invoices
 */
export function useInvoices(params?: GetInvoicesParams) {
    return useQuery({
        queryKey: ['invoices', params],
        queryFn: () => invoiceService.getInvoices(params)
    });
}

/**
 * Hook to fetch a single invoice
 */
export function useInvoice(id: string) {
    return useQuery({
        queryKey: ['invoices', id],
        queryFn: () => invoiceService.getInvoiceById(id),
        enabled: !!id
    });
}

/**
 * Hook to fetch invoice statistics
 */
export function useInvoiceStats() {
    return useQuery({
        queryKey: ['invoice-stats'],
        queryFn: () => invoiceService.getInvoiceStats()
    });
}

/**
 * Hook to create invoice
 */
export function useCreateInvoice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: CreateInvoiceDto) => invoiceService.createInvoice(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoice-stats'] });
            toast.success('Faktura skapad');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Kunde inte skapa faktura');
        }
    });
}

/**
 * Hook to update invoice
 */
export function useUpdateInvoice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateInvoiceDto }) =>
            invoiceService.updateInvoice(id, data),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['invoice-stats'] });
            toast.success('Faktura uppdaterad');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Kunde inte uppdatera faktura');
        }
    });
}

/**
 * Hook to update invoice status
 */
export function useUpdateInvoiceStatus() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateInvoiceStatusDto }) =>
            invoiceService.updateInvoiceStatus(id, data),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['invoice-stats'] });
            toast.success('Status uppdaterad');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Kunde inte uppdatera status');
        }
    });
}

/**
 * Hook to delete invoice
 */
export function useDeleteInvoice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => invoiceService.deleteInvoice(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoice-stats'] });
            toast.success('Faktura raderad');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Kunde inte radera faktura');
        }
    });
}

9. Frontend Components (Part 1/3)
Filsökväg: frontend/src/pages/InvoiceListPage.tsx
typescriptimport React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
    FileText, Plus, Search, Filter, Eye, Edit2, Trash2,
    ChevronDown, Send, CheckCircle, AlertCircle, XCircle
} from 'lucide-react';
import { useInvoices, useDeleteInvoice, useInvoiceStats } from '../hooks/useInvoice';
import { 
    INVOICE_STATUS_LABELS, 
    INVOICE_STATUS_COLORS,
    formatCurrency,
    formatDate,
    daysUntilDue
} from '../services/invoiceService';

export default function InvoiceListPage() {
    const [search, setSearch] = useState('');
    const [selectedStatus, setSelectedStatus] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);

    const { data: invoices = [], isLoading } = useInvoices({
        status: selectedStatus || undefined
    });

    const { data: stats } = useInvoiceStats();
    const deleteInvoice = useDeleteInvoice();

    // Filter invoices by search
    const filteredInvoices = invoices.filter(invoice => {
        if (!search) return true;
        const searchLower = search.toLowerCase();
        return (
            invoice.invoiceNumber.toLowerCase().includes(searchLower) ||
            invoice.customer?.name.toLowerCase().includes(searchLower) ||
            invoice.ocrNumber.includes(searchLower)
        );
    });

    const handleDelete = async (id: string, number: string) => {
        if (window.confirm(`Är du säker på att du vill radera faktura ${number}?`)) {
            await deleteInvoice.mutateAsync(id);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'sent': return <Send className="w-4 h-4" />;
            case 'paid': return <CheckCircle className="w-4 h-4" />;
            case 'overdue': return <AlertCircle className="w-4 h-4" />;
            case 'cancelled': return <XCircle className="w-4 h-4" />;
            default: return null;
        }
    };

    const getStatusBadgeClass = (status: string) => {
        const color = INVOICE_STATUS_COLORS[status];
        const baseClasses = 'px-2 py-1 text-xs font-medium rounded flex items-center gap-1';
        
        switch (color) {
            case 'gray':
                return `${baseClasses} bg-gray-100 text-gray-800`;
            case 'blue':
                return `${baseClasses} bg-blue-100 text-blue-800`;
            case 'green':
                return `${baseClasses} bg-green-100 text-green-800`;
            case 'red':
                return `${baseClasses} bg-red-100 text-red-800`;
            default:
                return `${baseClasses} bg-gray-100 text-gray-800`;
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <FileText className="w-8 h-8" />
                        Fakturor
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Hantera kundfakturor
                    </p>
                </div>
                <Link
                    to="/invoices/new"
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-5 h-5" />
                    Ny Faktura
                </Link>
            </div>

            {/* Statistics Cards */}
            {stats && (
                <div className="grid grid-cols-4 gap-4">
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="text-sm text-gray-600">Totalt</div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">
                            {stats.totalInvoices}
                        </div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="text-sm text-gray-600">Skickade</div>
                        <div className="text-2xl font-bold text-blue-600 mt-1">
                            {stats.sentCount}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                            {formatCurrency(stats.outstandingAmount)} utestående
                        </div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="text-sm text-gray-600">Betalda</div>
                        <div className="text-2xl font-bold text-green-600 mt-1">
                            {stats.paidCount}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                            {formatCurrency(stats.paidAmount)} totalt
                        </div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="text-sm text-gray-600">Förfallna</div>
                        <div className="text-2xl font-bold text-red-600 mt-1">
                            {stats.overdueCount}
                        </div>
                    </div>
                </div>
            )}

            {/* Search and Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Sök fakturanr, kund, OCR..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                        <Filter className="w-5 h-5" />
                        Filter
                        <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </button>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Status
                        </label>
                        <select
                            value={selectedStatus}
                            onChange={(e) => setSelectedStatus(e.target.value)}
                            className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Alla statusar</option>
                            <option value="draft">Utkast</option>
                            <option value="sent">Skickad</option>
                            <option value="paid">Betald</option>
                            <option value="overdue">Förfallen</option>
                            <option value="cancelled">Makulerad</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Results Count */}
            <div className="text-sm text-gray-600">
                Visar {filteredInvoices.length} faktura{filteredInvoices.length !== 1 ? 'r' : ''}
            </div>

            {/* Invoices Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Fakturanr
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Kund
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Datum
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Förfallodatum
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Belopp
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Åtgärder
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {filteredInvoices.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                    <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                    <p className="text-lg font-medium">Inga fakturor hittades</p>
                                    <p className="text-sm mt-1">Skapa din första faktura för att komma igång</p>
                                </td>
                            </tr>
                        ) : (
                            filteredInvoices.map((invoice) => {
                                const daysLeft = daysUntilDue(invoice.dueDate);
                                const isOverdue = daysLeft < 0 && invoice.status === 'sent';
                                
                                return (
                                    <tr key={invoice.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                #{invoice.invoiceNumber}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                OCR: {invoice.ocrNumber}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">
                                                {invoice.customer?.name}
                                            </div>
                                            {invoice.customer?.email && (
                                                <div className="text-xs text-gray-500">
                                                    {invoice.customer.email}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                            {formatDate(invoice.invoiceDate)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-600">
                                                {formatDate(invoice.dueDate)}
                                            </div>
                                            {invoice.status === 'sent' && (
                                                <div className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                                    {isOverdue ? `${Math.abs(daysLeft)} dagar sen` : `${daysLeft} dagar kvar`}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <div className="text-sm font-medium text-gray-900">
                                                {formatCurrency(invoice.totalAmount)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={getStatusBadgeClass(invoice.status)}>
                                                {getStatusIcon(invoice.status)}
                                                {INVOICE_STATUS_LABELS[invoice.status]}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex items-center justify-end gap-2">
                                                <Link
                                                    to={`/invoices/${invoice.id}`}
                                                    className="text-gray-600 hover:text-gray-900"
                                                    title="Visa"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Link>
                                                {invoice.status === 'draft' && (
                                                    <>
                                                        <Link
                                                            to={`/invoices/${invoice.id}/edit`}
                                                            className="text-blue-600 hover:text-blue-900"
                                                            title="Redigera"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </Link>
                                                        <button
                                                            onClick={() => handleDelete(invoice.id, invoice.invoiceNumber)}
                                                            className="text-red-600 hover:text-red-900"
                                                            title="Radera"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

10. Tests
Filsökväg: backend/src/tests/unit/invoiceService.test.ts
typescriptimport { invoiceService } from '../../services/invoiceService';

describe('Invoice Service', () => {
    describe('generateOCRNumber', () => {
        it('should generate OCR with Luhn checksum', () => {
            const ocr = invoiceService.generateOCRNumber('123');
            expect(ocr).toBe('0001237');
            expect(ocr.length).toBe(7);
        });

        it('should generate different OCR for different numbers', () => {
            const ocr1 = invoiceService.generateOCRNumber('1');
            const ocr2 = invoiceService.generateOCRNumber('2');
            expect(ocr1).not.toBe(ocr2);
        });
    });

    describe('calculateInvoiceTotals', () => {
        it('should calculate totals correctly', () => {
            const lines = [
                {
                    description: 'Item 1',
                    quantity: 2,
                    unit: 'st',
                    unitPrice: 100,
                    vatRate: 25
                },
                {
                    description: 'Item 2',
                    quantity: 1,
                    unit: 'st',
                    unitPrice: 50,
                    vatRate: 25
                }
            ];

            const totals = invoiceService.calculateInvoiceTotals(lines);

            expect(totals.subtotal).toBe(250);
            expect(totals.vatAmount).toBe(62.5);
            expect(totals.totalAmount).toBe(312.5);
        });

        it('should handle different VAT rates', () => {
            const lines = [
                {
                    description: 'Item 1',
                    quantity: 1,
                    unit: 'st',
                    unitPrice: 100,
                    vatRate: 25
                },
                {
                    description: 'Item 2',
                    quantity: 1,
                    unit: 'st',
                    unitPrice: 100,
                    vatRate: 12
                }
            ];

            const totals = invoiceService.calculateInvoiceTotals(lines);

            expect(totals.subtotal).toBe(200);
            expect(totals.vatAmount).toBe(37);
            expect(totals.totalAmount).toBe(237);
        });
    });

    describe('createInvoice', () => {
        it('should create invoice with lines', async () => {
            const invoice = await invoiceService.createInvoice('company-id', {
                customerId: 'customer-id',
                invoiceDate: '2025-01-01',
                dueDate: '2025-01-31',
                lines: [
                    {
                        description: 'Test Product',
                        quantity: 1,
                        unit: 'st',
                        unitPrice: 100,
                        vatRate: 25
                    }
                ]
            });

            expect(invoice).toHaveProperty('invoiceNumber');
            expect(invoice).toHaveProperty('ocrNumber');
            expect(invoice.status).toBe('draft');
            expect(invoice.lines).toHaveLength(1);
        });
    });
});
Filsökväg: backend/src/tests/integration/invoices.test.ts
typescriptimport request from 'supertest';
import app from '../../app';

describe('Invoice API', () => {
    let authToken: string;
    let customerId: string;
    let invoiceId: string;

    beforeAll(async () => {
        // Login to get auth token
        const authResponse = await request(app)
            .post('/api/auth/login')
            .send({ email: 'test@example.com', password: 'password' });
        authToken = authResponse.body.token;

        // Create a customer for testing
        const customerResponse = await request(app)
            .post('/api/customers')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
                name: 'Test Customer',
                email: 'customer@test.com',
                organizationType: 'company'
            });
        customerId = customerResponse.body.id;
    });

    describe('POST /api/invoices', () => {
        it('should create new invoice', async () => {
            const response = await request(app)
                .post('/api/invoices')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    customerId: customerId,
                    invoiceDate: '2025-01-01',
                    dueDate: '2025-01-31',
                    lines: [
                        {
                            description: 'Test Product',
                            quantity: 2,
                            unit: 'st',
                            unitPrice: 100,
                            vatRate: 25
                        }
                    ]
                });

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('id');
            expect(response.body).toHaveProperty('invoiceNumber');
            expect(response.body).toHaveProperty('ocrNumber');
            expect(response.body.totalAmount).toBe(250);
            invoiceId = response.body.id;
        });

        it('should reject invoice without lines', async () => {
            const response = await request(app)
                .post('/api/invoices')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    customerId: customerId,
                    invoiceDate: '2025-01-01',
                    dueDate: '2025-01-31',
                    lines: []
                });

            expect(response.status).toBe(400);
        });
    });

    describe('GET /api/invoices', () => {
        it('should return all invoices', async () => {
            const response = await request(app)
                .get('/api/invoices')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it('should filter by status', async () => {
            const response = await request(app)
                .get('/api/invoices?status=draft')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.every((inv: any) => inv.status === 'draft')).toBe(true);
        });
    });

    describe('PATCH /api/invoices/:id/status', () => {
        it('should update invoice status', async () => {
            const response = await request(app)
                .patch(`/api/invoices/${invoiceId}/status`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    status: 'sent',
                    date: '2025-01-15'
                });

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('sent');
            expect(response.body.sentDate).toBe('2025-01-15');
        });
    });

    describe('GET /api/invoices/stats/summary', () => {
        it('should return statistics', async () => {
            const response = await request(app)
                .get('/api/invoices/stats/summary')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('totalInvoices');
            expect(response.body).toHaveProperty('sentCount');
            expect(response.body).toHaveProperty('paidCount');
        });
    });
});

Verifiering
Kör följande steg för att verifiera implementationen:
bash# 1. Kör migration
docker exec -i redovisning-postgres psql -U postgres -d redovisning < database/migrations/005_invoices.sql

# 2. Starta backend (om inte redan igång)
cd backend && npm run dev

# 3. Starta frontend (om inte redan igång)
cd frontend && npm run dev

# 4. Testa API endpoints
curl -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUSTOMER_UUID",
    "invoiceDate": "2025-01-01",
    "dueDate": "2025-01-31",
    "lines": [
      {
        "description": "Test Product",
        "quantity": 1,
        "unit": "st",
        "unitPrice": 100,
        "vatRate": 25
      }
    ]
  }'

# 5. Öppna frontend
# Navigera till http://localhost:5173/invoices

# 6. Kör tester
cd backend && npm test -- invoices

STEG 2.4: Invoice Module - DEL 2/2 ✅ FRONTEND KOMPONENTER
Detta är en fortsättning av DEL 1. Lägg till dessa komponenter efter DEL 1 i Claude.md

Frontend Components (Part 2/3) - InvoiceFormPage
Filsökväg: frontend/src/pages/InvoiceFormPage.tsx
typescriptimport React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { FileText, Save, X, Plus, Trash2, Package } from 'lucide-react';
import { useInvoice, useCreateInvoice, useUpdateInvoice } from '../hooks/useInvoice';
import { useCustomers } from '../hooks/useCustomer';
import { useArticles } from '../hooks/useArticle';
import { CreateInvoiceDto, CreateInvoiceLineDto } from '../types/invoice.types';
import { formatCurrency } from '../services/invoiceService';
import { UNIT_LABELS, VAT_RATES } from '../services/articleService';

export default function InvoiceFormPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditing = !!id;

    const { data: invoice, isLoading: invoiceLoading } = useInvoice(id || '');
    const { data: customers = [] } = useCustomers();
    const { data: articles = [] } = useArticles({ isActive: true });
    
    const createInvoice = useCreateInvoice();
    const updateInvoice = useUpdateInvoice();

    const {
        register,
        control,
        handleSubmit,
        formState: { errors },
        reset,
        watch,
        setValue
    } = useForm<CreateInvoiceDto>({
        defaultValues: {
            customerId: '',
            invoiceDate: new Date().toISOString().split('T')[0],
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            notes: '',
            terms: 'Betalningsvillkor: 30 dagar netto\nVid försenad betalning tillkommer dröjsmålsränta enligt räntelagen.',
            lines: [
                {
                    articleId: '',
                    description: '',
                    quantity: 1,
                    unit: 'st',
                    unitPrice: 0,
                    vatRate: 25
                }
            ]
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: 'lines'
    });

    useEffect(() => {
        if (invoice) {
            reset({
                customerId: invoice.customerId,
                invoiceDate: invoice.invoiceDate,
                dueDate: invoice.dueDate,
                notes: invoice.notes || '',
                terms: invoice.terms || '',
                lines: invoice.lines?.map(line => ({
                    articleId: line.articleId || '',
                    description: line.description,
                    quantity: line.quantity,
                    unit: line.unit,
                    unitPrice: line.unitPrice,
                    vatRate: line.vatRate
                })) || []
            });
        }
    }, [invoice, reset]);

    const lines = watch('lines');

    // Calculate totals
    const calculateLineTotals = (line: CreateInvoiceLineDto) => {
        const subtotal = line.quantity * line.unitPrice;
        const vat = subtotal * (line.vatRate / 100);
        const total = subtotal + vat;
        return { subtotal, vat, total };
    };

    const invoiceTotals = lines.reduce((acc, line) => {
        const { subtotal, vat, total } = calculateLineTotals(line);
        return {
            subtotal: acc.subtotal + subtotal,
            vat: acc.vat + vat,
            total: acc.total + total
        };
    }, { subtotal: 0, vat: 0, total: 0 });

    // Handle article selection
    const handleArticleSelect = (index: number, articleId: string) => {
        const article = articles.find(a => a.id === articleId);
        if (article) {
            setValue(`lines.${index}.description`, article.name);
            setValue(`lines.${index}.unit`, article.unit);
            setValue(`lines.${index}.unitPrice`, article.price);
            setValue(`lines.${index}.vatRate`, article.vatRate);
        }
    };

    const onSubmit = async (data: CreateInvoiceDto) => {
        try {
            if (isEditing) {
                await updateInvoice.mutateAsync({ id: id!, data });
            } else {
                await createInvoice.mutateAsync(data);
            }
            navigate('/invoices');
        } catch (error) {
            // Error is handled by the hooks
        }
    };

    if (invoiceLoading && isEditing) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-blue-600" />
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {isEditing ? 'Redigera Faktura' : 'Ny Faktura'}
                    </h1>
                    <p className="text-gray-600">
                        {isEditing ? 'Uppdatera fakturauppgifter' : 'Skapa en ny kundfaktura'}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* Basic Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Grundläggande Information
                    </h2>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Kund *
                            </label>
                            <select
                                {...register('customerId', { required: 'Kund krävs' })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Välj kund</option>
                                {customers.map(customer => (
                                    <option key={customer.id} value={customer.id}>
                                        {customer.name}
                                        {customer.organizationNumber && ` (${customer.organizationNumber})`}
                                    </option>
                                ))}
                            </select>
                            {errors.customerId && (
                                <p className="mt-1 text-sm text-red-600">{errors.customerId.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Fakturadatum *
                            </label>
                            <input
                                type="date"
                                {...register('invoiceDate', { required: 'Fakturadatum krävs' })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                            {errors.invoiceDate && (
                                <p className="mt-1 text-sm text-red-600">{errors.invoiceDate.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Förfallodatum *
                            </label>
                            <input
                                type="date"
                                {...register('dueDate', { required: 'Förfallodatum krävs' })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                            {errors.dueDate && (
                                <p className="mt-1 text-sm text-red-600">{errors.dueDate.message}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Invoice Lines */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Fakturarader
                        </h2>
                        <button
                            type="button"
                            onClick={() => append({
                                articleId: '',
                                description: '',
                                quantity: 1,
                                unit: 'st',
                                unitPrice: 0,
                                vatRate: 25
                            })}
                            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                        >
                            <Plus className="w-4 h-4" />
                            Lägg till rad
                        </button>
                    </div>

                    <div className="space-y-4">
                        {fields.map((field, index) => {
                            const lineTotals = calculateLineTotals(lines[index]);
                            
                            return (
                                <div key={field.id} className="border border-gray-200 rounded-lg p-4">
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-sm font-medium text-gray-700">
                                            Rad {index + 1}
                                        </span>
                                        {fields.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => remove(index)}
                                                className="text-red-600 hover:text-red-700"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-12 gap-3">
                                        {/* Article Selection */}
                                        <div className="col-span-12 md:col-span-4">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                Artikel (valfritt)
                                            </label>
                                            <select
                                                {...register(`lines.${index}.articleId` as const)}
                                                onChange={(e) => handleArticleSelect(index, e.target.value)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="">Välj artikel...</option>
                                                {articles.map(article => (
                                                    <option key={article.id} value={article.id}>
                                                        {article.articleNumber} - {article.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Description */}
                                        <div className="col-span-12 md:col-span-8">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                Beskrivning *
                                            </label>
                                            <input
                                                type="text"
                                                {...register(`lines.${index}.description` as const, { 
                                                    required: 'Beskrivning krävs' 
                                                })}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        {/* Quantity */}
                                        <div className="col-span-3">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                Antal *
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                {...register(`lines.${index}.quantity` as const, { 
                                                    required: 'Antal krävs',
                                                    min: { value: 0.01, message: 'Minst 0.01' }
                                                })}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        {/* Unit */}
                                        <div className="col-span-3">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                Enhet *
                                            </label>
                                            <select
                                                {...register(`lines.${index}.unit` as const)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                            >
                                                {Object.entries(UNIT_LABELS).map(([value, label]) => (
                                                    <option key={value} value={value}>{label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Unit Price */}
                                        <div className="col-span-3">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                À-pris (kr) *
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                {...register(`lines.${index}.unitPrice` as const, { 
                                                    required: 'Pris krävs',
                                                    min: { value: 0, message: 'Minst 0' }
                                                })}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        {/* VAT Rate */}
                                        <div className="col-span-3">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                Moms %
                                            </label>
                                            <select
                                                {...register(`lines.${index}.vatRate` as const)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                            >
                                                {VAT_RATES.map(rate => (
                                                    <option key={rate.value} value={rate.value}>
                                                        {rate.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Line Totals */}
                                        <div className="col-span-12 mt-2 pt-2 border-t border-gray-200">
                                            <div className="grid grid-cols-3 gap-2 text-xs">
                                                <div className="text-gray-600">
                                                    Subtotal: <span className="font-medium text-gray-900">
                                                        {formatCurrency(lineTotals.subtotal)}
                                                    </span>
                                                </div>
                                                <div className="text-gray-600">
                                                    Moms: <span className="font-medium text-gray-900">
                                                        {formatCurrency(lineTotals.vat)}
                                                    </span>
                                                </div>
                                                <div className="text-gray-600">
                                                    Total: <span className="font-medium text-gray-900">
                                                        {formatCurrency(lineTotals.total)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Invoice Totals */}
                    <div className="mt-6 pt-4 border-t-2 border-gray-300">
                        <div className="flex justify-end">
                            <div className="w-64 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Subtotal:</span>
                                    <span className="font-medium text-gray-900">
                                        {formatCurrency(invoiceTotals.subtotal)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Moms:</span>
                                    <span className="font-medium text-gray-900">
                                        {formatCurrency(invoiceTotals.vat)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                                    <span className="text-gray-900">Totalt att betala:</span>
                                    <span className="text-blue-600">
                                        {formatCurrency(invoiceTotals.total)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Additional Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Övrig Information
                    </h2>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Anteckningar
                            </label>
                            <textarea
                                {...register('notes')}
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="Valfria anteckningar som syns på fakturan..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Betalningsvillkor
                            </label>
                            <textarea
                                {...register('terms')}
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/invoices')}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                        <X className="w-4 h-4" />
                        Avbryt
                    </button>
                    <button
                        type="submit"
                        disabled={createInvoice.isPending || updateInvoice.isPending}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Save className="w-4 h-4" />
                        {isEditing ? 'Uppdatera' : 'Skapa'} Faktura
                    </button>
                </div>
            </form>
        </div>
    );
}

Frontend Components (Part 3/3) - InvoiceDetailPage
Filsökväg: frontend/src/pages/InvoiceDetailPage.tsx
typescriptimport React, { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { 
    FileText, Send, CheckCircle, Edit2, Download, 
    Printer, Mail, MoreVertical, AlertCircle, Clock,
    Building, User, Calendar, CreditCard, Hash
} from 'lucide-react';
import { useInvoice, useUpdateInvoiceStatus, useDeleteInvoice } from '../hooks/useInvoice';
import { 
    INVOICE_STATUS_LABELS,
    formatCurrency,
    formatDate,
    daysUntilDue
} from '../services/invoiceService';

export default function InvoiceDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [showActions, setShowActions] = useState(false);

    const { data: invoice, isLoading } = useInvoice(id!);
    const updateStatus = useUpdateInvoiceStatus();
    const deleteInvoice = useDeleteInvoice();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!invoice) {
        return (
            <div className="text-center py-12">
                <FileText className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <h2 className="text-xl font-semibold text-gray-900">Faktura hittades inte</h2>
            </div>
        );
    }

    const daysLeft = daysUntilDue(invoice.dueDate);
    const isOverdue = daysLeft < 0 && invoice.status === 'sent';

    const handleMarkAsSent = async () => {
        await updateStatus.mutateAsync({
            id: invoice.id,
            data: {
                status: 'sent',
                date: new Date().toISOString().split('T')[0]
            }
        });
    };

    const handleMarkAsPaid = async () => {
        const paymentDate = prompt('Betalningsdatum (ÅÅÅÅ-MM-DD):', new Date().toISOString().split('T')[0]);
        if (paymentDate) {
            await updateStatus.mutateAsync({
                id: invoice.id,
                data: {
                    status: 'paid',
                    date: paymentDate
                }
            });
        }
    };

    const handleDelete = async () => {
        if (window.confirm(`Är du säker på att du vill radera faktura ${invoice.invoiceNumber}?`)) {
            await deleteInvoice.mutateAsync(invoice.id);
            navigate('/invoices');
        }
    };

    const getStatusBadge = () => {
        const baseClasses = 'px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2';
        
        switch (invoice.status) {
            case 'draft':
                return (
                    <span className={`${baseClasses} bg-gray-100 text-gray-800`}>
                        <Clock className="w-4 h-4" />
                        {INVOICE_STATUS_LABELS.draft}
                    </span>
                );
            case 'sent':
                return (
                    <span className={`${baseClasses} bg-blue-100 text-blue-800`}>
                        <Send className="w-4 h-4" />
                        {INVOICE_STATUS_LABELS.sent}
                    </span>
                );
            case 'paid':
                return (
                    <span className={`${baseClasses} bg-green-100 text-green-800`}>
                        <CheckCircle className="w-4 h-4" />
                        {INVOICE_STATUS_LABELS.paid}
                    </span>
                );
            case 'overdue':
                return (
                    <span className={`${baseClasses} bg-red-100 text-red-800`}>
                        <AlertCircle className="w-4 h-4" />
                        {INVOICE_STATUS_LABELS.overdue}
                    </span>
                );
            default:
                return null;
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <FileText className="w-8 h-8" />
                        Faktura #{invoice.invoiceNumber}
                    </h1>
                    <div className="flex items-center gap-3 mt-2">
                        {getStatusBadge()}
                        {isOverdue && (
                            <span className="text-sm text-red-600 font-medium">
                                {Math.abs(daysLeft)} dagar försenad
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                    {invoice.status === 'draft' && (
                        <>
                            <Link
                                to={`/invoices/${invoice.id}/edit`}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                <Edit2 className="w-4 h-4" />
                                Redigera
                            </Link>
                            <button
                                onClick={handleMarkAsSent}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                <Send className="w-4 h-4" />
                                Markera som skickad
                            </button>
                        </>
                    )}
                    
                    {invoice.status === 'sent' && (
                        <button
                            onClick={handleMarkAsPaid}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                            <CheckCircle className="w-4 h-4" />
                            Markera som betald
                        </button>
                    )}

                    <div className="relative">
                        <button
                            onClick={() => setShowActions(!showActions)}
                            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                            <MoreVertical className="w-5 h-5" />
                        </button>
                        
                        {showActions && (
                            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                                <button className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                    <Download className="w-4 h-4" />
                                    Ladda ner PDF
                                </button>
                                <button className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                    <Printer className="w-4 h-4" />
                                    Skriv ut
                                </button>
                                <button className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                    <Mail className="w-4 h-4" />
                                    Skicka via email
                                </button>
                                {invoice.status === 'draft' && (
                                    <button
                                        onClick={handleDelete}
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-600 border-t border-gray-200 mt-1 pt-2"
                                    >
                                        Radera faktura
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="col-span-2 space-y-6">
                    {/* Invoice Info */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">
                            Fakturainformation
                        </h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-sm text-gray-600 mb-1">Fakturanummer</div>
                                <div className="font-medium text-gray-900">#{invoice.invoiceNumber}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-600 mb-1">OCR-nummer</div>
                                <div className="font-medium text-gray-900">{invoice.ocrNumber}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-600 mb-1">Fakturadatum</div>
                                <div className="font-medium text-gray-900">
                                    {formatDate(invoice.invoiceDate)}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-600 mb-1">Förfallodatum</div>
                                <div className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                                    {formatDate(invoice.dueDate)}
                                </div>
                            </div>
                            {invoice.sentDate && (
                                <div>
                                    <div className="text-sm text-gray-600 mb-1">Skickad</div>
                                    <div className="font-medium text-gray-900">
                                        {formatDate(invoice.sentDate)}
                                    </div>
                                </div>
                            )}
                            {invoice.paidDate && (
                                <div>
                                    <div className="text-sm text-gray-600 mb-1">Betald</div>
                                    <div className="font-medium text-gray-900">
                                        {formatDate(invoice.paidDate)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Customer Info */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">
                            Kundinformation
                        </h2>
                        <div className="space-y-3">
                            <div className="flex items-start gap-3">
                                <Building className="w-5 h-5 text-gray-400 mt-0.5" />
                                <div>
                                    <div className="font-medium text-gray-900">
                                        {invoice.customer?.name}
                                    </div>
                                    {invoice.customer?.organizationNumber && (
                                        <div className="text-sm text-gray-600">
                                            Org.nr: {invoice.customer.organizationNumber}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {invoice.customer?.address && (
                                <div className="flex items-start gap-3">
                                    <div className="w-5"></div>
                                    <div className="text-sm text-gray-600">
                                        <div>{invoice.customer.address}</div>
                                        <div>
                                            {invoice.customer.postalCode} {invoice.customer.city}
                                        </div>
                                        {invoice.customer.country && (
                                            <div>{invoice.customer.country}</div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {invoice.customer?.email && (
                                <div className="flex items-center gap-3">
                                    <Mail className="w-5 h-5 text-gray-400" />
                                    <a 
                                        href={`mailto:${invoice.customer.email}`}
                                        className="text-sm text-blue-600 hover:text-blue-700"
                                    >
                                        {invoice.customer.email}
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Invoice Lines */}
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-900">
                                Fakturarader
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                            Beskrivning
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                                            Antal
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                                            À-pris
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                                            Moms
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                                            Totalt
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {invoice.lines?.map((line) => (
                                        <tr key={line.id}>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-gray-900">
                                                    {line.description}
                                                </div>
                                                {line.article && (
                                                    <div className="text-xs text-gray-500">
                                                        Art.nr: {line.article.articleNumber}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right text-sm text-gray-900">
                                                {line.quantity} {line.unit}
                                            </td>
                                            <td className="px-6 py-4 text-right text-sm text-gray-900">
                                                {formatCurrency(line.unitPrice)}
                                            </td>
                                            <td className="px-6 py-4 text-right text-sm text-gray-900">
                                                {line.vatRate}%
                                            </td>
                                            <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                                                {formatCurrency(line.total)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        <div className="p-6 border-t-2 border-gray-300 bg-gray-50">
                            <div className="flex justify-end">
                                <div className="w-80 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Subtotal:</span>
                                        <span className="font-medium text-gray-900">
                                            {formatCurrency(invoice.subtotal)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Moms:</span>
                                        <span className="font-medium text-gray-900">
                                            {formatCurrency(invoice.vatAmount)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                                        <span className="text-gray-900">Totalt att betala:</span>
                                        <span className="text-blue-600">
                                            {formatCurrency(invoice.totalAmount)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Notes and Terms */}
                    {(invoice.notes || invoice.terms) && (
                        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                            {invoice.notes && (
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-2">
                                        Anteckningar
                                    </h3>
                                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                                        {invoice.notes}
                                    </p>
                                </div>
                            )}
                            {invoice.terms && (
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-2">
                                        Betalningsvillkor
                                    </h3>
                                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                                        {invoice.terms}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Amount Summary */}
                    <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
                        <div className="text-sm text-blue-800 mb-2">Totalt belopp</div>
                        <div className="text-3xl font-bold text-blue-900">
                            {formatCurrency(invoice.totalAmount)}
                        </div>
                        <div className="text-sm text-blue-700 mt-2">
                            inkl. {formatCurrency(invoice.vatAmount)} moms
                        </div>
                    </div>

                    {/* Payment Info */}
                    {invoice.status === 'sent' && (
                        <div className="bg-white rounded-lg border border-gray-200 p-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-3">
                                Betalningsinformation
                            </h3>
                            <div className="space-y-3 text-sm">
                                <div>
                                    <div className="text-gray-600">OCR-nummer</div>
                                    <div className="font-mono font-medium text-gray-900">
                                        {invoice.ocrNumber}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-gray-600">Förfaller</div>
                                    <div className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                                        {formatDate(invoice.dueDate)}
                                    </div>
                                </div>
                                {!isOverdue && daysLeft >= 0 && (
                                    <div className="text-gray-600">
                                        {daysLeft} dagar kvar
                                    </div>
                                )}
                                {isOverdue && (
                                    <div className="text-red-600 font-medium">
                                        ⚠️ Förfallen ({Math.abs(daysLeft)} dagar)
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Timeline */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">
                            Tidslinje
                        </h3>
                        <div className="space-y-3">
                            <div className="flex gap-3">
                                <div className="w-2 h-2 bg-blue-600 rounded-full mt-1.5"></div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">
                                        Faktura skapad
                                    </div>
                                    <div className="text-xs text-gray-600">
                                        {formatDate(invoice.createdAt)}
                                    </div>
                                </div>
                            </div>
                            {invoice.sentDate && (
                                <div className="flex gap-3">
                                    <div className="w-2 h-2 bg-blue-600 rounded-full mt-1.5"></div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-gray-900">
                                            Faktura skickad
                                        </div>
                                        <div className="text-xs text-gray-600">
                                            {formatDate(invoice.sentDate)}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {invoice.paidDate && (
                                <div className="flex gap-3">
                                    <div className="w-2 h-2 bg-green-600 rounded-full mt-1.5"></div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-gray-900">
                                            Faktura betald
                                        </div>
                                        <div className="text-xs text-gray-600">
                                            {formatDate(invoice.paidDate)}
                                        </div>
                                        {invoice.paymentReference && (
                                            <div className="text-xs text-gray-500 mt-1">
                                                Ref: {invoice.paymentReference}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

App Routes Update
Uppdatera: frontend/src/App.tsx - Lägg till routes
typescriptimport InvoiceListPage from './pages/InvoiceListPage';
import InvoiceFormPage from './pages/InvoiceFormPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';

// ... i routes:
<Route path="/invoices" element={<InvoiceListPage />} />
<Route path="/invoices/new" element={<InvoiceFormPage />} />
<Route path="/invoices/:id" element={<InvoiceDetailPage />} />
<Route path="/invoices/:id/edit" element={<InvoiceFormPage />} />



STEG 2.5-2.11: Övriga MVP Moduler
För att hålla dokumentationen hanterbar, här är översikt över återstående moduler:

STEG 2.5: PDF Generation Service
Instruktion:
Implementera professionell PDF-generering för fakturor med företagslogga, OCR-nummer och svensk layout.
Installation:
bashnpm install pdfkit
npm install @aws-sdk/client-s3
Types:
Filsökväg: backend/src/types/pdf.types.ts
typescriptexport interface InvoicePDFData {
  invoice: {
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    ocr_number: string;
    reference?: string;
    notes?: string;
  };
  company: {
    name: string;
    org_number: string;
    address_street?: string;
    address_postal_code?: string;
    address_city?: string;
    phone?: string;
    email?: string;
    website?: string;
    logo_url?: string;
    bank_account?: string;
    vat_number?: string;
  };
  customer: {
    name: string;
    org_number?: string;
    address_street?: string;
    address_postal_code?: string;
    address_city?: string;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unit: string;
    unit_price: number;
    vat_rate: number;
    amount: number;
  }>;
  totals: {
    subtotal: number;
    vat_amount: number;
    total_amount: number;
  };
}
Service:
Filsökväg: backend/src/services/pdfService.ts
typescriptimport PDFDocument from 'pdfkit';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { InvoicePDFData } from '../types/pdf.types';
import fs from 'fs';
import path from 'path';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'redovisning-files';

export const generateInvoicePDF = async (
  data: InvoicePDFData
): Promise<{ url: string; buffer: Buffer }> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      
      try {
        // Upload to S3
        const fileName = `invoices/${data.invoice.invoice_number}.pdf`;
        
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: fileName,
          Body: pdfBuffer,
          ContentType: 'application/pdf'
        }));
        
        const url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
        
        resolve({ url, buffer: pdfBuffer });
      } catch (error) {
        reject(error);
      }
    });
    
    // Header with company info
    doc.fontSize(20).text(data.company.name, 50, 50);
    doc.fontSize(10)
       .text(data.company.address_street || '', 50, 75)
       .text(`${data.company.address_postal_code || ''} ${data.company.address_city || ''}`, 50, 90)
       .text(`Org.nr: ${data.company.org_number}`, 50, 105);
    
    if (data.company.phone) {
      doc.text(`Tel: ${data.company.phone}`, 50, 120);
    }
    if (data.company.email) {
      doc.text(`Email: ${data.company.email}`, 50, 135);
    }
    
    // Invoice title
    doc.fontSize(24).text('FAKTURA', 400, 50);
    
    // Invoice details
    doc.fontSize(10)
       .text(`Fakturanummer: ${data.invoice.invoice_number}`, 400, 85)
       .text(`Fakturadatum: ${data.invoice.invoice_date}`, 400, 100)
       .text(`Förfallodatum: ${data.invoice.due_date}`, 400, 115)
       .text(`OCR-nummer: ${data.invoice.ocr_number}`, 400, 130);
    
    if (data.invoice.reference) {
      doc.text(`Er referens: ${data.invoice.reference}`, 400, 145);
    }
    
    // Customer info
    doc.fontSize(12).text('Kund:', 50, 180);
    doc.fontSize(10)
       .text(data.customer.name, 50, 200)
       .text(data.customer.address_street || '', 50, 215)
       .text(`${data.customer.address_postal_code || ''} ${data.customer.address_city || ''}`, 50, 230);
    
    if (data.customer.org_number) {
      doc.text(`Org.nr: ${data.customer.org_number}`, 50, 245);
    }
    
    // Table header
    const tableTop = 300;
    const descriptionX = 50;
    const quantityX = 300;
    const unitX = 350;
    const priceX = 400;
    const vatX = 460;
    const amountX = 510;
    
    doc.fontSize(10)
       .text('Beskrivning', descriptionX, tableTop)
       .text('Antal', quantityX, tableTop)
       .text('Enhet', unitX, tableTop)
       .text('Pris', priceX, tableTop)
       .text('Moms%', vatX, tableTop)
       .text('Belopp', amountX, tableTop);
    
    doc.moveTo(50, tableTop + 15)
       .lineTo(560, tableTop + 15)
       .stroke();
    
    // Table rows
    let yPosition = tableTop + 25;
    
    data.lines.forEach((line) => {
      doc.fontSize(9)
         .text(line.description, descriptionX, yPosition, { width: 240 })
         .text(line.quantity.toString(), quantityX, yPosition)
         .text(line.unit, unitX, yPosition)
         .text(line.unit_price.toFixed(2), priceX, yPosition)
         .text(line.vat_rate.toFixed(0), vatX, yPosition)
         .text(line.amount.toFixed(2), amountX, yPosition);
      
      yPosition += 30;
      
      // New page if needed
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
    });
    
    // Totals
    yPosition += 20;
    doc.moveTo(50, yPosition)
       .lineTo(560, yPosition)
       .stroke();
    
    yPosition += 15;
    
    doc.fontSize(10)
       .text('Delsumma:', 400, yPosition)
       .text(`${data.totals.subtotal.toFixed(2)} SEK`, 510, yPosition);
    
    yPosition += 20;
    doc.text('Moms:', 400, yPosition)
       .text(`${data.totals.vat_amount.toFixed(2)} SEK`, 510, yPosition);
    
    yPosition += 20;
    doc.fontSize(12)
       .text('ATT BETALA:', 400, yPosition)
       .text(`${data.totals.total_amount.toFixed(2)} SEK`, 510, yPosition);
    
    // Payment info
    yPosition += 40;
    doc.fontSize(10)
       .text('BETALNINGSINFORMATION', 50, yPosition);
    
    yPosition += 20;
    doc.fontSize(9)
       .text(`Bankgiro: ${data.company.bank_account || 'N/A'}`, 50, yPosition)
       .text(`OCR-nummer: ${data.invoice.ocr_number}`, 50, yPosition + 15)
       .text(`Förfallodatum: ${data.invoice.due_date}`, 50, yPosition + 30);
    
    if (data.invoice.notes) {
      yPosition += 60;
      doc.fontSize(9)
         .text('Meddelande:', 50, yPosition)
         .text(data.invoice.notes, 50, yPosition + 15, { width: 500 });
    }
    
    // Footer
    doc.fontSize(8)
       .text(
         `${data.company.name} | ${data.company.org_number} | ${data.company.email}`,
         50,
         750,
         { align: 'center', width: 500 }
       );
    
    doc.end();
  });
};

export const generateInvoicePDFFromInvoiceId = async (
  invoiceId: string,
  companyId: string
): Promise<{ url: string; buffer: Buffer }> => {
  // Import here to avoid circular dependency
  const { getInvoiceById } = await import('./invoiceService');
  const { getCompanyById } = await import('./companyService');
  const { getCustomerById } = await import('./customerService');
  
  const invoice = await getInvoiceById(invoiceId, companyId);
  const company = await getCompanyById(companyId);
  const customer = await getCustomerById(invoice.customer_id, companyId);
  
  if (!company || !customer) {
    throw new Error('Company or customer not found');
  }
  
  const pdfData: InvoicePDFData = {
    invoice: {
      invoice_number: invoice.invoice_number,
      invoice_date: new Date(invoice.invoice_date).toLocaleDateString('sv-SE'),
      due_date: new Date(invoice.due_date).toLocaleDateString('sv-SE'),
      ocr_number: invoice.ocr_number!,
      reference: invoice.reference,
      notes: invoice.notes
    },
    company: {
      name: company.name,
      org_number: company.org_number,
      address_street: company.address_street,
      address_postal_code: company.address_postal_code,
      address_city: company.address_city,
      phone: company.phone,
      email: company.email,
      website: company.website,
      bank_account: company.bank_account,
      vat_number: company.vat_number
    },
    customer: {
      name: customer.name,
      org_number: customer.org_number,
      address_street: customer.address_street,
      address_postal_code: customer.address_postal_code,
      address_city: customer.address_city
    },
    lines: invoice.lines.map((line: any) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      vat_rate: line.vat_rate,
      amount: line.amount
    })),
    totals: {
      subtotal: invoice.subtotal,
      vat_amount: invoice.vat_amount,
      total_amount: invoice.total_amount
    }
  };
  
  return await generateInvoicePDF(pdfData);
};
Controller Update:
Filsökväg: backend/src/controllers/invoiceController.ts (lägg till)
typescriptimport { generateInvoicePDFFromInvoiceId } from '../services/pdfService';

export const generatePDF = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const { url, buffer } = await generateInvoicePDFFromInvoiceId(
      id,
      company_id as string
    );
    
    // Update invoice with PDF URL
    await query(
      'UPDATE invoices SET pdf_url = $1 WHERE id = $2',
      [url, id]
    );
    
    res.json({ url });
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const downloadPDF = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    const { buffer } = await generateInvoicePDFFromInvoiceId(
      id,
      company_id as string
    );
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${id}.pdf`);
    res.send(buffer);
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
Routes Update:
Filsökväg: backend/src/routes/invoices.ts (lägg till)
typescriptrouter.post('/:id/generate-pdf', invoiceController.generatePDF);
router.get('/:id/download-pdf', invoiceController.downloadPDF);

STEG 2.6: Email Service
Instruktion:
Implementera email-tjänst för att skicka fakturor och andra notifikationer.
Installation:
bashnpm install nodemailer
npm install @types/nodemailer --save-dev
Service:
Filsökväg: backend/src/services/emailService.ts
typescriptimport nodemailer from 'nodemailer';
import { generateInvoicePDFFromInvoiceId } from './pdfService';

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export const sendInvoiceEmail = async (
  invoiceId: string,
  companyId: string,
  recipientEmail: string,
  recipientName: string
): Promise<void> => {
  // Import services
  const { getInvoiceById } = await import('./invoiceService');
  const { getCompanyById } = await import('./companyService');
  
  const invoice = await getInvoiceById(invoiceId, companyId);
  const company = await getCompanyById(companyId);
  
  if (!company) {
    throw new Error('Company not found');
  }
  
  // Generate PDF
  const { buffer } = await generateInvoicePDFFromInvoiceId(invoiceId, companyId);
  
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@yourcompany.com',
    to: recipientEmail,
    subject: `Faktura ${invoice.invoice_number} från ${company.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Faktura från ${company.name}</h2>
        <p>Hej ${recipientName},</p>
        <p>Bifogat finner du faktura ${invoice.invoice_number}.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Fakturanummer:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${invoice.invoice_number}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Fakturadatum:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${new Date(invoice.invoice_date).toLocaleDateString('sv-SE')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Förfallodatum:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${new Date(invoice.due_date).toLocaleDateString('sv-SE')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Att betala:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>${invoice.total_amount.toFixed(2)} SEK</strong></td>
          </tr>
        </table>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Betalningsinformation</h3>
          <p><strong>Bankgiro:</strong> ${company.bank_account || 'N/A'}</p>
          <p><strong>OCR-nummer:</strong> ${invoice.ocr_number}</p>
          <p style="margin-bottom: 0;"><strong>Förfallodatum:</strong> ${new Date(invoice.due_date).toLocaleDateString('sv-SE')}</p>
        </div>
        
        <p>Vid frågor, kontakta oss på ${company.email || company.phone}</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          Med vänliga hälsningar,<br>
          ${company.name}
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `faktura-${invoice.invoice_number}.pdf`,
        content: buffer,
        contentType: 'application/pdf'
      }
    ]
  };
  
  await transporter.sendMail(mailOptions);
};

export const sendWelcomeEmail = async (
  userEmail: string,
  userName: string
): Promise<void> => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@yourcompany.com',
    to: userEmail,
    subject: 'Välkommen till Redovisningssystemet',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Välkommen ${userName}!</h2>
        <p>Tack för att du registrerade dig.</p>
        <p>Du kan nu börja använda systemet för att hantera din redovisning.</p>
        <p>
          <a href="${process.env.FRONTEND_URL}/login" 
             style="background: #007bff; color: white; padding: 10px 20px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;">
            Logga in
          </a>
        </p>
      </div>
    `
  };
  
  await transporter.sendMail(mailOptions);
};

export const sendPasswordResetEmail = async (
  userEmail: string,
  resetToken: string
): Promise<void> => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@yourcompany.com',
    to: userEmail,
    subject: 'Återställ ditt lösenord',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Återställ ditt lösenord</h2>
        <p>Du har begärt att återställa ditt lösenord.</p>
        <p>Klicka på länken nedan för att skapa ett nytt lösenord:</p>
        <p>
          <a href="${resetUrl}" 
             style="background: #007bff; color: white; padding: 10px 20px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;">
            Återställ lösenord
          </a>
        </p>
        <p style="color: #666; font-size: 12px;">
          Om du inte begärt detta, ignorera detta email.
          Länken är giltig i 1 timme.
        </p>
      </div>
    `
  };
  
  await transporter.sendMail(mailOptions);
};
Controller:
Filsökväg: backend/src/controllers/invoiceController.ts (lägg till)
typescriptimport { sendInvoiceEmail } from '../services/emailService';

export const sendInvoice = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, recipient_email, recipient_name } = req.body;
    
    if (!company_id || !recipient_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    await sendInvoiceEmail(
      id,
      company_id,
      recipient_email,
      recipient_name || 'Kund'
    );
    
    // Mark invoice as sent
    const { markInvoiceAsSent } = await import('../services/invoiceService');
    await markInvoiceAsSent(id, company_id);
    
    res.json({ message: 'Invoice sent successfully' });
  } catch (error) {
    console.error('Send invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
Routes:
typescriptrouter.post('/:id/send', invoiceController.sendInvoice);

STEG 2.7: Receipt Management
Instruktion:
Implementera komplett kvittohanteringssystem med AI OCR-integration, uppladdning, granskning, godkännande och statistik. Detta inkluderar både backend API och frontend UI.

BACKEND IMPLEMENTATION
1. Backend Types:
Filsökväg: backend/src/types/receipt.types.ts
typescript/**
 * Receipt Management Types
 * Backend TypeScript definitions for receipt handling
 */

export interface Receipt {
  id: string;
  userId: string;
  companyId: string;
  
  // Basic information
  receiptNumber: string;
  date: Date;
  supplier: string;
  supplierOrgNumber?: string;
  
  // Financial details
  totalAmount: number;
  vatAmount: number;
  netAmount: number;
  currency: string;
  
  // Categorization
  category: ReceiptCategory;
  accountingAccount?: string;
  projectId?: string;
  costCenter?: string;
  
  // OCR and processing
  ocrStatus: OCRStatus;
  ocrData?: OCRData;
  ocrConfidence?: number;
  ocrJobId?: string;
  
  // File management
  fileUrl: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  thumbnailUrl?: string;
  storageKey: string;
  
  // Status and workflow
  status: ReceiptStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedReason?: string;
  
  // Notes and metadata
  description?: string;
  notes?: string;
  tags?: string[];
  
  // Audit trail
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string;
}

export enum ReceiptCategory {
  OFFICE_SUPPLIES = 'office_supplies',
  TRAVEL = 'travel',
  MEALS = 'meals',
  EQUIPMENT = 'equipment',
  SOFTWARE = 'software',
  MARKETING = 'marketing',
  UTILITIES = 'utilities',
  RENT = 'rent',
  INSURANCE = 'insurance',
  CONSULTING = 'consulting',
  OTHER = 'other'
}

export enum ReceiptStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ARCHIVED = 'archived'
}

export enum OCRStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  MANUAL = 'manual'
}

export interface OCRData {
  supplier?: string;
  supplierOrgNumber?: string;
  date?: string;
  totalAmount?: number;
  vatAmount?: number;
  netAmount?: number;
  currency?: string;
  receiptNumber?: string;
  lineItems?: OCRLineItem[];
  rawText?: string;
}

export interface OCRLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice: number;
  vatRate?: number;
}

export interface CreateReceiptDto {
  file: Express.Multer.File;
  date?: Date;
  supplier?: string;
  category?: ReceiptCategory;
  description?: string;
  projectId?: string;
  costCenter?: string;
}

export interface UpdateReceiptDto {
  date?: Date;
  supplier?: string;
  supplierOrgNumber?: string;
  totalAmount?: number;
  vatAmount?: number;
  netAmount?: number;
  category?: ReceiptCategory;
  accountingAccount?: string;
  projectId?: string;
  costCenter?: string;
  description?: string;
  notes?: string;
  tags?: string[];
}

export interface ReceiptFilters {
  status?: ReceiptStatus[];
  category?: ReceiptCategory[];
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  supplier?: string;
  projectId?: string;
  costCenter?: string;
  search?: string;
}

export interface ReceiptStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  totalAmount: number;
  averageAmount: number;
  byCategory: Record<ReceiptCategory, number>;
  byMonth: Array<{
    month: string;
    count: number;
    amount: number;
  }>;
}

2. Backend Service:
Filsökväg: backend/src/services/receiptService.ts
typescript/**
 * Receipt Service
 * Business logic for receipt management
 */

import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import {
  Receipt,
  CreateReceiptDto,
  UpdateReceiptDto,
  ReceiptFilters,
  ReceiptStats,
  ReceiptStatus,
  OCRStatus,
  ReceiptCategory
} from '../types/receipt.types';
import { AIService } from './aiService';

export class ReceiptService {
  private db: Pool;
  private mongo: MongoClient;
  private s3: S3Client;
  private aiService: AIService;

  constructor(db: Pool, mongo: MongoClient) {
    this.db = db;
    this.mongo = mongo;
    this.s3 = new S3Client({
      region: process.env.AWS_REGION || 'eu-north-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }
    });
    this.aiService = new AIService();
  }

  /**
   * Upload a receipt file and process with OCR
   */
  async uploadReceipt(
    userId: string,
    companyId: string,
    file: Express.Multer.File,
    data?: Partial<CreateReceiptDto>
  ): Promise<Receipt> {
    // Generate unique identifiers
    const receiptId = uuidv4();
    const storageKey = `receipts/${companyId}/${receiptId}/${file.originalname}`;
    const thumbnailKey = `receipts/${companyId}/${receiptId}/thumbnail.jpg`;

    try {
      // Upload original file to S3
      await this.s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype
      }));

      // Generate thumbnail for images
      let thumbnailUrl: string | undefined;
      if (file.mimetype.startsWith('image/')) {
        const thumbnail = await sharp(file.buffer)
          .resize(400, 400, { fit: 'inside' })
          .jpeg({ quality: 80 })
          .toBuffer();

        await this.s3.send(new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: thumbnailKey,
          Body: thumbnail,
          ContentType: 'image/jpeg'
        }));

        thumbnailUrl = await getSignedUrl(
          this.s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: thumbnailKey
          }),
          { expiresIn: 3600 * 24 * 7 } // 7 days
        );
      }

      // Get signed URL for file access
      const fileUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: storageKey
        }),
        { expiresIn: 3600 * 24 * 7 } // 7 days
      );

      // Generate receipt number
      const receiptNumber = await this.generateReceiptNumber(companyId);

      // Create receipt in database
      const result = await this.db.query(
        `INSERT INTO receipts (
          id, user_id, company_id, receipt_number, date, supplier,
          total_amount, vat_amount, net_amount, currency, category,
          ocr_status, file_url, file_name, file_size, file_type,
          thumbnail_url, storage_key, status, description,
          project_id, cost_center, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        RETURNING *`,
        [
          receiptId,
          userId,
          companyId,
          receiptNumber,
          data?.date || new Date(),
          data?.supplier || null,
          0, // Will be updated by OCR
          0,
          0,
          'SEK',
          data?.category || null,
          OCRStatus.PENDING,
          fileUrl,
          file.originalname,
          file.size,
          file.mimetype,
          thumbnailUrl,
          storageKey,
          ReceiptStatus.PENDING,
          data?.description || null,
          data?.projectId || null,
          data?.costCenter || null,
          userId
        ]
      );

      const receipt = this.mapDbToReceipt(result.rows[0]);

      // Start OCR processing asynchronously
      this.processOCR(receiptId, file.buffer, file.mimetype).catch(err => {
        console.error('OCR processing failed:', err);
      });

      return receipt;
    } catch (error) {
      console.error('Upload receipt failed:', error);
      throw new Error('Failed to upload receipt');
    }
  }

  /**
   * Process OCR for receipt
   */
  private async processOCR(
    receiptId: string,
    fileBuffer: Buffer,
    mimeType: string
  ): Promise<void> {
    try {
      // Update status to processing
      await this.db.query(
        'UPDATE receipts SET ocr_status = $1 WHERE id = $2',
        [OCRStatus.PROCESSING, receiptId]
      );

      // Call AI service for OCR
      const ocrResult = await this.aiService.processReceiptOCR(fileBuffer, mimeType);

      // Store OCR data in MongoDB for flexibility
      const mongoDb = this.mongo.db('redovisning');
      await mongoDb.collection('receipt_ocr_data').insertOne({
        receiptId,
        ocrData: ocrResult.data,
        confidence: ocrResult.confidence,
        processedAt: new Date()
      });

      // Update receipt with OCR results
      await this.db.query(
        `UPDATE receipts SET
          ocr_status = $1,
          ocr_confidence = $2,
          supplier = COALESCE(supplier, $3),
          supplier_org_number = $4,
          total_amount = $5,
          vat_amount = $6,
          net_amount = $7,
          date = COALESCE(date, $8)
        WHERE id = $9`,
        [
          OCRStatus.COMPLETED,
          ocrResult.confidence,
          ocrResult.data.supplier,
          ocrResult.data.supplierOrgNumber,
          ocrResult.data.totalAmount || 0,
          ocrResult.data.vatAmount || 0,
          ocrResult.data.netAmount || 0,
          ocrResult.data.date ? new Date(ocrResult.data.date) : null,
          receiptId
        ]
      );
    } catch (error) {
      console.error('OCR processing failed:', error);
      await this.db.query(
        'UPDATE receipts SET ocr_status = $1 WHERE id = $2',
        [OCRStatus.FAILED, receiptId]
      );
    }
  }

  /**
   * Get receipts with filters and pagination
   */
  async getReceipts(
    companyId: string,
    page: number = 1,
    pageSize: number = 20,
    filters?: ReceiptFilters
  ): Promise<{ receipts: Receipt[]; total: number; totalPages: number }> {
    let whereConditions = ['company_id = $1'];
    let params: any[] = [companyId];
    let paramCount = 1;

    // Build WHERE clause from filters
    if (filters?.status && filters.status.length > 0) {
      paramCount++;
      whereConditions.push(`status = ANY($${paramCount})`);
      params.push(filters.status);
    }

    if (filters?.category && filters.category.length > 0) {
      paramCount++;
      whereConditions.push(`category = ANY($${paramCount})`);
      params.push(filters.category);
    }

    if (filters?.dateFrom) {
      paramCount++;
      whereConditions.push(`date >= $${paramCount}`);
      params.push(filters.dateFrom);
    }

    if (filters?.dateTo) {
      paramCount++;
      whereConditions.push(`date <= $${paramCount}`);
      params.push(filters.dateTo);
    }

    if (filters?.minAmount !== undefined) {
      paramCount++;
      whereConditions.push(`total_amount >= $${paramCount}`);
      params.push(filters.minAmount);
    }

    if (filters?.maxAmount !== undefined) {
      paramCount++;
      whereConditions.push(`total_amount <= $${paramCount}`);
      params.push(filters.maxAmount);
    }

    if (filters?.supplier) {
      paramCount++;
      whereConditions.push(`supplier ILIKE $${paramCount}`);
      params.push(`%${filters.supplier}%`);
    }

    if (filters?.projectId) {
      paramCount++;
      whereConditions.push(`project_id = $${paramCount}`);
      params.push(filters.projectId);
    }

    if (filters?.costCenter) {
      paramCount++;
      whereConditions.push(`cost_center = $${paramCount}`);
      params.push(filters.costCenter);
    }

    if (filters?.search) {
      paramCount++;
      whereConditions.push(`(
        supplier ILIKE $${paramCount} OR
        description ILIKE $${paramCount} OR
        notes ILIKE $${paramCount} OR
        receipt_number ILIKE $${paramCount}
      )`);
      params.push(`%${filters.search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) FROM receipts WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);
    
    const result = await this.db.query(
      `SELECT * FROM receipts 
       WHERE ${whereClause}
       ORDER BY date DESC, created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      params
    );

    const receipts = result.rows.map(row => this.mapDbToReceipt(row));

    // Fetch OCR data from MongoDB for each receipt
    const mongoDb = this.mongo.db('redovisning');
    for (const receipt of receipts) {
      const ocrDoc = await mongoDb.collection('receipt_ocr_data').findOne({
        receiptId: receipt.id
      });
      if (ocrDoc) {
        receipt.ocrData = ocrDoc.ocrData;
      }
    }

    return {
      receipts,
      total,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  /**
   * Get receipt by ID
   */
  async getReceiptById(receiptId: string, companyId: string): Promise<Receipt | null> {
    const result = await this.db.query(
      'SELECT * FROM receipts WHERE id = $1 AND company_id = $2',
      [receiptId, companyId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const receipt = this.mapDbToReceipt(result.rows[0]);

    // Fetch OCR data from MongoDB
    const mongoDb = this.mongo.db('redovisning');
    const ocrDoc = await mongoDb.collection('receipt_ocr_data').findOne({
      receiptId: receipt.id
    });
    if (ocrDoc) {
      receipt.ocrData = ocrDoc.ocrData;
    }

    return receipt;
  }

  /**
   * Update receipt
   */
  async updateReceipt(
    receiptId: string,
    companyId: string,
    userId: string,
    data: UpdateReceiptDto
  ): Promise<Receipt> {
    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 0;

    if (data.date !== undefined) {
      paramCount++;
      updates.push(`date = $${paramCount}`);
      params.push(data.date);
    }

    if (data.supplier !== undefined) {
      paramCount++;
      updates.push(`supplier = $${paramCount}`);
      params.push(data.supplier);
    }

    if (data.supplierOrgNumber !== undefined) {
      paramCount++;
      updates.push(`supplier_org_number = $${paramCount}`);
      params.push(data.supplierOrgNumber);
    }

    if (data.totalAmount !== undefined) {
      paramCount++;
      updates.push(`total_amount = $${paramCount}`);
      params.push(data.totalAmount);
    }

    if (data.vatAmount !== undefined) {
      paramCount++;
      updates.push(`vat_amount = $${paramCount}`);
      params.push(data.vatAmount);
    }

    if (data.netAmount !== undefined) {
      paramCount++;
      updates.push(`net_amount = $${paramCount}`);
      params.push(data.netAmount);
    }

    if (data.category !== undefined) {
      paramCount++;
      updates.push(`category = $${paramCount}`);
      params.push(data.category);
    }

    if (data.accountingAccount !== undefined) {
      paramCount++;
      updates.push(`accounting_account = $${paramCount}`);
      params.push(data.accountingAccount);
    }

    if (data.projectId !== undefined) {
      paramCount++;
      updates.push(`project_id = $${paramCount}`);
      params.push(data.projectId);
    }

    if (data.costCenter !== undefined) {
      paramCount++;
      updates.push(`cost_center = $${paramCount}`);
      params.push(data.costCenter);
    }

    if (data.description !== undefined) {
      paramCount++;
      updates.push(`description = $${paramCount}`);
      params.push(data.description);
    }

    if (data.notes !== undefined) {
      paramCount++;
      updates.push(`notes = $${paramCount}`);
      params.push(data.notes);
    }

    if (data.tags !== undefined) {
      paramCount++;
      updates.push(`tags = $${paramCount}`);
      params.push(data.tags);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    paramCount++;
    updates.push(`updated_by = $${paramCount}`);
    params.push(userId);

    paramCount++;
    updates.push(`updated_at = $${paramCount}`);
    params.push(new Date());

    params.push(receiptId, companyId);

    const result = await this.db.query(
      `UPDATE receipts SET ${updates.join(', ')}
       WHERE id = $${paramCount + 1} AND company_id = $${paramCount + 2}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      throw new Error('Receipt not found');
    }

    return this.mapDbToReceipt(result.rows[0]);
  }

  /**
   * Delete receipt
   */
  async deleteReceipt(receiptId: string, companyId: string): Promise<void> {
    // Get receipt to get storage key
    const receipt = await this.getReceiptById(receiptId, companyId);
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    // Delete from S3
    try {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: receipt.storageKey
      }));

      if (receipt.thumbnailUrl) {
        const thumbnailKey = receipt.storageKey.replace(/[^/]+$/, 'thumbnail.jpg');
        await this.s3.send(new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: thumbnailKey
        }));
      }
    } catch (error) {
      console.error('Failed to delete from S3:', error);
    }

    // Delete OCR data from MongoDB
    const mongoDb = this.mongo.db('redovisning');
    await mongoDb.collection('receipt_ocr_data').deleteOne({ receiptId });

    // Delete from database
    await this.db.query(
      'DELETE FROM receipts WHERE id = $1 AND company_id = $2',
      [receiptId, companyId]
    );
  }

  /**
   * Approve receipt
   */
  async approveReceipt(
    receiptId: string,
    companyId: string,
    userId: string,
    notes?: string
  ): Promise<Receipt> {
    const result = await this.db.query(
      `UPDATE receipts SET
        status = $1,
        approved_by = $2,
        approved_at = $3,
        notes = COALESCE($4, notes),
        updated_by = $2,
        updated_at = $3
       WHERE id = $5 AND company_id = $6
       RETURNING *`,
      [ReceiptStatus.APPROVED, userId, new Date(), notes, receiptId, companyId]
    );

    if (result.rows.length === 0) {
      throw new Error('Receipt not found');
    }

    return this.mapDbToReceipt(result.rows[0]);
  }

  /**
   * Reject receipt
   */
  async rejectReceipt(
    receiptId: string,
    companyId: string,
    userId: string,
    reason: string
  ): Promise<Receipt> {
    const result = await this.db.query(
      `UPDATE receipts SET
        status = $1,
        rejected_reason = $2,
        updated_by = $3,
        updated_at = $4
       WHERE id = $5 AND company_id = $6
       RETURNING *`,
      [ReceiptStatus.REJECTED, reason, userId, new Date(), receiptId, companyId]
    );

    if (result.rows.length === 0) {
      throw new Error('Receipt not found');
    }

    return this.mapDbToReceipt(result.rows[0]);
  }

  /**
   * Bulk actions
   */
  async bulkAction(
    receiptIds: string[],
    companyId: string,
    userId: string,
    action: 'approve' | 'reject' | 'archive' | 'delete',
    reason?: string
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const receiptId of receiptIds) {
      try {
        switch (action) {
          case 'approve':
            await this.approveReceipt(receiptId, companyId, userId);
            break;
          case 'reject':
            await this.rejectReceipt(receiptId, companyId, userId, reason || 'Bulk rejection');
            break;
          case 'archive':
            await this.db.query(
              'UPDATE receipts SET status = $1 WHERE id = $2 AND company_id = $3',
              [ReceiptStatus.ARCHIVED, receiptId, companyId]
            );
            break;
          case 'delete':
            await this.deleteReceipt(receiptId, companyId);
            break;
        }
        success++;
      } catch (error) {
        console.error(`Bulk action failed for receipt ${receiptId}:`, error);
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * Retry OCR processing
   */
  async retryOCR(receiptId: string, companyId: string): Promise<Receipt> {
    const receipt = await this.getReceiptById(receiptId, companyId);
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    // Get file from S3
    const fileData = await this.s3.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: receipt.storageKey
    }));

    const fileBuffer = await this.streamToBuffer(fileData.Body);

    // Process OCR
    await this.processOCR(receiptId, fileBuffer, receipt.fileType);

    return this.getReceiptById(receiptId, companyId) as Promise<Receipt>;
  }

  /**
   * Get receipt statistics
   */
  async getStats(companyId: string, filters?: ReceiptFilters): Promise<ReceiptStats> {
    let whereConditions = ['company_id = $1'];
    let params: any[] = [companyId];
    let paramCount = 1;

    // Apply filters
    if (filters?.dateFrom) {
      paramCount++;
      whereConditions.push(`date >= $${paramCount}`);
      params.push(filters.dateFrom);
    }

    if (filters?.dateTo) {
      paramCount++;
      whereConditions.push(`date <= $${paramCount}`);
      params.push(filters.dateTo);
    }

    if (filters?.category && filters.category.length > 0) {
      paramCount++;
      whereConditions.push(`category = ANY($${paramCount})`);
      params.push(filters.category);
    }

    if (filters?.projectId) {
      paramCount++;
      whereConditions.push(`project_id = $${paramCount}`);
      params.push(filters.projectId);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get basic stats
    const statsResult = await this.db.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COALESCE(SUM(total_amount), 0) as total_amount,
        COALESCE(AVG(total_amount), 0) as average_amount
       FROM receipts
       WHERE ${whereClause}`,
      params
    );

    // Get by category
    const categoryResult = await this.db.query(
      `SELECT category, COUNT(*) as count
       FROM receipts
       WHERE ${whereClause} AND category IS NOT NULL
       GROUP BY category`,
      params
    );

    const byCategory: Record<ReceiptCategory, number> = {} as any;
    categoryResult.rows.forEach(row => {
      byCategory[row.category as ReceiptCategory] = parseInt(row.count);
    });

    // Get by month
    const monthResult = await this.db.query(
      `SELECT 
        TO_CHAR(date, 'YYYY-MM') as month,
        COUNT(*) as count,
        SUM(total_amount) as amount
       FROM receipts
       WHERE ${whereClause}
       GROUP BY TO_CHAR(date, 'YYYY-MM')
       ORDER BY month DESC
       LIMIT 12`,
      params
    );

    const byMonth = monthResult.rows.map(row => ({
      month: row.month,
      count: parseInt(row.count),
      amount: parseFloat(row.amount)
    }));

    const stats = statsResult.rows[0];

    return {
      total: parseInt(stats.total),
      pending: parseInt(stats.pending),
      approved: parseInt(stats.approved),
      rejected: parseInt(stats.rejected),
      totalAmount: parseFloat(stats.total_amount),
      averageAmount: parseFloat(stats.average_amount),
      byCategory,
      byMonth
    };
  }

  /**
   * Generate unique receipt number
   */
  private async generateReceiptNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const result = await this.db.query(
      `SELECT COUNT(*) as count FROM receipts 
       WHERE company_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [companyId, year]
    );
    
    const count = parseInt(result.rows[0].count) + 1;
    return `R${year}-${count.toString().padStart(5, '0')}`;
  }

  /**
   * Map database row to Receipt object
   */
  private mapDbToReceipt(row: any): Receipt {
    return {
      id: row.id,
      userId: row.user_id,
      companyId: row.company_id,
      receiptNumber: row.receipt_number,
      date: row.date,
      supplier: row.supplier,
      supplierOrgNumber: row.supplier_org_number,
      totalAmount: parseFloat(row.total_amount),
      vatAmount: parseFloat(row.vat_amount),
      netAmount: parseFloat(row.net_amount),
      currency: row.currency,
      category: row.category,
      accountingAccount: row.accounting_account,
      projectId: row.project_id,
      costCenter: row.cost_center,
      ocrStatus: row.ocr_status,
      ocrConfidence: row.ocr_confidence,
      ocrJobId: row.ocr_job_id,
      fileUrl: row.file_url,
      fileName: row.file_name,
      fileSize: row.file_size,
      fileType: row.file_type,
      thumbnailUrl: row.thumbnail_url,
      storageKey: row.storage_key,
      status: row.status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      rejectedReason: row.rejected_reason,
      description: row.description,
      notes: row.notes,
      tags: row.tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by
    };
  }

  /**
   * Convert stream to buffer
   */
  private async streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

3. Backend Controller:
Filsökväg: backend/src/controllers/receiptController.ts
typescript/**
 * Receipt Controller
 * HTTP request handlers for receipt endpoints
 */

import { Request, Response } from 'express';
import { ReceiptService } from '../services/receiptService';
import { CreateReceiptDto, UpdateReceiptDto, ReceiptFilters } from '../types/receipt.types';

export class ReceiptController {
  private receiptService: ReceiptService;

  constructor(receiptService: ReceiptService) {
    this.receiptService = receiptService;
  }

  /**
   * Upload single receipt
   */
  uploadReceipt = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const data: Partial<CreateReceiptDto> = {
        date: req.body.date ? new Date(req.body.date) : undefined,
        supplier: req.body.supplier,
        category: req.body.category,
        description: req.body.description,
        projectId: req.body.projectId,
        costCenter: req.body.costCenter
      };

      const receipt = await this.receiptService.uploadReceipt(
        userId,
        companyId,
        file,
        data
      );

      res.status(201).json({
        receipt,
        message: 'Receipt uploaded successfully. OCR processing started.'
      });
    } catch (error) {
      console.error('Upload receipt error:', error);
      res.status(500).json({ error: 'Failed to upload receipt' });
    }
  };

  /**
   * Upload multiple receipts
   */
  uploadMultipleReceipts = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const results = await Promise.allSettled(
        files.map(file => this.receiptService.uploadReceipt(userId, companyId, file))
      );

      const receipts = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<any>).value);

      const failed = results.filter(r => r.status === 'rejected').length;

      res.status(201).json({
        receipts,
        success: receipts.length,
        failed,
        message: `Uploaded ${receipts.length} receipts successfully. ${failed} failed.`
      });
    } catch (error) {
      console.error('Upload multiple receipts error:', error);
      res.status(500).json({ error: 'Failed to upload receipts' });
    }
  };

  /**
   * Get receipts with filters
   */
  getReceipts = async (req: Request, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;

      const filters: ReceiptFilters = {
        status: req.query.status ? (req.query.status as string).split(',') as any : undefined,
        category: req.query.category ? (req.query.category as string).split(',') as any : undefined,
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
        minAmount: req.query.minAmount ? parseFloat(req.query.minAmount as string) : undefined,
        maxAmount: req.query.maxAmount ? parseFloat(req.query.maxAmount as string) : undefined,
        supplier: req.query.supplier as string,
        projectId: req.query.projectId as string,
        costCenter: req.query.costCenter as string,
        search: req.query.search as string
      };

      const result = await this.receiptService.getReceipts(companyId, page, pageSize, filters);

      res.json({
        receipts: result.receipts,
        total: result.total,
        page,
        pageSize,
        totalPages: result.totalPages
      });
    } catch (error) {
      console.error('Get receipts error:', error);
      res.status(500).json({ error: 'Failed to get receipts' });
    }
  };

  /**
   * Get receipt by ID
   */
  getReceiptById = async (req: Request, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;

      const receipt = await this.receiptService.getReceiptById(receiptId, companyId);

      if (!receipt) {
        return res.status(404).json({ error: 'Receipt not found' });
      }

      res.json(receipt);
    } catch (error) {
      console.error('Get receipt error:', error);
      res.status(500).json({ error: 'Failed to get receipt' });
    }
  };

  /**
   * Update receipt
   */
  updateReceipt = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;
      const data: UpdateReceiptDto = req.body;

      const receipt = await this.receiptService.updateReceipt(
        receiptId,
        companyId,
        userId,
        data
      );

      res.json(receipt);
    } catch (error) {
      console.error('Update receipt error:', error);
      res.status(500).json({ error: 'Failed to update receipt' });
    }
  };

  /**
   * Delete receipt
   */
  deleteReceipt = async (req: Request, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;

      await this.receiptService.deleteReceipt(receiptId, companyId);

      res.json({ message: 'Receipt deleted successfully' });
    } catch (error) {
      console.error('Delete receipt error:', error);
      res.status(500).json({ error: 'Failed to delete receipt' });
    }
  };

  /**
   * Approve receipt
   */
  approveReceipt = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;
      const { notes } = req.body;

      const receipt = await this.receiptService.approveReceipt(
        receiptId,
        companyId,
        userId,
        notes
      );

      res.json(receipt);
    } catch (error) {
      console.error('Approve receipt error:', error);
      res.status(500).json({ error: 'Failed to approve receipt' });
    }
  };

  /**
   * Reject receipt
   */
  rejectReceipt = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'Reason is required' });
      }

      const receipt = await this.receiptService.rejectReceipt(
        receiptId,
        companyId,
        userId,
        reason
      );

      res.json(receipt);
    } catch (error) {
      console.error('Reject receipt error:', error);
      res.status(500).json({ error: 'Failed to reject receipt' });
    }
  };

  /**
   * Bulk actions
   */
  bulkAction = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const { receiptIds, action, reason } = req.body;

      if (!receiptIds || !Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: 'Receipt IDs are required' });
      }

      if (!['approve', 'reject', 'archive', 'delete'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
      }

      const result = await this.receiptService.bulkAction(
        receiptIds,
        companyId,
        userId,
        action,
        reason
      );

      res.json(result);
    } catch (error) {
      console.error('Bulk action error:', error);
      res.status(500).json({ error: 'Failed to perform bulk action' });
    }
  };

  /**
   * Retry OCR
   */
  retryOCR = async (req: Request, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;

      const receipt = await this.receiptService.retryOCR(receiptId, companyId);

      res.json(receipt);
    } catch (error) {
      console.error('Retry OCR error:', error);
      res.status(500).json({ error: 'Failed to retry OCR' });
    }
  };

  /**
   * Get statistics
   */
  getStats = async (req: Request, res: Response) => {
    try {
      const companyId = req.user!.companyId;

      const filters: ReceiptFilters = {
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
        category: req.query.category ? (req.query.category as string).split(',') as any : undefined,
        projectId: req.query.projectId as string
      };

      const stats = await this.receiptService.getStats(companyId, filters);

      res.json(stats);
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ error: 'Failed to get statistics' });
    }
  };

  /**
   * Download receipt file
   */
  downloadReceipt = async (req: Request, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      const receiptId = req.params.id;

      const receipt = await this.receiptService.getReceiptById(receiptId, companyId);

      if (!receipt) {
        return res.status(404).json({ error: 'Receipt not found' });
      }

      // Redirect to signed URL
      res.redirect(receipt.fileUrl);
    } catch (error) {
      console.error('Download receipt error:', error);
      res.status(500).json({ error: 'Failed to download receipt' });
    }
  };
}

4. Backend Routes:
Filsökväg: backend/src/routes/receipts.ts
typescript/**
 * Receipt Routes
 * API endpoints for receipt management
 */

import { Router } from 'express';
import multer from 'multer';
import { ReceiptController } from '../controllers/receiptController';
import { authenticate } from '../middleware/auth';
import { ReceiptService } from '../services/receiptService';
import pool from '../config/database';
import { MongoClient } from 'mongodb';

const router = Router();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG and PDF are allowed.'));
    }
  }
});

// Initialize services and controllers
const mongoClient = new MongoClient(process.env.MONGO_URL!);
const receiptService = new ReceiptService(pool, mongoClient);
const receiptController = new ReceiptController(receiptService);

// All routes require authentication
router.use(authenticate);

// Upload routes
router.post('/upload', upload.single('file'), receiptController.uploadReceipt);
router.post('/upload/bulk', upload.array('files', 10), receiptController.uploadMultipleReceipts);

// CRUD routes
router.get('/', receiptController.getReceipts);
router.get('/stats', receiptController.getStats);
router.get('/:id', receiptController.getReceiptById);
router.put('/:id', receiptController.updateReceipt);
router.delete('/:id', receiptController.deleteReceipt);

// Workflow routes
router.post('/:id/approve', receiptController.approveReceipt);
router.post('/:id/reject', receiptController.rejectReceipt);
router.post('/bulk', receiptController.bulkAction);

// OCR routes
router.post('/:id/ocr/retry', receiptController.retryOCR);

// Download route
router.get('/:id/download', receiptController.downloadReceipt);

export default router;

FRONTEND IMPLEMENTATION
5. Frontend Types:
Filsökväg: frontend/src/types/receipt.types.ts
typescript/**
 * Receipt Management Types
 * Frontend TypeScript definitions for receipt handling
 */

export interface Receipt {
  id: string;
  userId: string;
  companyId: string;
  
  // Basic information
  receiptNumber: string;
  date: Date;
  supplier: string;
  supplierOrgNumber?: string;
  
  // Financial details
  totalAmount: number;
  vatAmount: number;
  netAmount: number;
  currency: string;
  
  // Categorization
  category: ReceiptCategory;
  accountingAccount?: string;
  projectId?: string;
  costCenter?: string;
  
  // OCR and processing
  ocrStatus: OCRStatus;
  ocrData?: OCRData;
  ocrConfidence?: number;
  
  // File management
  fileUrl: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  thumbnailUrl?: string;
  
  // Status and workflow
  status: ReceiptStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedReason?: string;
  
  // Notes and metadata
  description?: string;
  notes?: string;
  tags?: string[];
  
  // Audit trail
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string;
}

export enum ReceiptCategory {
  OFFICE_SUPPLIES = 'office_supplies',
  TRAVEL = 'travel',
  MEALS = 'meals',
  EQUIPMENT = 'equipment',
  SOFTWARE = 'software',
  MARKETING = 'marketing',
  UTILITIES = 'utilities',
  RENT = 'rent',
  INSURANCE = 'insurance',
  CONSULTING = 'consulting',
  OTHER = 'other'
}

export enum ReceiptStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ARCHIVED = 'archived'
}

export enum OCRStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  MANUAL = 'manual'
}

export interface OCRData {
  supplier?: string;
  supplierOrgNumber?: string;
  date?: string;
  totalAmount?: number;
  vatAmount?: number;
  netAmount?: number;
  currency?: string;
  receiptNumber?: string;
  lineItems?: OCRLineItem[];
  rawText?: string;
}

export interface OCRLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice: number;
  vatRate?: number;
}

export interface CreateReceiptDto {
  file: File;
  date?: Date;
  supplier?: string;
  category?: ReceiptCategory;
  description?: string;
  projectId?: string;
  costCenter?: string;
}

export interface UpdateReceiptDto {
  date?: Date;
  supplier?: string;
  supplierOrgNumber?: string;
  totalAmount?: number;
  vatAmount?: number;
  netAmount?: number;
  category?: ReceiptCategory;
  accountingAccount?: string;
  projectId?: string;
  costCenter?: string;
  description?: string;
  notes?: string;
  tags?: string[];
}

export interface ReceiptFilters {
  status?: ReceiptStatus[];
  category?: ReceiptCategory[];
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  supplier?: string;
  projectId?: string;
  costCenter?: string;
  search?: string;
}

export interface ReceiptStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  totalAmount: number;
  averageAmount: number;
  byCategory: Record<ReceiptCategory, number>;
  byMonth: Array<{
    month: string;
    count: number;
    amount: number;
  }>;
}

export interface ReceiptListResponse {
  receipts: Receipt[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReceiptUploadResponse {
  receipt: Receipt;
  ocrJobId?: string;
  message: string;
}

export interface BulkReceiptAction {
  receiptIds: string[];
  action: 'approve' | 'reject' | 'archive' | 'delete';
  reason?: string;
}

export interface ReceiptApproval {
  receiptId: string;
  approved: boolean;
  notes?: string;
}

export interface ReceiptExportOptions {
  format: 'pdf' | 'excel' | 'csv';
  filters?: ReceiptFilters;
  includeImages?: boolean;
  dateRange?: {
    from: Date;
    to: Date;
  };
}

6. Frontend Service:
Filsökväg: frontend/src/services/receiptService.ts
typescript/**
 * Receipt Service
 * Handles all API communication for receipt management
 */

import axios from 'axios';
import {
  Receipt,
  CreateReceiptDto,
  UpdateReceiptDto,
  ReceiptFilters,
  ReceiptStats,
  ReceiptListResponse,
  ReceiptUploadResponse,
  BulkReceiptAction,
  ReceiptApproval,
  ReceiptExportOptions
} from '../types/receipt.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

class ReceiptService {
  private getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
  }

  /**
   * Upload a new receipt
   */
  async uploadReceipt(data: CreateReceiptDto): Promise<ReceiptUploadResponse> {
    const formData = new FormData();
    formData.append('file', data.file);
    
    if (data.date) formData.append('date', data.date.toISOString());
    if (data.supplier) formData.append('supplier', data.supplier);
    if (data.category) formData.append('category', data.category);
    if (data.description) formData.append('description', data.description);
    if (data.projectId) formData.append('projectId', data.projectId);
    if (data.costCenter) formData.append('costCenter', data.costCenter);

    const response = await axios.post<ReceiptUploadResponse>(
      `${API_URL}/receipts/upload`,
      formData,
      {
        ...this.getAuthHeaders(),
        headers: {
          ...this.getAuthHeaders().headers,
          'Content-Type': 'multipart/form-data'
        }
      }
    );

    return response.data;
  }

  /**
   * Upload multiple receipts
   */
  async uploadMultipleReceipts(files: File[]): Promise<ReceiptUploadResponse[]> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    const response = await axios.post<ReceiptUploadResponse[]>(
      `${API_URL}/receipts/upload/bulk`,
      formData,
      {
        ...this.getAuthHeaders(),
        headers: {
          ...this.getAuthHeaders().headers,
          'Content-Type': 'multipart/form-data'
        }
      }
    );

    return response.data;
  }

  /**
   * Get all receipts with filters and pagination
   */
  async getReceipts(
    page: number = 1,
    pageSize: number = 20,
    filters?: ReceiptFilters
  ): Promise<ReceiptListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString()
    });

    if (filters) {
      if (filters.status) params.append('status', filters.status.join(','));
      if (filters.category) params.append('category', filters.category.join(','));
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom.toISOString());
      if (filters.dateTo) params.append('dateTo', filters.dateTo.toISOString());
      if (filters.minAmount) params.append('minAmount', filters.minAmount.toString());
      if (filters.maxAmount) params.append('maxAmount', filters.maxAmount.toString());
      if (filters.supplier) params.append('supplier', filters.supplier);
      if (filters.projectId) params.append('projectId', filters.projectId);
      if (filters.costCenter) params.append('costCenter', filters.costCenter);
      if (filters.search) params.append('search', filters.search);
    }

    const response = await axios.get<ReceiptListResponse>(
      `${API_URL}/receipts?${params.toString()}`,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Get a single receipt by ID
   */
  async getReceiptById(id: string): Promise<Receipt> {
    const response = await axios.get<Receipt>(
      `${API_URL}/receipts/${id}`,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Update a receipt
   */
  async updateReceipt(id: string, data: UpdateReceiptDto): Promise<Receipt> {
    const response = await axios.put<Receipt>(
      `${API_URL}/receipts/${id}`,
      data,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Delete a receipt
   */
  async deleteReceipt(id: string): Promise<void> {
    await axios.delete(
      `${API_URL}/receipts/${id}`,
      this.getAuthHeaders()
    );
  }

  /**
   * Approve a receipt
   */
  async approveReceipt(data: ReceiptApproval): Promise<Receipt> {
    const response = await axios.post<Receipt>(
      `${API_URL}/receipts/${data.receiptId}/approve`,
      { notes: data.notes },
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Reject a receipt
   */
  async rejectReceipt(receiptId: string, reason: string): Promise<Receipt> {
    const response = await axios.post<Receipt>(
      `${API_URL}/receipts/${receiptId}/reject`,
      { reason },
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Perform bulk actions on receipts
   */
  async bulkAction(data: BulkReceiptAction): Promise<{ success: number; failed: number }> {
    const response = await axios.post<{ success: number; failed: number }>(
      `${API_URL}/receipts/bulk`,
      data,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Retry OCR processing for a receipt
   */
  async retryOCR(receiptId: string): Promise<Receipt> {
    const response = await axios.post<Receipt>(
      `${API_URL}/receipts/${receiptId}/ocr/retry`,
      {},
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Get receipt statistics
   */
  async getStats(filters?: ReceiptFilters): Promise<ReceiptStats> {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom.toISOString());
      if (filters.dateTo) params.append('dateTo', filters.dateTo.toISOString());
      if (filters.category) params.append('category', filters.category.join(','));
      if (filters.projectId) params.append('projectId', filters.projectId);
    }

    const response = await axios.get<ReceiptStats>(
      `${API_URL}/receipts/stats?${params.toString()}`,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Export receipts
   */
  async exportReceipts(options: ReceiptExportOptions): Promise<Blob> {
    const response = await axios.post(
      `${API_URL}/receipts/export`,
      options,
      {
        ...this.getAuthHeaders(),
        responseType: 'blob'
      }
    );

    return response.data;
  }

  /**
   * Download receipt file
   */
  async downloadReceiptFile(receiptId: string): Promise<Blob> {
    const response = await axios.get(
      `${API_URL}/receipts/${receiptId}/download`,
      {
        ...this.getAuthHeaders(),
        responseType: 'blob'
      }
    );

    return response.data;
  }

  /**
   * Search receipts
   */
  async searchReceipts(query: string, limit: number = 10): Promise<Receipt[]> {
    const response = await axios.get<Receipt[]>(
      `${API_URL}/receipts/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Get receipts by project
   */
  async getReceiptsByProject(projectId: string): Promise<Receipt[]> {
    const response = await axios.get<Receipt[]>(
      `${API_URL}/receipts/project/${projectId}`,
      this.getAuthHeaders()
    );

    return response.data;
  }

  /**
   * Get recent receipts
   */
  async getRecentReceipts(limit: number = 10): Promise<Receipt[]> {
    const response = await axios.get<Receipt[]>(
      `${API_URL}/receipts/recent?limit=${limit}`,
      this.getAuthHeaders()
    );

    return response.data;
  }
}

export default new ReceiptService();
7. Frontend Hooks:
Filsökväg: frontend/src/hooks/useReceipts.ts
typescript/**
 * Receipt Hooks
 * Custom React hooks for receipt management using React Query
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import receiptService from '../services/receiptService';
import {
  Receipt,
  CreateReceiptDto,
  UpdateReceiptDto,
  ReceiptFilters,
  ReceiptStats,
  BulkReceiptAction,
  ReceiptApproval,
  ReceiptExportOptions
} from '../types/receipt.types';

/**
 * Hook for fetching receipts with pagination and filters
 */
export const useReceipts = (
  page: number = 1,
  pageSize: number = 20,
  filters?: ReceiptFilters
) => {
  return useQuery({
    queryKey: ['receipts', page, pageSize, filters],
    queryFn: () => receiptService.getReceipts(page, pageSize, filters),
    keepPreviousData: true,
    staleTime: 30000 // 30 seconds
  });
};

/**
 * Hook for fetching a single receipt
 */
export const useReceipt = (id: string) => {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: () => receiptService.getReceiptById(id),
    enabled: !!id
  });
};

/**
 * Hook for uploading a receipt
 */
export const useUploadReceipt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateReceiptDto) => receiptService.uploadReceipt(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for uploading multiple receipts
 */
export const useUploadMultipleReceipts = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (files: File[]) => receiptService.uploadMultipleReceipts(files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for updating a receipt
 */
export const useUpdateReceipt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReceiptDto }) =>
      receiptService.updateReceipt(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['receipt', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for deleting a receipt
 */
export const useDeleteReceipt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => receiptService.deleteReceipt(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for approving a receipt
 */
export const useApproveReceipt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ReceiptApproval) => receiptService.approveReceipt(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['receipt', variables.receiptId] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for rejecting a receipt
 */
export const useRejectReceipt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ receiptId, reason }: { receiptId: string; reason: string }) =>
      receiptService.rejectReceipt(receiptId, reason),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['receipt', variables.receiptId] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for bulk actions on receipts
 */
export const useBulkReceiptAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BulkReceiptAction) => receiptService.bulkAction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt-stats'] });
    }
  });
};

/**
 * Hook for retrying OCR
 */
export const useRetryOCR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (receiptId: string) => receiptService.retryOCR(receiptId),
    onSuccess: (_, receiptId) => {
      queryClient.invalidateQueries({ queryKey: ['receipt', receiptId] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    }
  });
};

/**
 * Hook for fetching receipt statistics
 */
export const useReceiptStats = (filters?: ReceiptFilters) => {
  return useQuery({
    queryKey: ['receipt-stats', filters],
    queryFn: () => receiptService.getStats(filters),
    staleTime: 60000 // 1 minute
  });
};

/**
 * Hook for exporting receipts
 */
export const useExportReceipts = () => {
  return useMutation({
    mutationFn: (options: ReceiptExportOptions) => receiptService.exportReceipts(options)
  });
};

/**
 * Hook for downloading receipt file
 */
export const useDownloadReceiptFile = () => {
  return useMutation({
    mutationFn: (receiptId: string) => receiptService.downloadReceiptFile(receiptId)
  });
};

/**
 * Hook for searching receipts
 */
export const useSearchReceipts = (query: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['receipts-search', query],
    queryFn: () => receiptService.searchReceipts(query),
    enabled: enabled && query.length > 0,
    staleTime: 30000
  });
};

/**
 * Hook for getting receipts by project
 */
export const useReceiptsByProject = (projectId: string) => {
  return useQuery({
    queryKey: ['receipts-project', projectId],
    queryFn: () => receiptService.getReceiptsByProject(projectId),
    enabled: !!projectId
  });
};

/**
 * Hook for getting recent receipts
 */
export const useRecentReceipts = (limit: number = 10) => {
  return useQuery({
    queryKey: ['receipts-recent', limit],
    queryFn: () => receiptService.getRecentReceipts(limit),
    staleTime: 30000
  });
};

/**
 * Hook for managing receipt filters state
 */
export const useReceiptFilters = () => {
  const [filters, setFilters] = useState<ReceiptFilters>({});

  const updateFilter = <K extends keyof ReceiptFilters>(
    key: K,
    value: ReceiptFilters[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const removeFilter = (key: keyof ReceiptFilters) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[key];
      return newFilters;
    });
  };

  return {
    filters,
    updateFilter,
    clearFilters,
    removeFilter,
    setFilters
  };
};

/**
 * Hook for managing receipt selection
 */
export const useReceiptSelection = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(selectedId => selectedId !== id)
        : [...prev, id]
    );
  };

  const selectAll = (ids: string[]) => {
    setSelectedIds(ids);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const isSelected = (id: string) => {
    return selectedIds.includes(id);
  };

  return {
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    selectionCount: selectedIds.length
  };
};

/**
 * Hook for file upload with progress
 */
export const useReceiptUpload = () => {
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);
  const uploadMutation = useUploadReceipt();

  const uploadFile = async (file: File, data?: Omit<CreateReceiptDto, 'file'>) => {
    const fileId = `${file.name}-${Date.now()}`;
    setIsUploading(true);
    setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));

    try {
      // Simulate progress (in real implementation, use axios progress events)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          const currentProgress = prev[fileId] || 0;
          if (currentProgress >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return { ...prev, [fileId]: currentProgress + 10 };
        });
      }, 200);

      const result = await uploadMutation.mutateAsync({
        file,
        ...data
      });

      clearInterval(progressInterval);
      setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));

      return result;
    } catch (error) {
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[fileId];
        return newProgress;
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  return {
    uploadFile,
    uploadProgress,
    isUploading,
    uploadMutation
  };
};

8. Frontend Components:
8.1 ReceiptList Component
Filsökväg: frontend/src/pages/receipts/ReceiptList.tsx
OBS: På grund av filstorleksbegränsningar, se separata komponentfiler i outputs-mappen:

ReceiptList.tsx (450 rader) - Huvudlista med filter och bulk-ops
ReceiptCard.tsx (350 rader) - Kvittokort med actions
ReceiptUpload.tsx (400 rader) - Drag & drop uppladdning
ReceiptFilters.tsx (300 rader) - Avancerad filtrering
ReceiptStats.tsx (250 rader) - Statistik med diagram
ReceiptDetail.tsx (700 rader) - Detaljvy med redigering

Komponenter är fullständigt implementerade och redo att användas. Se outputs-mappen för kompletta filer.
8.2 Component Index
Filsökväg: frontend/src/pages/receipts/index.ts
typescript/**
 * Receipt Components Index
 * Exports all receipt-related components for easy importing
 */

export { ReceiptList } from './ReceiptList';
export { ReceiptCard } from './ReceiptCard';
export { ReceiptUpload } from './ReceiptUpload';
export { ReceiptFilters } from './ReceiptFilters';
export { ReceiptStats } from './ReceiptStats';
export { ReceiptDetail } from './ReceiptDetail';

9. Database Migration:
Filsökväg: database/migrations/005_receipts.sql
sql-- Receipt Management Tables

CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Basic information
  receipt_number VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  supplier VARCHAR(255),
  supplier_org_number VARCHAR(20),
  
  -- Financial details
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'SEK',
  
  -- Categorization
  category VARCHAR(50),
  accounting_account VARCHAR(20),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  cost_center VARCHAR(50),
  
  -- OCR and processing
  ocr_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ocr_confidence DECIMAL(3, 2),
  ocr_job_id VARCHAR(100),
  
  -- File management
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  thumbnail_url TEXT,
  storage_key TEXT NOT NULL,
  
  -- Status and workflow
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  rejected_reason TEXT,
  
  -- Notes and metadata
  description TEXT,
  notes TEXT,
  tags TEXT[],
  
  -- Audit trail
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  
  CONSTRAINT receipts_unique_number UNIQUE (company_id, receipt_number),
  CONSTRAINT receipts_valid_amounts CHECK (total_amount >= 0 AND vat_amount >= 0 AND net_amount >= 0),
  CONSTRAINT receipts_valid_status CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'archived')),
  CONSTRAINT receipts_valid_ocr_status CHECK (ocr_status IN ('pending', 'processing', 'completed', 'failed', 'manual'))
);

-- Indexes for performance
CREATE INDEX idx_receipts_company_id ON receipts(company_id);
CREATE INDEX idx_receipts_user_id ON receipts(user_id);
CREATE INDEX idx_receipts_date ON receipts(date);
CREATE INDEX idx_receipts_status ON receipts(status);
CREATE INDEX idx_receipts_category ON receipts(category);
CREATE INDEX idx_receipts_supplier ON receipts(supplier);
CREATE INDEX idx_receipts_project_id ON receipts(project_id);
CREATE INDEX idx_receipts_created_at ON receipts(created_at);

-- Full-text search index
CREATE INDEX idx_receipts_search ON receipts USING gin(to_tsvector('swedish', 
  COALESCE(supplier, '') || ' ' || 
  COALESCE(description, '') || ' ' || 
  COALESCE(notes, '') || ' ' ||
  COALESCE(receipt_number, '')
));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_receipts_updated_at
  BEFORE UPDATE ON receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_receipts_updated_at();

-- MongoDB collection for OCR data (run this in MongoDB)
-- db.createCollection('receipt_ocr_data')
-- db.receipt_ocr_data.createIndex({ receiptId: 1 }, { unique: true })
-- db.receipt_ocr_data.createIndex({ processedAt: 1 })

10. Tests:
10.1 Backend Service Tests
Filsökväg: backend/src/tests/receiptService.test.ts
typescriptimport { ReceiptService } from '../services/receiptService';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';

describe('ReceiptService', () => {
  let receiptService: ReceiptService;
  let mockPool: jest.Mocked<Pool>;
  let mockMongo: jest.Mocked<MongoClient>;

  beforeEach(() => {
    mockPool = {
      query: jest.fn()
    } as any;

    mockMongo = {
      db: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          findOne: jest.fn(),
          insertOne: jest.fn(),
          deleteOne: jest.fn()
        })
      })
    } as any;

    receiptService = new ReceiptService(mockPool, mockMongo);
  });

  describe('getReceipts', () => {
    it('should return paginated receipts', async () => {
      const mockReceipts = [
        { id: '1', supplier: 'Test Supplier', total_amount: 100 }
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
        .mockResolvedValueOnce({ rows: mockReceipts } as any);

      const result = await receiptService.getReceipts('company-id', 1, 20);

      expect(result.receipts).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should apply filters correctly', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const filters = {
        status: ['pending' as any],
        minAmount: 100,
        maxAmount: 500
      };

      await receiptService.getReceipts('company-id', 1, 20, filters);

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[0]).toContain('status = ANY');
      expect(queryCall[0]).toContain('total_amount >=');
      expect(queryCall[0]).toContain('total_amount <=');
    });
  });

  describe('approveReceipt', () => {
    it('should approve receipt successfully', async () => {
      const mockReceipt = {
        id: 'receipt-1',
        status: 'approved',
        approved_by: 'user-1',
        approved_at: new Date()
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockReceipt] } as any);

      const result = await receiptService.approveReceipt(
        'receipt-1',
        'company-1',
        'user-1'
      );

      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('user-1');
    });

    it('should throw error if receipt not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        receiptService.approveReceipt('invalid-id', 'company-1', 'user-1')
      ).rejects.toThrow('Receipt not found');
    });
  });

  describe('bulkAction', () => {
    it('should perform bulk approval', async () => {
      mockPool.query.mockResolvedValue({ rows: [{}] } as any);

      const result = await receiptService.bulkAction(
        ['receipt-1', 'receipt-2'],
        'company-1',
        'user-1',
        'approve'
      );

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should handle partial failures', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{}] } as any)
        .mockRejectedValueOnce(new Error('Database error'));

      const result = await receiptService.bulkAction(
        ['receipt-1', 'receipt-2'],
        'company-1',
        'user-1',
        'approve'
      );

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const mockStats = {
        total: '10',
        pending: '3',
        approved: '5',
        rejected: '2',
        total_amount: '5000',
        average_amount: '500'
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockStats] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await receiptService.getStats('company-1');

      expect(result.total).toBe(10);
      expect(result.pending).toBe(3);
      expect(result.approved).toBe(5);
      expect(result.rejected).toBe(2);
      expect(result.totalAmount).toBe(5000);
    });
  });
});
10.2 Frontend Component Tests
Filsökväg: frontend/src/tests/ReceiptList.test.tsx
typescriptimport { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ReceiptList } from '../pages/receipts/ReceiptList';
import receiptService from '../services/receiptService';

jest.mock('../services/receiptService');

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('ReceiptList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render receipt list', async () => {
    const mockReceipts = {
      receipts: [
        {
          id: '1',
          supplier: 'Test Supplier',
          totalAmount: 100,
          date: new Date(),
          status: 'pending'
        }
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    };

    (receiptService.getReceipts as jest.Mock).mockResolvedValue(mockReceipts);

    render(<ReceiptList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Kvitton')).toBeInTheDocument();
      expect(screen.getByText('Test Supplier')).toBeInTheDocument();
    });
  });

  it('should handle upload button click', async () => {
    (receiptService.getReceipts as jest.Mock).mockResolvedValue({
      receipts: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0
    });

    render(<ReceiptList />, { wrapper: createWrapper() });

    const uploadButton = await screen.findByText('Ladda upp');
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(screen.getByText('Ladda upp kvitton')).toBeInTheDocument();
    });
  });

  it('should filter receipts', async () => {
    const mockReceipts = {
      receipts: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0
    };

    (receiptService.getReceipts as jest.Mock).mockResolvedValue(mockReceipts);

    render(<ReceiptList />, { wrapper: createWrapper() });

    const filterButton = await screen.findByText('Filter');
    fireEvent.click(filterButton);

    await waitFor(() => {
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Kategori')).toBeInTheDocument();
    });
  });

  it('should display error message on failure', async () => {
    (receiptService.getReceipts as jest.Mock).mockRejectedValue(
      new Error('Network error')
    );

    render(<ReceiptList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Kunde inte ladda kvitton')).toBeInTheDocument();
    });
  });
});

11. Verifiering:
Steg 1: Backend Setup
bash# Kör migration
cd backend
npm run migrate

# Starta backend server
npm run dev
Steg 2: Frontend Setup
bash# Installera dependencies
cd frontend
npm install

# Starta dev server
npm run dev
Steg 3: Testa endpoints
bash# Test upload
curl -X POST http://localhost:3000/api/receipts/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@receipt.jpg" \
  -F "supplier=Test Supplier" \
  -F "category=meals"

# Test get receipts
curl http://localhost:3000/api/receipts?page=1&pageSize=20 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test approve
curl -X POST http://localhost:3000/api/receipts/RECEIPT_ID/approve \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Approved"}'

# Test stats
curl http://localhost:3000/api/receipts/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
Steg 4: Verifiera i webbläsaren

Öppna http://localhost:5173/receipts
Ladda upp ett kvitto
Verifiera att OCR körs
Testa filtrering
Testa godkännande/avslag
Verifiera statistik


12. Dependencies att installera:
Backend
bashcd backend
npm install --save @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp multer uuid
npm install --save-dev @types/multer
Frontend
bashcd frontend
npm install --save @tanstack/react-query axios date-fns lucide-react recharts

13. Environment Variables:
Lägg till i .env:
bash# AWS S3
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your_bucket_name

# AI Services (för OCR)
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key



STEG 2.8: AI OCR Integration
Instruktion:
Implementera AI-driven OCR för automatisk kvittoextraktion med Claude Vision API.
Installation:
bashnpm install @anthropic-ai/sdk
Service:
Filsökväg: backend/src/services/aiService.ts
typescriptimport Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export interface ReceiptOCRData {
  supplier_name?: string;
  receipt_date?: string;
  amount?: number;
  vat_amount?: number;
  total_amount?: number;
  category?: string;
  line_items?: Array<{
    description: string;
    amount: number;
  }>;
  confidence: number;
}

export const extractReceiptData = async (
  imageUrl: string
): Promise<ReceiptOCRData> => {
  try {
    // Download image
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');
    
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image
              }
            },
            {
              type: 'text',
              text: `Analysera detta kvitto och extrahera följande information i JSON-format:
              
{
  "supplier_name": "Leverantörens namn",
  "receipt_date": "YYYY-MM-DD",
  "amount": "Belopp exklusive moms (nummer)",
  "vat_amount": "Momsbelopp (nummer)",
  "total_amount": "Totalbelopp inklusive moms (nummer)",
  "category": "Kategori (t.ex. 'Mat', 'Transport', 'Kontorsmaterial', 'IT', etc)",
  "line_items": [
    {"description": "Artikelnamn", "amount": nummer}
  ],
  "confidence": "Din konfidensgrad 0-100"
}

Viktigt:
- Om kvittot är svenskt, belopp kan vara med SEK eller kr
- Datum ska vara i YYYY-MM-DD format
- Belopp ska vara nummer utan valuta-tecken
- Confidence är hur säker du är på extraktionen (0-100)
- Om något värde inte kan läsas, sätt null
- Svara ENDAST med JSON, ingen annan text`
            }
          ]
        }
      ]
    });
    
    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }
    
    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const data = JSON.parse(jsonMatch[0]);
    
    return {
      supplier_name: data.supplier_name || undefined,
      receipt_date: data.receipt_date || undefined,
      amount: data.amount ? parseFloat(data.amount) : undefined,
      vat_amount: data.vat_amount ? parseFloat(data.vat_amount) : undefined,
      total_amount: data.total_amount ? parseFloat(data.total_amount) : undefined,
      category: data.category || undefined,
      line_items: data.line_items || [],
      confidence: data.confidence || 50
    };
  } catch (error) {
    console.error('OCR extraction error:', error);
    throw new Error('Failed to extract receipt data');
  }
};

export const categorizeExpense = async (description: string): Promise<string> => {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Kategorisera denna utgift i en av dessa kategorier: Mat, Transport, Kontorsmaterial, IT, Marknadsföring, Konsulter, Lokaler, Övrigt.

Utgift: ${description}

Svara med ENDAST kategorin, inget annat.`
        }
      ]
    });
    
    const textContent = message.content.find(c => c.type === 'text');
    if (textContent && textContent.type === 'text') {
      return textContent.text.trim();
    }
    
    return 'Övrigt';
  } catch (error) {
    console.error('Categorization error:', error);
    return 'Övrigt';
  }
};
Controller:
Filsökväg: backend/src/controllers/receiptController.ts (lägg till)
typescriptimport { extractReceiptData } from '../services/aiService';

export const processReceiptOCR = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }
    
    // Get receipt
    const receipt = await receiptService.getReceiptById(id, company_id as string);
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    // Check if file is an image
    if (!receipt.file_type.startsWith('image/')) {
      return res.status(400).json({ error: 'OCR only works with images' });
    }
    
    // Extract data using AI
    const ocrData = await extractReceiptData(receipt.file_url);
    
    // Update receipt with OCR data
    const updates: any = {
      ocr_data: ocrData,
      status: 'processed'
    };
    
    if (ocrData.supplier_name && !receipt.supplier_id) {
      // Could implement automatic supplier matching here
    }
    
    if (ocrData.receipt_date) {
      updates.receipt_date = ocrData.receipt_date;
    }
    
    if (ocrData.amount) {
      updates.amount = ocrData.amount;
    }
    
    if (ocrData.vat_amount) {
      updates.vat_amount = ocrData.vat_amount;
    }
    
    if (ocrData.total_amount) {
      updates.total_amount = ocrData.total_amount;
    }
    
    if (ocrData.category) {
      updates.category = ocrData.category;
    }
    
    const updatedReceipt = await receiptService.updateReceipt(id, company_id as string, updates);
    
    res.json(updatedReceipt);
  } catch (error) {
    console.error('Process OCR error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
Routes:
typescriptrouter.post('/:id/process-ocr', receiptController.processReceiptOCR);

STEG 2.8: AI OCR Integration - FRONTEND IMPLEMENTATION
Status: ✅ Backend komplett | ⚠️ Frontend implementation saknas
Översikt:
Frontend-komponenter för att ladda upp kvitton, använda AI OCR för att extrahera data, och visa resultaten med confidence scores.

1. TYPES
Filsökväg: frontend/src/types/ocr.types.ts
typescriptexport interface OCRConfidence {
  overall: number;
  fields: {
    date?: number;
    amount?: number;
    vendor?: number;
    items?: number;
  };
}

export interface ReceiptItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  vatRate?: number;
}

export interface OCRResult {
  id?: string;
  date: string;
  vendor: string;
  amount: number;
  vatAmount?: number;
  currency: string;
  items: ReceiptItem[];
  category?: string;
  confidence: OCRConfidence;
  rawText?: string;
  imageUrl?: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt?: string;
}

export interface OCRUploadResponse {
  success: boolean;
  data?: OCRResult;
  error?: string;
  processingTime?: number;
}

export interface ReceiptUploadFile {
  file: File;
  preview: string;
  uploadProgress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  result?: OCRResult;
  error?: string;
}

2. FRONTEND SERVICE
Filsökväg: frontend/src/services/ocrService.ts
typescriptimport axios from 'axios';
import { OCRResult, OCRUploadResponse } from '../types/ocr.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const ocrService = {
  /**
   * Upload and process receipt image with OCR
   */
  processReceipt: async (file: File): Promise<OCRUploadResponse> => {
    try {
      const formData = new FormData();
      formData.append('receipt', file);

      const response = await axios.post<OCRUploadResponse>(
        `${API_BASE_URL}/receipts/process-ocr`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 60000, // 60 second timeout for OCR processing
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          success: false,
          error: error.response?.data?.message || 'Failed to process receipt',
        };
      }
      return {
        success: false,
        error: 'An unexpected error occurred',
      };
    }
  },

  /**
   * Batch process multiple receipts
   */
  processMultipleReceipts: async (files: File[]): Promise<OCRUploadResponse[]> => {
    const promises = files.map(file => ocrService.processReceipt(file));
    return Promise.all(promises);
  },

  /**
   * Get OCR result by ID
   */
  getOCRResult: async (id: string): Promise<OCRResult | null> => {
    try {
      const response = await axios.get<{ data: OCRResult }>(
        `${API_BASE_URL}/receipts/ocr/${id}`
      );
      return response.data.data;
    } catch (error) {
      console.error('Failed to get OCR result:', error);
      return null;
    }
  },

  /**
   * Validate image before upload
   */
  validateReceiptImage: (file: File): { valid: boolean; error?: string } => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: 'Invalid file type. Please upload JPG, PNG, WEBP, or PDF.',
      };
    }

    if (file.size > maxSize) {
      return {
        valid: false,
        error: 'File size exceeds 10MB limit.',
      };
    }

    return { valid: true };
  },

  /**
   * Create preview URL for image
   */
  createPreviewUrl: (file: File): string => {
    return URL.createObjectURL(file);
  },

  /**
   * Clean up preview URL
   */
  revokePreviewUrl: (url: string): void => {
    URL.revokeObjectURL(url);
  },
};

3. FRONTEND HOOKS
Filsökväg: frontend/src/hooks/useOCR.ts
typescriptimport { useState, useCallback } from 'react';
import { ocrService } from '../services/ocrService';
import { OCRResult, ReceiptUploadFile } from '../types/ocr.types';

interface UseOCROptions {
  onSuccess?: (result: OCRResult) => void;
  onError?: (error: string) => void;
  autoProcess?: boolean;
}

export const useOCR = (options?: UseOCROptions) => {
  const [files, setFiles] = useState<ReceiptUploadFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<OCRResult[]>([]);

  /**
   * Add files to upload queue
   */
  const addFiles = useCallback((newFiles: File[]) => {
    const uploadFiles: ReceiptUploadFile[] = newFiles.map(file => ({
      file,
      preview: ocrService.createPreviewUrl(file),
      uploadProgress: 0,
      status: 'pending',
    }));

    setFiles(prev => [...prev, ...uploadFiles]);

    if (options?.autoProcess) {
      processFiles(uploadFiles);
    }
  }, [options?.autoProcess]);

  /**
   * Process files with OCR
   */
  const processFiles = useCallback(async (filesToProcess?: ReceiptUploadFile[]) => {
    const targetFiles = filesToProcess || files.filter(f => f.status === 'pending');
    
    if (targetFiles.length === 0) return;

    setIsProcessing(true);

    for (const uploadFile of targetFiles) {
      // Validate file
      const validation = ocrService.validateReceiptImage(uploadFile.file);
      if (!validation.valid) {
        updateFileStatus(uploadFile.file.name, 'error', validation.error);
        options?.onError?.(validation.error || 'Validation failed');
        continue;
      }

      // Update status to uploading
      updateFileStatus(uploadFile.file.name, 'uploading');

      try {
        // Process with OCR
        const response = await ocrService.processReceipt(uploadFile.file);

        if (response.success && response.data) {
          updateFileStatus(uploadFile.file.name, 'completed', undefined, response.data);
          setResults(prev => [...prev, response.data!]);
          options?.onSuccess?.(response.data);
        } else {
          updateFileStatus(uploadFile.file.name, 'error', response.error);
          options?.onError?.(response.error || 'Processing failed');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        updateFileStatus(uploadFile.file.name, 'error', errorMessage);
        options?.onError?.(errorMessage);
      }
    }

    setIsProcessing(false);
  }, [files, options]);

  /**
   * Update file status
   */
  const updateFileStatus = (
    fileName: string,
    status: ReceiptUploadFile['status'],
    error?: string,
    result?: OCRResult
  ) => {
    setFiles(prev =>
      prev.map(file =>
        file.file.name === fileName
          ? { ...file, status, error, result }
          : file
      )
    );
  };

  /**
   * Remove file from queue
   */
  const removeFile = useCallback((fileName: string) => {
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.file.name === fileName);
      if (fileToRemove) {
        ocrService.revokePreviewUrl(fileToRemove.preview);
      }
      return prev.filter(f => f.file.name !== fileName);
    });
  }, []);

  /**
   * Clear all files and results
   */
  const clearAll = useCallback(() => {
    files.forEach(file => ocrService.revokePreviewUrl(file.preview));
    setFiles([]);
    setResults([]);
  }, [files]);

  /**
   * Retry failed file
   */
  const retryFile = useCallback((fileName: string) => {
    const fileToRetry = files.find(f => f.file.name === fileName);
    if (fileToRetry) {
      updateFileStatus(fileName, 'pending');
      processFiles([fileToRetry]);
    }
  }, [files, processFiles]);

  return {
    files,
    results,
    isProcessing,
    addFiles,
    processFiles,
    removeFile,
    clearAll,
    retryFile,
  };
};

4. FRONTEND COMPONENTS
4.1. ReceiptUpload Component
Filsökväg: frontend/src/components/receipts/ReceiptUpload.tsx
typescriptimport React, { useCallback, useRef } from 'react';
import { Upload, X, FileImage } from 'lucide-react';
import { ReceiptUploadFile } from '../../types/ocr.types';

interface ReceiptUploadProps {
  files: ReceiptUploadFile[];
  onFilesAdded: (files: File[]) => void;
  onFileRemove: (fileName: string) => void;
  disabled?: boolean;
  maxFiles?: number;
}

export const ReceiptUpload: React.FC<ReceiptUploadProps> = ({
  files,
  onFilesAdded,
  onFileRemove,
  disabled = false,
  maxFiles = 10,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      const remainingSlots = maxFiles - files.length;
      const filesToAdd = droppedFiles.slice(0, remainingSlots);

      if (filesToAdd.length > 0) {
        onFilesAdded(filesToAdd);
      }
    },
    [disabled, files.length, maxFiles, onFilesAdded]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const selectedFiles = Array.from(e.target.files);
        const remainingSlots = maxFiles - files.length;
        const filesToAdd = selectedFiles.slice(0, remainingSlots);
        onFilesAdded(filesToAdd);
      }
    },
    [files.length, maxFiles, onFilesAdded]
  );

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const getStatusColor = (status: ReceiptUploadFile['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 border-green-300';
      case 'error':
        return 'bg-red-100 border-red-300';
      case 'uploading':
      case 'processing':
        return 'bg-blue-100 border-blue-300 animate-pulse';
      default:
        return 'bg-gray-100 border-gray-300';
    }
  };

  const getStatusText = (status: ReceiptUploadFile['status']) => {
    switch (status) {
      case 'uploading':
        return 'Laddar upp...';
      case 'processing':
        return 'Bearbetar med AI...';
      case 'completed':
        return 'Klar!';
      case 'error':
        return 'Misslyckades';
      default:
        return 'Väntar';
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={openFileDialog}
        className={`
          border-2 border-dashed rounded-lg p-8
          transition-colors cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 hover:bg-blue-50'}
          ${files.length >= maxFiles ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={handleFileInput}
          className="hidden"
          disabled={disabled || files.length >= maxFiles}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <Upload className="w-12 h-12 text-gray-400" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-700">
              Dra och släpp kvitton här
            </p>
            <p className="text-sm text-gray-500">
              eller klicka för att välja filer
            </p>
          </div>
          <p className="text-xs text-gray-400">
            JPG, PNG, WEBP eller PDF (max 10MB per fil)
          </p>
          <p className="text-xs text-gray-400">
            {files.length} / {maxFiles} filer
          </p>
        </div>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">
            Uppladdade filer ({files.length})
          </h3>
          <div className="space-y-2">
            {files.map((file) => (
              <div
                key={file.file.name}
                className={`
                  flex items-center gap-3 p-3 rounded-lg border
                  ${getStatusColor(file.status)}
                `}
              >
                {/* Preview */}
                <div className="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-white">
                  {file.preview ? (
                    <img
                      src={file.preview}
                      alt={file.file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileImage className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* File Info */}
                <div className="flex-grow min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {file.file.name}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500">
                      {(file.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    <span className="text-gray-300">•</span>
                    <p className="text-xs text-gray-500">
                      {getStatusText(file.status)}
                    </p>
                  </div>
                  {file.error && (
                    <p className="text-xs text-red-600 mt-1">{file.error}</p>
                  )}
                </div>

                {/* Remove Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFileRemove(file.file.name);
                  }}
                  className="flex-shrink-0 p-1 hover:bg-white rounded transition-colors"
                  disabled={file.status === 'uploading' || file.status === 'processing'}
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
4.2. OCRResultDisplay Component
Filsökväg: frontend/src/components/receipts/OCRResultDisplay.tsx
typescriptimport React from 'react';
import { CheckCircle, AlertCircle, Calendar, Building, CreditCard, Tag } from 'lucide-react';
import { OCRResult } from '../../types/ocr.types';

interface OCRResultDisplayProps {
  result: OCRResult;
  onEdit?: (result: OCRResult) => void;
  onSave?: (result: OCRResult) => void;
}

export const OCRResultDisplay: React.FC<OCRResultDisplayProps> = ({
  result,
  onEdit,
  onSave,
}) => {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600';
    if (confidence >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.9) return 'Hög säkerhet';
    if (confidence >= 0.7) return 'Medel säkerhet';
    return 'Låg säkerhet';
  };

  const formatCurrency = (amount: number, currency: string = 'SEK') => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header with Overall Confidence */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {result.confidence.overall >= 0.7 ? (
              <CheckCircle className="w-6 h-6 text-green-600" />
            ) : (
              <AlertCircle className="w-6 h-6 text-yellow-600" />
            )}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                OCR Resultat
              </h3>
              <p className={`text-sm ${getConfidenceColor(result.confidence.overall)}`}>
                {getConfidenceLabel(result.confidence.overall)} (
                {(result.confidence.overall * 100).toFixed(0)}%)
              </p>
            </div>
          </div>
          {onEdit && (
            <button
              onClick={() => onEdit(result)}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Redigera
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">
        {/* Image Preview */}
        {result.imageUrl && (
          <div className="rounded-lg overflow-hidden border border-gray-200">
            <img
              src={result.imageUrl}
              alt="Receipt"
              className="w-full h-auto max-h-96 object-contain bg-gray-50"
            />
          </div>
        )}

        {/* Extracted Data Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Date */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Calendar className="w-4 h-4" />
              <span className="font-medium">Datum</span>
              {result.confidence.fields.date && (
                <span className={`text-xs ${getConfidenceColor(result.confidence.fields.date)}`}>
                  ({(result.confidence.fields.date * 100).toFixed(0)}%)
                </span>
              )}
            </div>
            <p className="text-lg font-semibold text-gray-900">
              {new Date(result.date).toLocaleDateString('sv-SE')}
            </p>
          </div>

          {/* Vendor */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Building className="w-4 h-4" />
              <span className="font-medium">Leverantör</span>
              {result.confidence.fields.vendor && (
                <span className={`text-xs ${getConfidenceColor(result.confidence.fields.vendor)}`}>
                  ({(result.confidence.fields.vendor * 100).toFixed(0)}%)
                </span>
              )}
            </div>
            <p className="text-lg font-semibold text-gray-900">{result.vendor}</p>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <CreditCard className="w-4 h-4" />
              <span className="font-medium">Belopp</span>
              {result.confidence.fields.amount && (
                <span className={`text-xs ${getConfidenceColor(result.confidence.fields.amount)}`}>
                  ({(result.confidence.fields.amount * 100).toFixed(0)}%)
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(result.amount, result.currency)}
              </p>
              {result.vatAmount && (
                <p className="text-sm text-gray-600">
                  varav moms: {formatCurrency(result.vatAmount, result.currency)}
                </p>
              )}
            </div>
          </div>

          {/* Category */}
          {result.category && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Tag className="w-4 h-4" />
                <span className="font-medium">Kategori</span>
              </div>
              <p className="text-lg font-semibold text-gray-900">{result.category}</p>
            </div>
          )}
        </div>

        {/* Items List */}
        {result.items.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700">
                Artiklar ({result.items.length})
              </h4>
              {result.confidence.fields.items && (
                <span className={`text-xs ${getConfidenceColor(result.confidence.fields.items)}`}>
                  Säkerhet: {(result.confidence.fields.items * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Beskrivning
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Antal
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Pris/st
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Totalt
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {result.items.map((item, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {item.description}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        {formatCurrency(item.unitPrice, result.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                        {formatCurrency(item.totalPrice, result.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Raw Text (Collapsible) */}
        {result.rawText && (
          <details className="space-y-2">
            <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
              Visa RAW OCR-text
            </summary>
            <pre className="text-xs text-gray-600 bg-gray-50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {result.rawText}
            </pre>
          </details>
        )}
      </div>

      {/* Footer Actions */}
      {onSave && (
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
          <div className="flex justify-end gap-3">
            <button
              onClick={() => onEdit?.(result)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Redigera
            </button>
            <button
              onClick={() => onSave(result)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Spara kvitto
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
4.3. ReceiptOCRPage - Main Page Component
Filsökväg: frontend/src/pages/receipts/ReceiptOCRPage.tsx
typescriptimport React, { useState } from 'react';
import { useOCR } from '../../hooks/useOCR';
import { ReceiptUpload } from '../../components/receipts/ReceiptUpload';
import { OCRResultDisplay } from '../../components/receipts/OCRResultDisplay';
import { OCRResult } from '../../types/ocr.types';
import { Sparkles, ArrowRight, CheckCircle } from 'lucide-react';

export const ReceiptOCRPage: React.FC = () => {
  const [savedResults, setSavedResults] = useState<OCRResult[]>([]);

  const {
    files,
    results,
    isProcessing,
    addFiles,
    processFiles,
    removeFile,
    clearAll,
    retryFile,
  } = useOCR({
    autoProcess: false,
    onSuccess: (result) => {
      console.log('OCR completed:', result);
    },
    onError: (error) => {
      console.error('OCR error:', error);
    },
  });

  const handleSaveResult = (result: OCRResult) => {
    setSavedResults((prev) => [...prev, result]);
    // Here you would typically save to backend
    console.log('Saving result:', result);
  };

  const handleEditResult = (result: OCRResult) => {
    // Navigate to edit page or open modal
    console.log('Editing result:', result);
  };

  const pendingFiles = files.filter((f) => f.status === 'pending');
  const hasCompletedFiles = files.some((f) => f.status === 'completed');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                AI Kvitto-scanner
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Ladda upp kvitton och låt AI extrahera all information automatiskt
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Upload */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                1. Ladda upp kvitton
              </h2>
              <ReceiptUpload
                files={files}
                onFilesAdded={addFiles}
                onFileRemove={removeFile}
                disabled={isProcessing}
                maxFiles={10}
              />
            </div>

            {/* Process Button */}
            {pendingFiles.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  2. Bearbeta med AI
                </h2>
                <button
                  onClick={() => processFiles()}
                  disabled={isProcessing}
                  className={`
                    w-full flex items-center justify-center gap-2
                    px-6 py-4 rounded-lg font-medium
                    transition-all transform
                    ${
                      isProcessing
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-105 shadow-lg'
                    }
                    text-white
                  `}
                >
                  {isProcessing ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      <span>Bearbetar med AI...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>Starta AI-bearbetning</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
                <p className="text-sm text-gray-500 text-center mt-3">
                  {pendingFiles.length} kvitto{pendingFiles.length !== 1 ? 'n' : ''} redo att bearbetas
                </p>
              </div>
            )}

            {/* Stats */}
            {files.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Statistik
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">
                      {files.length}
                    </p>
                    <p className="text-xs text-gray-500">Totalt</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {files.filter((f) => f.status === 'processing' || f.status === 'uploading').length}
                    </p>
                    <p className="text-xs text-gray-500">Bearbetar</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">
                      {files.filter((f) => f.status === 'completed').length}
                    </p>
                    <p className="text-xs text-gray-500">Klara</p>
                  </div>
                </div>
              </div>
            )}

            {/* Clear All Button */}
            {hasCompletedFiles && !isProcessing && (
              <button
                onClick={clearAll}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Rensa alla
              </button>
            )}
          </div>

          {/* Right Column - Results */}
          <div className="space-y-6">
            {results.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Inga resultat ännu
                </h3>
                <p className="text-sm text-gray-500">
                  Ladda upp kvitton och bearbeta dem för att se AI-extraherad data här
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    3. Granska och spara
                  </h2>
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span>{results.length} kvitto(n) bearbetade</span>
                  </div>
                </div>

                <div className="space-y-6">
                  {results.map((result, index) => (
                    <OCRResultDisplay
                      key={index}
                      result={result}
                      onEdit={handleEditResult}
                      onSave={handleSaveResult}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

5. INTEGRATION MED ROUTING
Filsökväg: frontend/src/App.tsx (lägg till route)
typescriptimport { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ReceiptOCRPage } from './pages/receipts/ReceiptOCRPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ... andra routes ... */}
        <Route path="/receipts/ocr" element={<ReceiptOCRPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

6. ENVIRONMENT VARIABLES
Filsökväg: frontend/.env.development
bashVITE_API_URL=http://localhost:3000/api
VITE_MAX_FILE_SIZE=10485760
VITE_ALLOWED_FILE_TYPES=image/jpeg,image/png,image/webp,application/pdf

7. STYLING (Optional Tailwind Config)
Filsökväg: frontend/tailwind.config.js (lägg till om behövs)
javascript/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}

8. VERIFIERING
Manuell testning:
bash# 1. Starta backend (om inte redan igång)
cd backend
npm run dev

# 2. Starta frontend
cd frontend
npm run dev

# 3. Öppna webbläsaren
# Navigera till: http://localhost:5173/receipts/ocr

# 4. Testa funktionalitet:
# - Ladda upp ett kvittobild
# - Klicka "Starta AI-bearbetning"
# - Granska OCR-resultatet
# - Kontrollera confidence scores
# - Testa "Spara kvitto" knappen
Funktioner att verifiera:
✅ Upload:

 Drag-and-drop fungerar
 Filväljare fungerar
 Flera filer samtidigt
 Filvalidering (storlek, typ)
 Preview av bilder

✅ Processing:

 Status-uppdateringar i realtid
 Loading states
 Felhantering vid misslyckat OCR
 Retry-funktion

✅ Results:

 Alla fält visas korrekt
 Confidence scores visas
 Items/artiklar visas i tabell
 Bild-preview
 Raw text (collapsible)

✅ UI/UX:

 Responsiv design
 Snygga animationer
 Intuitivt flöde
 Tydliga felmeddelanden


STEG 2.9: Accounting Module med BAS-kontoplanen
Instruktion:
Implementera bokföringssystem med automatisk bokföring enligt svensk BAS-kontoplan.
Migration:
Filsökväg: database/migrations/005_accounting.sql
sql-- BAS Account Plan
CREATE TABLE IF NOT EXISTS bas_accounts (
    account_number INTEGER PRIMARY KEY,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    description TEXT
);

-- Journal entries
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    description TEXT,
    reference_type VARCHAR(50),
    reference_id UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Journal entry lines (debit/credit)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_number INTEGER REFERENCES bas_accounts(account_number),
    debit DECIMAL(15, 2) DEFAULT 0,
    credit DECIMAL(15, 2) DEFAULT 0,
    description TEXT,
    line_order INTEGER NOT NULL
);

-- Seed BAS accounts (svensk kontoplan)
INSERT INTO bas_accounts (account_number, account_name, account_type, description) VALUES
-- Tillgångar (1000-1999)
(1510, 'Kundfordringar', 'asset', 'Fordringar på kunder'),
(1630, 'Skattefordringar', 'asset', 'Ingående moms'),
(1910, 'Kassa', 'asset', 'Kontanter'),
(1930, 'Företagskonto', 'asset', 'Bankkonto'),

-- Skulder (2000-2999)
(2440, 'Leverantörsskulder', 'liability', 'Skulder till leverantörer'),
(2610, 'Utgående moms 25%', 'liability', 'Moms att betala till Skatteverket'),
(2640, 'Skatteskulder', 'liability', 'Skatt att betala'),

-- Eget kapital (3000-3999)
(2081, 'Årets resultat', 'equity', 'Årets vinst/förlust'),

-- Intäkter (4000-4999)
(3000, 'Försäljning varor 25% moms', 'revenue', 'Försäljning av varor'),
(3100, 'Försäljning tjänster 25% moms', 'revenue', 'Försäljning av tjänster'),
(3740, 'Öres- och kronutjämning', 'revenue', 'Avrundningar'),

-- Kostnader (5000-7999)
(4000, 'Inköp varor', 'expense', 'Inköp av material och varor'),
(5010, 'Lokalhyra', 'expense', 'Hyra för lokaler'),
(5800, 'Representation', 'expense', 'Representationskostnader'),
(6071, 'Personalkostnader', 'expense', 'Löner och ersättningar'),
(6570, 'Bankkostnader', 'expense', 'Avgifter och kostnader för bank'),
(6980, 'Övriga externa kostnader', 'expense', 'Diverse kostnader')

ON CONFLICT (account_number) DO NOTHING;

CREATE INDEX idx_journal_entries_company ON journal_entries(company_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account ON journal_entry_lines(account_number);
Types:
Filsökväg: backend/src/types/accounting.types.ts
typescriptexport interface BASAccount {
  account_number: number;
  account_name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  description?: string;
}

export interface JournalEntry {
  id: string;
  company_id: string;
  entry_date: Date;
  description?: string;
  reference_type?: string;
  reference_id?: string;
  created_by: string;
  created_at: Date;
  lines?: JournalEntryLine[];
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_number: number;
  debit: number;
  credit: number;
  description?: string;
  line_order: number;
}

export interface CreateJournalEntryDto {
  entry_date: string;
  description?: string;
  reference_type?: string;
  reference_id?: string;
  lines: Array<{
    account_number: number;
    debit?: number;
    credit?: number;
    description?: string;
  }>;
}
Service:
Filsökväg: backend/src/services/accountingService.ts
typescriptimport { query } from '../config/database';
import { BASAccount, JournalEntry, CreateJournalEntryDto } from '../types/accounting.types';

export const getBASAccounts = async (
  filters?: {
    account_type?: string;
    search?: string;
  }
): Promise<BASAccount[]> => {
  let queryText = 'SELECT * FROM bas_accounts WHERE 1=1';
  const params: any[] = [];
  let paramCount = 1;
  
  if (filters?.account_type) {
    queryText += ` AND account_type = $${paramCount}`;
    params.push(filters.account_type);
    paramCount++;
  }
  
  if (filters?.search) {
    queryText += ` AND (account_name ILIKE $${paramCount} OR CAST(account_number AS TEXT) LIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }
  
  queryText += ' ORDER BY account_number';
  
  const result = await query(queryText, params);
  return result.rows;
};

export const createJournalEntry = async (
  companyId: string,
  userId: string,
  data: CreateJournalEntryDto
): Promise<JournalEntry> => {
  // Validate balanced entry
  const totalDebit = data.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = data.lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('Journal entry must be balanced (debit = credit)');
  }
  
  const client = await query('BEGIN', []);
  
  try {
    // Create journal entry
    const entryResult = await query(
      `INSERT INTO journal_entries (
        company_id, entry_date, description, reference_type, reference_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        companyId,
        data.entry_date,
        data.description || null,
        data.reference_type || null,
        data.reference_id || null,
        userId
      ]
    );
    
    const entry = entryResult.rows[0];
    
    // Create journal entry lines
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      await query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id, account_number, debit, credit, description, line_order
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.id,
          line.account_number,
          line.debit || 0,
          line.credit || 0,
          line.description || null,
          i + 1
        ]
      );
    }
    
    await query('COMMIT', []);
    
    return await getJournalEntryById(entry.id, companyId);
  } catch (error) {
    await query('ROLLBACK', []);
    throw error;
  }
};

export const bookInvoice = async (
  invoiceId: string,
  companyId: string,
  userId: string
): Promise<JournalEntry> => {
  const { getInvoiceById } = await import('./invoiceService');
  const invoice = await getInvoiceById(invoiceId, companyId);
  
  // Create journal entry for invoice
  // Debit: Kundfordringar (1510)
  // Credit: Försäljning (3000) and Utgående moms (2610)
  
  return await createJournalEntry(companyId, userId, {
    entry_date: new Date(invoice.invoice_date).toISOString().split('T')[0],
    description: `Faktura ${invoice.invoice_number}`,
    reference_type: 'invoice',
    reference_id: invoiceId,
    lines: [
      {
        account_number: 1510, // Kundfordringar
        debit: invoice.total_amount,
        description: `Faktura ${invoice.invoice_number}`
      },
      {
        account_number: 3000, // Försäljning
        credit: invoice.subtotal,
        description: `Försäljning`
      },
      {
        account_number: 2610, // Utgående moms
        credit: invoice.vat_amount,
        description: `Moms 25%`
      }
    ]
  });
};

export const bookInvoicePayment = async (
  invoiceId: string,
  companyId: string,
  userId: string,
  paymentDate: string,
  amount: number
): Promise<JournalEntry> => {
  const { getInvoiceById } = await import('./invoiceService');
  const invoice = await getInvoiceById(invoiceId, companyId);
  
  // Create journal entry for payment
  // Debit: Bankkonto (1930)
  // Credit: Kundfordringar (1510)
  
  return await createJournalEntry(companyId, userId, {
    entry_date: paymentDate,
    description: `Betalning faktura ${invoice.invoice_number}`,
    reference_type: 'invoice_payment',
    reference_id: invoiceId,
    lines: [
      {
        account_number: 1930, // Bankkonto
        debit: amount,
        description: `Betalning`
      },
      {
        account_number: 1510, // Kundfordringar
        credit: amount,
        description: `Faktura ${invoice.invoice_number}`
      }
    ]
  });
};

export const bookReceipt = async (
  receiptId: string,
  companyId: string,
  userId: string
): Promise<JournalEntry> => {
  const { getReceiptById } = await import('./receiptService');
  const receipt = await getReceiptById(receiptId, companyId);
  
  if (!receipt) {
    throw new Error('Receipt not found');
  }
  
  // Determine expense account based on category
  let expenseAccount = 6980; // Default: Övriga externa kostnader
  
  if (receipt.category) {
    const categoryMap: { [key: string]: number } = {
      'Lokaler': 5010,
      'Representation': 5800,
      'Personal': 6071,
      'Bank': 6570,
      'Inköp': 4000
    };
    expenseAccount = categoryMap[receipt.category] || 6980;
  }
  
  // Create journal entry for receipt
  // Debit: Kostnadskonto and Ingående moms (1630)
  // Credit: Leverantörsskulder (2440) or Bankkonto (1930)
  
  return await createJournalEntry(companyId, userId, {
    entry_date: new Date(receipt.receipt_date).toISOString().split('T')[0],
    description: `Kvitto ${receipt.supplier_id ? 'från leverantör' : ''}`,
    reference_type: 'receipt',
    reference_id: receiptId,
    lines: [
      {
        account_number: expenseAccount,
        debit: receipt.amount,
        description: receipt.description || 'Kostnad'
      },
      ...(receipt.vat_amount ? [{
        account_number: 1630, // Ingående moms
        debit: receipt.vat_amount,
        description: 'Moms'
      }] : []),
      {
        account_number: 2440, // Leverantörsskulder
        credit: receipt.total_amount,
        description: 'Att betala'
      }
    ]
  });
};

export const getJournalEntries = async (
  companyId: string,
  filters?: {
    start_date?: Date;
    end_date?: Date;
    account_number?: number;
  }
): Promise<JournalEntry[]> => {
  let queryText = 'SELECT * FROM journal_entries WHERE company_id = $1';
  const params: any[] = [companyId];
  let paramCount = 2;
  
  if (filters?.start_date) {
    queryText += ` AND entry_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }
  
  if (filters?.end_date) {
    queryText += ` AND entry_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }
  
  queryText += ' ORDER BY entry_date DESC, created_at DESC';
  
  const result = await query(queryText, params);
  
  // Get lines for each entry
  for (const entry of result.rows) {
    const linesResult = await query(
      `SELECT jel.*, ba.account_name
       FROM journal_entry_lines jel
       LEFT JOIN bas_accounts ba ON jel.account_number = ba.account_number
       WHERE jel.journal_entry_id = $1
       ORDER BY jel.line_order`,
      [entry.id]
    );
    entry.lines = linesResult.rows;
  }
  
  return result.rows;
};

export const getJournalEntryById = async (
  entryId: string,
  companyId: string
): Promise<JournalEntry> => {
  const result = await query(
    'SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2',
    [entryId, companyId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Journal entry not found');
  }
  
  const entry = result.rows[0];
  
  // Get lines
  const linesResult = await query(
    `SELECT jel.*, ba.account_name
     FROM journal_entry_lines jel
     LEFT JOIN bas_accounts ba ON jel.account_number = ba.account_number
     WHERE jel.journal_entry_id = $1
     ORDER BY jel.line_order`,
    [entryId]
  );
  
  entry.lines = linesResult.rows;
  
  return entry;
};

export const getAccountBalance = async (
  companyId: string,
  accountNumber: number,
  upToDate?: Date
): Promise<number> => {
  let queryText = `
    SELECT 
      SUM(jel.debit) as total_debit,
      SUM(jel.credit) as total_credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.company_id = $1 AND jel.account_number = $2
  `;
  
  const params: any[] = [companyId, accountNumber];
  
  if (upToDate) {
    queryText += ' AND je.entry_date <= $3';
    params.push(upToDate);
  }
  
  const result = await query(queryText, params);
  
  const totalDebit = parseFloat(result.rows[0].total_debit) || 0;
  const totalCredit = parseFloat(result.rows[0].total_credit) || 0;
  
  return totalDebit - totalCredit;
};

export const getTrialBalance = async (
  companyId: string,
  upToDate?: Date
): Promise<Array<{
  account_number: number;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number;
}>> => {
  let queryText = `
    SELECT 
      ba.account_number,
      ba.account_name,
      ba.account_type,
      SUM(jel.debit) as total_debit,
      SUM(jel.credit) as total_credit
    FROM bas_accounts ba
    LEFT JOIN journal_entry_lines jel ON ba.account_number = jel.account_number
    LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.company_id = $1
  `;
  
  const params: any[] = [companyId];
  
  if (upToDate) {
    queryText += ' WHERE je.entry_date <= $2 OR je.entry_date IS NULL';
    params.push(upToDate);
  }
  
  queryText += `
    GROUP BY ba.account_number, ba.account_name, ba.account_type
    HAVING SUM(jel.debit) > 0 OR SUM(jel.credit) > 0
    ORDER BY ba.account_number
  `;
  
  const result = await query(queryText, params);
  
  return result.rows.map(row => {
    const debit = parseFloat(row.total_debit) || 0;
    const credit = parseFloat(row.total_credit) || 0;
    return {
      account_number: row.account_number,
      account_name: row.account_name,
      account_type: row.account_type,
      debit,
      credit,
      balance: debit - credit
    };
  });
};
Implementera controllers och routes själv baserat på samma mönster som tidigare moduler.

STEG 2.10: Dashboard
Instruktion:
Implementera översikts-dashboard med widgets, grafer och quick actions.
Service:
Filsökväg: backend/src/services/dashboardService.ts
typescriptimport { query } from '../config/database';

export const getDashboardStats = async (companyId: string) => {
  // Total revenue this month
  const revenueResult = await query(
    `SELECT SUM(total_amount) as total
     FROM invoices
     WHERE company_id = $1 
     AND status != 'cancelled'
     AND EXTRACT(MONTH FROM invoice_date) = EXTRACT(MONTH FROM CURRENT_DATE)
     AND EXTRACT(YEAR FROM invoice_date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
    [companyId]
  );
  
  // Unpaid invoices
  const unpaidResult = await query(
    `SELECT COUNT(*) as count, SUM(total_amount - paid_amount) as total
     FROM invoices
     WHERE company_id = $1 
     AND status IN ('sent', 'overdue')
     AND paid_amount < total_amount`,
    [companyId]
  );
  
  // Overdue invoices
  const overdueResult = await query(
    `SELECT COUNT(*) as count
     FROM invoices
     WHERE company_id = $1 
     AND status = 'overdue'`,
    [companyId]
  );
  
  // Recent invoices
  const recentInvoices = await query(
    `SELECT i.*, c.name as customer_name
     FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE i.company_id = $1
     ORDER BY i.created_at DESC
     LIMIT 5`,
    [companyId]
  );
  
  // Monthly revenue (last 12 months)
  const monthlyRevenue = await query(
    `SELECT 
      TO_CHAR(invoice_date, 'YYYY-MM') as month,
      SUM(total_amount) as revenue
     FROM invoices
     WHERE company_id = $1
     AND status != 'cancelled'
     AND invoice_date >= CURRENT_DATE - INTERVAL '12 months'
     GROUP BY TO_CHAR(invoice_date, 'YYYY-MM')
     ORDER BY month`,
    [companyId]
  );
  
  return {
    revenue_this_month: parseFloat(revenueResult.rows[0]?.total || 0),
    unpaid_invoices: {
      count: parseInt(unpaidResult.rows[0]?.count || 0),
      total: parseFloat(unpaidResult.rows[0]?.total || 0)
    },
    overdue_invoices: {
      count: parseInt(overdueResult.rows[0]?.count || 0)
    },
    recent_invoices: recentInvoices.rows,
    monthly_revenue: monthlyRevenue.rows
  };
};
Frontend Component:
Filsökväg: frontend/src/pages/DashboardPage.tsx
typescriptimport { useQuery } from '@tanstack/react-query';
import { getDashboardStats } from '../services/dashboardService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function DashboardPage() {
  const companyId = localStorage.getItem('currentCompanyId');
  
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboardStats', companyId],
    queryFn: () => getDashboardStats(companyId!)
  });
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-gray-500 text-sm font-medium">Omsättning denna månad</h3>
          <p className="text-3xl font-bold mt-2">
            {stats?.revenue_this_month?.toLocaleString('sv-SE')} kr
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-gray-500 text-sm font-medium">Obetalda fakturor</h3>
          <p className="text-3xl font-bold mt-2">{stats?.unpaid_invoices?.count}</p>
          <p className="text-sm text-gray-600 mt-1">
            {stats?.unpaid_invoices?.total?.toLocaleString('sv-SE')} kr
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-gray-500 text-sm font-medium">Förfallna fakturor</h3>
          <p className="text-3xl font-bold mt-2 text-red-600">
            {stats?.overdue_invoices?.count}
          </p>
        </div>
      </div>
      
      {/* Revenue Chart */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Omsättning senaste 12 månaderna</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={stats?.monthly_revenue || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="revenue" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      {/* Recent Invoices */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Senaste fakturor</h2>
        <table className="w-full">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2">Fakturanr</th>
              <th className="text-left py-2">Kund</th>
              <th className="text-left py-2">Datum</th>
              <th className="text-left py-2">Belopp</th>
              <th className="text-left py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {stats?.recent_invoices?.map((invoice: any) => (
              <tr key={invoice.id} className="border-b">
                <td className="py-3">{invoice.invoice_number}</td>
                <td className="py-3">{invoice.customer_name}</td>
                <td className="py-3">
                  {new Date(invoice.invoice_date).toLocaleDateString('sv-SE')}
                </td>
                <td className="py-3">
                  {invoice.total_amount.toLocaleString('sv-SE')} kr
                </td>
                <td className="py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    invoice.status === 'paid' ? 'bg-green-100 text-green-800' :
                    invoice.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                    invoice.status === 'overdue' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {invoice.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

STEG 2.11: Reports (Resultaträkning, Balansräkning, Momsrapport)
Instruktion:
Implementera finansiella rapporter med export till Excel/PDF.
Service:
Filsökväg: backend/src/services/reportService.ts
typescriptimport { query } from '../config/database';
import { getTrialBalance } from './accountingService';

export const generateIncomeStatement = async (
  companyId: string,
  startDate: Date,
  endDate: Date
) => {
  const trialBalance = await getTrialBalance(companyId, endDate);
  
  // Filter revenue and expense accounts
  const revenues = trialBalance.filter(acc => acc.account_type === 'revenue');
  const expenses = trialBalance.filter(acc => acc.account_type === 'expense');
  
  const totalRevenue = revenues.reduce((sum, acc) => sum + acc.credit - acc.debit, 0);
  const totalExpenses = expenses.reduce((sum, acc) => sum + acc.debit - acc.credit, 0);
  
  return {
    period: {
      start: startDate,
      end: endDate
    },
    revenues: revenues.map(acc => ({
      account: acc.account_number,
      name: acc.account_name,
      amount: acc.credit - acc.debit
    })),
    total_revenue: totalRevenue,
    expenses: expenses.map(acc => ({
      account: acc.account_number,
      name: acc.account_name,
      amount: acc.debit - acc.credit
    })),
    total_expenses: totalExpenses,
    net_income: totalRevenue - totalExpenses
  };
};

export const generateBalanceSheet = async (
  companyId: string,
  asOfDate: Date
) => {
  const trialBalance = await getTrialBalance(companyId, asOfDate);
  
  const assets = trialBalance.filter(acc => acc.account_type === 'asset');
  const liabilities = trialBalance.filter(acc => acc.account_type === 'liability');
  const equity = trialBalance.filter(acc => acc.account_type === 'equity');
  
  const totalAssets = assets.reduce((sum, acc) => sum + acc.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
  const totalEquity = equity.reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
  
  return {
    as_of_date: asOfDate,
    assets: assets.map(acc => ({
      account: acc.account_number,
      name: acc.account_name,
      amount: acc.balance
    })),
    total_assets: totalAssets,
    liabilities: liabilities.map(acc => ({
      account: acc.account_number,
      name: acc.account_name,
      amount: Math.abs(acc.balance)
    })),
    total_liabilities: totalLiabilities,
    equity: equity.map(acc => ({
      account: acc.account_number,
      name: acc.account_name,
      amount: Math.abs(acc.balance)
    })),
    total_equity: totalEquity,
    total_liabilities_equity: totalLiabilities + totalEquity
  };
};

export const generateVATReport = async (
  companyId: string,
  startDate: Date,
  endDate: Date
) => {
  // Utgående moms (sales VAT)
  const outgoingVATResult = await query(
    `SELECT SUM(credit) - SUM(debit) as total
     FROM journal_entry_lines jel
     INNER JOIN journal_entries je ON jel.journal_entry_id = je.id
     WHERE je.company_id = $1
     AND jel.account_number = 2610
     AND je.entry_date BETWEEN $2 AND $3`,
    [companyId, startDate, endDate]
  );
  
  // Ingående moms (purchase VAT)
  const incomingVATResult = await query(
    `SELECT SUM(debit) - SUM(credit) as total
     FROM journal_entry_lines jel
     INNER JOIN journal_entries je ON jel.journal_entry_id = je.id
     WHERE je.company_id = $1
     AND jel.account_number = 1630
     AND je.entry_date BETWEEN $2 AND $3`,
    [companyId, startDate, endDate]
  );
  
  const outgoingVAT = parseFloat(outgoingVATResult.rows[0]?.total || 0);
  const incomingVAT = parseFloat(incomingVATResult.rows[0]?.total || 0);
  
  return {
    period: {
      start: startDate,
      end: endDate
    },
    outgoing_vat: outgoingVAT,
    incoming_vat: incomingVAT,
    vat_to_pay: outgoingVAT - incomingVAT
  };
};

export const generateCustomerReport = async (
  companyId: string,
  startDate?: Date,
  endDate?: Date
) => {
  let queryText = `
    SELECT 
      c.id,
      c.name,
      COUNT(i.id) as invoice_count,
      SUM(i.total_amount) as total_sales,
      SUM(CASE WHEN i.status = 'paid' THEN i.total_amount ELSE 0 END) as paid_amount,
      SUM(CASE WHEN i.status IN ('sent', 'overdue') THEN i.total_amount - i.paid_amount ELSE 0 END) as outstanding_amount
    FROM customers c
    LEFT JOIN invoices i ON c.id = i.customer_id AND i.company_id = c.company_id
    WHERE c.company_id = $1
  `;
  
  const params: any[] = [companyId];
  let paramCount = 2;
  
  if (startDate) {
    queryText += ` AND (i.invoice_date >= $${paramCount} OR i.invoice_date IS NULL)`;
    params.push(startDate);
    paramCount++;
  }
  
  if (endDate) {
    queryText += ` AND (i.invoice_date <= $${paramCount} OR i.invoice_date IS NULL)`;
    params.push(endDate);
    paramCount++;
  }
  
  queryText += `
    GROUP BY c.id, c.name
    HAVING COUNT(i.id) > 0
    ORDER BY total_sales DESC
  `;
  
  const result = await query(queryText, params);
  
  return {
    period: startDate && endDate ? { start: startDate, end: endDate } : null,
    customers: result.rows.map(row => ({
      id: row.id,
      name: row.name,
      invoice_count: parseInt(row.invoice_count),
      total_sales: parseFloat(row.total_sales || 0),
      paid_amount: parseFloat(row.paid_amount || 0),
      outstanding_amount: parseFloat(row.outstanding_amount || 0)
    }))
  };
};
Implementera controllers och routes + frontend pages baserat på samma mönster.

🏗️ FAS 3: ENHANCED FUNCTIONALITY
Översikt

Tid: 8 veckor
Mål: Förbättrad funktionalitet och automationer
Output: AI-assistent, återkommande fakturor, projekt, integrationer


STEG 3.1: AI Chatbot Assistant
Instruktion:
Implementera AI-chatbot med Claude för att svara på ekonomiska frågor och hjälpa med systemet.
Service:
Filsökväg: backend/src/services/chatbotService.ts
typescriptimport Anthropic from '@anthropic-ai/sdk';
import { getCompanyById } from './companyService';
import { getInvoices } from './invoiceService';
import { getReceipts } from './receiptService';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export const chatWithAssistant = async (
  message: string,
  companyId: string,
  conversationHistory?: Array<{ role: string; content: string }>
) => {
  // Get company context
  const company = await getCompanyById(companyId);
  
  // Get recent data for context
  const recentInvoices = await getInvoices(companyId, {});
  const recentReceipts = await getReceipts(companyId, {});
  
  const systemPrompt = `Du är en AI-assistent för ett svenskt redovisningssystem. 
  
Din uppgift är att hjälpa användare med:
- Frågor om redovisning och bokföring
- Förklaringar av rapporter och siffror
- Hjälp med att navigera systemet
- Råd om ekonomisk planering
- Tolkning av data

Företagsinformation:
- Namn: ${company?.name}
- Org.nr: ${company?.org_number}

Senaste aktivitet:
- Antal fakturor: ${recentInvoices.length}
- Antal kvitton: ${recentReceipts.length}

Svara alltid på svenska och var hjälpsam och professionell.`;
  
  const messages: any[] = [];
  
  // Add conversation history
  if (conversationHistory) {
    messages.push(...conversationHistory);
  }
  
  // Add user message
  messages.push({
    role: 'user',
    content: message
  });
  
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    system: systemPrompt,
    messages
  });
  
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response');
  }
  
  return {
    message: textContent.text,
    conversation_history: [
      ...messages,
      {
        role: 'assistant',
        content: textContent.text
      }
    ]
  };
};

STEG 3.2: Recurring Invoices (Återkommande fakturor)
Migration:
sqlCREATE TABLE IF NOT EXISTS recurring_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    frequency VARCHAR(20) NOT NULL, -- 'monthly', 'quarterly', 'yearly'
    start_date DATE NOT NULL,
    end_date DATE,
    next_invoice_date DATE NOT NULL,
    last_invoice_id UUID REFERENCES invoices(id),
    is_active BOOLEAN DEFAULT true,
    template_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
Service inkluderar:

Create recurring invoice template
Automatisk generering via cron job
Pause/resume recurring invoices


STEG 3.3: Project/Time Tracking
Tables:

projects
time_entries
project_invoices

Features:

Track time per project
Assign hourly rates
Generate invoices from time entries
Project profitability


STEG 3.4-3.6: Integrations
Google Drive: Sync documents
Google Calendar: Sync events and reminders
Skatteverket: Submit VAT reports (requires special API access)

🏗️ FAS 4: ADVANCED FEATURES
Översikt

Tid: 12 veckor
Mål: Enterprise-funktioner
Output: Multi-company, bank integration, mobile app, advanced analytics


STEG 4.1: Multi-Company Management
Features:

Switch between companies
Consolidated reports
Cross-company transactions
Company groups


STEG 4.2: Bank Integration (Open Banking)
Features:

Connect bank accounts via Tink/similar
Auto-import transactions
Match transactions with invoices/receipts
Bank reconciliation


STEG 4.3: Mobile App (React Native)
Setup:
bashnpx react-native init RedovisningApp
Features:

View invoices
Scan receipts with camera
Dashboard on-the-go
Push notifications


STEG 4.4: Advanced Analytics

STEG 4.4: Advanced Analytics
Features:

Cash flow forecasting
Budget vs actual
KPI tracking
Custom reports
Data export


📦 DEPLOYMENT GUIDE
Production Deployment Checklist
Förberedelser:

Environment Variables

bash# Uppdatera .env för production
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@prod-db:5432/redovisning
REDIS_URL=redis://prod-redis:6379
JWT_SECRET=<generera-starkt-secret>
API_KEYS=<production-keys>

Database Migration

bash# Kör alla migrations i production
psql $DATABASE_URL < database/migrations/*.sql

Build Applications

bash# Frontend
cd frontend
npm run build

# Backend
cd backend
npm run build
Deployment till AWS:

Setup EC2 / ECS

yaml# docker-compose.prod.yml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "80:80"
    environment:
      - VITE_API_URL=https://api.yourcompany.com
  
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}

Setup RDS (PostgreSQL)


Create RDS instance
Security groups
Backup configuration


Setup S3


Create buckets for files
Configure CORS
Setup CloudFront CDN


Setup CloudWatch


Logging
Monitoring
Alerts

Deployment till Google Cloud:

Cloud Run för containers
Cloud SQL för PostgreSQL
Cloud Storage för filer
Cloud Monitoring

CI/CD med GitHub Actions:
Filsökväg: .github/workflows/deploy.yml
yamlname: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Build and push Docker images
        run: |
          docker build -t myapp/frontend:latest ./frontend
          docker build -t myapp/backend:latest ./backend
          docker push myapp/frontend:latest
          docker push myapp/backend:latest
      
      - name: Deploy to AWS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: task-definition.json
          service: redovisning-service
          cluster: production-cluster
Post-Deployment:

Verify all services

bashcurl https://api.yourcompany.com/health

Run smoke tests

bashnpm run test:e2e:prod

Setup monitoring alerts
Backup verification


🐛 TROUBLESHOOTING
Vanliga Problem och Lösningar
Problem: Database connection error
bashError: connect ECONNREFUSED 127.0.0.1:5432
Lösning:
bash# Kontrollera att PostgreSQL kör
docker ps | grep postgres

# Starta om container
docker-compose restart postgres

# Kolla logs
docker-compose logs postgres

Problem: Frontend can't connect to backend
bashError: Network Error
Lösning:
bash# Kontrollera VITE_API_URL i .env
echo $VITE_API_URL

# Kontrollera CORS i backend
# backend/src/app.ts ska ha:
app.use(cors({
  origin: process.env.FRONTEND_URL
}));

Problem: JWT token expired
Lösning:
typescript// Implementera token refresh logic
// frontend/src/services/api.ts
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      // Refresh token logic here
    }
    return Promise.reject(error);
  }
);

Problem: File upload fails
Lösning:
bash# Kontrollera S3 credentials
aws s3 ls s3://your-bucket

# Kontrollera file size limits
# backend/src/middleware/upload.ts
limits: {
  fileSize: 10 * 1024 * 1024 // 10MB
}

Problem: Slow queries
Lösning:
sql-- Analysera slow queries
EXPLAIN ANALYZE SELECT * FROM invoices WHERE company_id = '...';

-- Lägg till index
CREATE INDEX idx_invoices_company_date ON invoices(company_id, invoice_date);

-- Uppdatera statistik
ANALYZE invoices;

Problem: Memory leaks i React
Lösning:
typescript// Cleanup i useEffect
useEffect(() => {
  const subscription = api.subscribe();
  
  return () => {
    subscription.unsubscribe(); // Cleanup
  };
}, []);

Problem: AI OCR inte fungerar
Lösning:
bash# Kontrollera API key
echo $ANTHROPIC_API_KEY

# Testa API connection
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01"

# Kontrollera image format
# Endast JPEG, PNG stöds

💡 BEST PRACTICES
Kodkvalitet
1. TypeScript Strict Mode
json// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
2. Error Handling
typescript// Alltid hantera errors
try {
  await apiCall();
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation
  } else if (error instanceof NetworkError) {
    // Handle network
  } else {
    // Log and show generic error
    console.error(error);
    showError('Ett fel uppstod');
  }
}
3. Input Validation
typescript// Använd Zod för validation
const invoiceSchema = z.object({
  customer_id: z.string().uuid(),
  amount: z.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

// Validate innan save
const validatedData = invoiceSchema.parse(input);

Säkerhet
1. SQL Injection Prevention
typescript// ✅ Använd parameterized queries
await query('SELECT * FROM users WHERE id = $1', [userId]);

// ❌ Aldrig string concatenation
await query(`SELECT * FROM users WHERE id = '${userId}'`); // FARLIGT!
2. XSS Prevention
typescript// React gör detta automatiskt, men:
// ❌ Använd aldrig dangerouslySetInnerHTML utan sanitization
<div dangerouslySetInnerHTML={{ __html: userInput }} /> // FARLIGT!

// ✅ Använd text content
<div>{userInput}</div>
3. Authentication
typescript// Alltid verifiera token på backend
export const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

Performance
1. Database Optimization
sql-- Lägg till index på ofta använda kolumner
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);

-- Använd EXPLAIN för att analysera queries
EXPLAIN ANALYZE SELECT * FROM invoices WHERE status = 'sent';
2. React Optimization
typescript// Använd React.memo för dyra komponenter
export default React.memo(ExpensiveComponent);

// Använd useMemo för dyra beräkningar
const sortedData = useMemo(() => {
  return data.sort((a, b) => a.value - b.value);
}, [data]);

// Använd useCallback för callbacks
const handleClick = useCallback(() => {
  doSomething();
}, [dependency]);
3. API Optimization
typescript// Implementera caching
const cached = await redis.get(key);
if (cached) return JSON.parse(cached);

const data = await fetchFromDB();
await redis.setex(key, 3600, JSON.stringify(data));
return data;

Testing
1. Unit Tests
typescript// Testa business logic
describe('calculateInvoiceTotals', () => {
  it('should calculate correctly with VAT', () => {
    const lines = [
      { quantity: 2, unit_price: 100, vat_rate: 25 }
    ];
    const result = calculateInvoiceTotals(lines);
    expect(result.subtotal).toBe(200);
    expect(result.vat_amount).toBe(50);
    expect(result.total_amount).toBe(250);
  });
});
2. Integration Tests
typescript// Testa API endpoints
describe('POST /api/v1/invoices', () => {
  it('should create invoice', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send(validInvoiceData)
      .expect(201);
    
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('draft');
  });
});
3. E2E Tests
typescript// Testa hela flöden
test('user can create and send invoice', async ({ page }) => {
  await page.goto('/invoices/new');
  await page.fill('[name="customer"]', 'Test Customer');
  await page.fill('[name="amount"]', '1000');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/invoices\/\w+/);
});

📚 KOMPLETT ÖVERSIKT
Fas 0: Setup (1 vecka) ✅

 Projektinitalisering
 Databas setup
 Autentiseringssystem

Fas 1: Foundation (4 veckor) ✅

 User Management
 Company Settings
 Audit Log System

Fas 2: MVP Core (12 veckor)

 Customer CRM
 Supplier Management
 Article Management
 Invoice Module
 PDF Generation
 Email Service
 Receipt Management
 AI OCR Integration
 Accounting Module
 Dashboard
 Reports

Fas 3: Enhanced (8 veckor)

 AI Chatbot Assistant
 Recurring Invoices
 Project/Time Tracking
 Google Drive Integration
 Google Calendar Integration
 Skatteverket Integration

Fas 4: Advanced (12 veckor)

 Multi-Company Management
 Bank Integration (Open Banking)
 Mobile App (React Native)
 Advanced Analytics
 Budget & Forecasting
 Revisor Access Portal


🎯 UTVECKLINGSPROCESS
Daglig Rutin
Morgon:
"Kör daglig health check"
Under dagen:
"Implementera [modul-namn]"
"Kör tester"
"Fix issues"
"Commit ändringar"
Kväll:
"Granska dagens errors"
Veckorutin
Måndag:
"Kör veckovis kvalitetskontroll"
"Prioritera top issues"
Fredag:
"Kör security scan"
"Review veckan"
"Planera nästa vecka"
Före Release
Checklist:
"Kör pre-release checklist"
"Fix alla blockers"
"Deploy till staging"
"Kör smoke tests"
"Deploy till production"
"Verifiera production"

🔧 MAINTENANCE
Daglig Monitoring
Metrics att övervaka:

API response times
Error rates
Database connection pool
Memory usage
Disk space

Alerts:

Error rate > 5%
Response time > 2s
Database connections > 80%
Memory usage > 90%

Backup Strategy
Database:
bash# Daglig backup
0 2 * * * pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Retention: 30 dagar
find /backups -name "*.sql" -mtime +30 -delete
Files (S3):

Versioning enabled
Lifecycle policies
Cross-region replication

Updates
Dependencies:
bash# Veckovis check
npm outdated

# Update non-breaking
npm update

# Update major versions manuellt
npm install package@latest
Security Patches:
bash# Omedelbart för critical
npm audit fix

# Review och test först
npm audit

📖 DOKUMENTATION MAINTENANCE
Uppdatera Claude.md
När ny modul läggs till:
"Lägg till [modul-namn] implementation i Claude.md med komplett kod"
När något ändras:
"Uppdatera [modul-namn] i Claude.md med nya ändringar"
Varje release:
"Uppdatera version och changelog i Claude.md"

🎓 LÄRDOM FRÅN UTVECKLING
Vad fungerade bra

Claude Code - Automatisk filskapande sparade enormt med tid
Typad databas - TypeScript + Zod eliminerade många bugs
Testning från början - Hittade problem tidigt
Modulär struktur - Lätt att arbeta parallellt
Audit logging - Ovärderligt för debugging

Vad att undvika

Inte testa tillräckligt - Led till buggar i production
Dålig error handling - Svårt att debugga
Ingen dokumentation - Teammedlemmar förvirrade
Stort releases - Svårt att debugga när något går fel
Ignorera performance - Blev problem vid skalning


🚀 NÄSTA STEG
Du har nu:

✅ Komplett dokumentation i Claude.md
✅ Alla moduler beskrivna i detalj
✅ Testningsstrategier
✅ Deployment guide
✅ Best practices

Att göra:

Börja implementera från Fas 0:

"Skapa projektstrukturen enligt Fas 0"

Implementera en modul i taget:

"Implementera User Management enligt Fas 1, Steg 1"

Testa efter varje modul:

"Kör tester för [modul]"

Håll kvalitet hög:

"Kör veckovis kvalitetskontroll"

Commit regelbundet:

"Commit med message 'Add [feature]'"

🎊 SLUTORD
Detta är din kompletta guide för att bygga ett professionellt redovisningssystem från grunden.
Varför detta fungerar:

Komplett - Allt du behöver finns här
Strukturerat - Steg-för-steg, fas för fas
Testat - Baserat på beprövade metoder
Flexibelt - Anpassa efter dina behov
AI-optimerat - Claude Code kan implementera direkt

Support:
Om du kör fast:

Läs troubleshooting-sektionen
Kontrollera error logs
Be Claude Code om hjälp
Review tidigare implementation

Kontinuerlig förbättring:

Uppdatera Claude.md när du lär dig mer
Dokumentera lösningar på problem
Dela med teamet


📊 STATISTIK
Totalt i projektet:

45+ moduler att implementera
4 faser över 36 veckor
200+ filer att skapa
1000+ funktioner
1 komplett system 🎯

Uppskattad tid:

Med Claude Code: 36 veckor (9 månader)
Utan AI: 72+ veckor (18+ månader)
Tidsvinst: 50%+


✅ VERSION HISTORY
v2.0 - Claude Code Edition (2024-10-14)

✅ Omarbetad för Claude Code i VS Code
✅ All dokumentation i en fil
✅ Komplett implementation för Fas 0-2
✅ Översikt Fas 3-4
✅ Deployment och troubleshooting
✅ Best practices

v1.0 - Original (2024-10-14)

Webbläsarversion med separata dokument


🏁 SLUTSATS
Du är nu redo att bygga!
Första kommandot:
"Skapa projektstrukturen enligt Fas 0 i Claude.md"
Lycka till med ditt redovisningssystem! 🚀

Claude.md - Komplett projektdokumentation för AI-drivet redovisningssystem
Version 2.0 - Optimerad för Claude Code i Visual Studio Code
Skapad: 2024-10-14
Senast uppdaterad: 2024-10-14

END OF DOCUMENT
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