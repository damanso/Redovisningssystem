# Redovisningssystem - AI-Drivet

Ett modernt redovisningssystem byggt med React, Node.js, PostgreSQL, MongoDB och Redis.

## 🚀 Snabbstart

### 1. Förutsättningar

- Node.js 20+
- Docker & Docker Compose
- Git

### 2. Installation

```bash
# Klona projektet
cd redovisningssystem

# Installera frontend dependencies
cd frontend
npm install

# Installera backend dependencies
cd ../backend
npm install
```

### 3. Miljövariabler

Kopiera `.env.example` till `.env` i både root, frontend och backend:

```bash
# I root
cp .env.example .env

# I backend
cp backend/.env.example backend/.env

# I frontend
cp frontend/.env.example frontend/.env
```

Uppdatera `.env`-filerna med dina egna värden (särskilt JWT_SECRET och API-nycklar).

### 4. Starta databaser

```bash
# I root-mappen
docker-compose up -d

# Verifiera att alla containers körs
docker ps
```

Du ska se tre containers: postgres, mongodb, och redis.

### 5. Kör databas-migrationer

```bash
# Kör initial schema
docker exec -i redovisningssystem-postgres-1 psql -U postgres -d redovisning < database/migrations/001_initial_schema.sql
```

### 6. Starta applikationen

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Backend körs på: http://localhost:3000
Frontend körs på: http://localhost:5173

## 🧪 Testning

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## 📁 Projektstruktur

```
redovisningssystem/
├── frontend/          # React frontend
├── backend/           # Node.js backend
├── database/          # SQL migrations
├── scripts/           # Utility scripts
└── docs/             # Documentation
```

## 🔧 Utveckling

### API Endpoints

- `POST /api/v1/auth/register` - Registrera ny användare
- `POST /api/v1/auth/login` - Logga in
- `GET /health` - Health check

### Databasstruktur

Se `database/migrations/001_initial_schema.sql` för fullständigt schema.

Huvudtabeller:
- `users` - Användarinformation
- `companies` - Företagsinformation
- `user_companies` - Koppling användare-företag

## 📝 Nästa steg

1. ✅ Fas 0: Setup och autentisering (KLAR)
2. 🔄 Fas 1: Foundation (User Management, Company Settings)
3. ⏳ Fas 2: MVP Core (Invoices, Receipts, AI OCR)
4. ⏳ Fas 3: Enhanced (Chatbot, Recurring, Integrations)
5. ⏳ Fas 4: Advanced (Multi-Company, Bank, Mobile)

Se `CLAUDE.md` för detaljerad utvecklingsplan.

## 🐛 Felsökning

### Databaser startar inte

```bash
docker-compose down -v
docker-compose up -d
```

### Port redan används

Ändra portar i `.env` och `docker-compose.yml`.

### Migration error

Se till att postgres-containern heter rätt:
```bash
docker ps
# Använd rätt container-namn i migration-kommandot
```

## 📄 Licens

Proprietär - Alla rättigheter förbehålles
