# 🚀 FAS 4.1: Multi-Company Management - Quick Start Guide

## ✅ Setup Complete!

All code has been implemented and tested. Follow these steps to get the system running.

---

## 📋 Prerequisites

- Docker & Docker Compose (for PostgreSQL)
- Node.js 20+
- npm

---

## 🔧 Step 1: Start Database

```bash
# Start PostgreSQL, MongoDB, and Redis
docker-compose up -d

# Verify containers are running
docker ps
```

You should see three containers running:
- `redovisningssystem-postgres-1`
- `redovisningssystem-mongodb-1`
- `redovisningssystem-redis-1`

---

## 💾 Step 2: Run Database Migration

Run the migration script to create all necessary tables:

```bash
# Make script executable (if not already)
chmod +x scripts/run-migration-005.sh

# Run the migration
./scripts/run-migration-005.sh
```

Or manually:

```bash
# Find your postgres container name
POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -n 1)

# Run migration
docker exec -i $POSTGRES_CONTAINER psql -U postgres -d redovisning < database/migrations/005_multi_company_management.sql
```

**Expected output:**
```
✅ Migration completed successfully!

New tables created:
  - company_groups
  - company_group_members
  - cross_company_transactions
  - consolidated_report_configs
```

---

## 📦 Step 3: Install Dependencies

### Backend

```bash
cd backend
npm install
```

### Frontend

```bash
cd frontend
npm install
```

---

## 🏗️ Step 4: Build Projects (Optional)

### Backend

```bash
cd backend
npm run build
```

### Frontend

```bash
cd frontend
npm run build
```

---

## 🚀 Step 5: Start Applications

Open two terminal windows:

### Terminal 1 - Backend

```bash
cd backend
npm run dev
```

Backend will run on: **http://localhost:3000**

### Terminal 2 - Frontend

```bash
cd frontend
npm run dev
```

Frontend will run on: **http://localhost:5173**

---

## ✨ Step 6: Test the Features

### 1. Open your browser

Navigate to: **http://localhost:5173**

### 2. Available Pages

- **Home**: http://localhost:5173/
- **Company Groups**: http://localhost:5173/company-groups
- **Cross-Company Transactions**: http://localhost:5173/cross-company-transactions
- **Consolidated Reports**: http://localhost:5173/consolidated-reports

### 3. Company Switcher

You'll see the **CompanySwitcher** component in the top-right corner of the navigation bar. It allows you to:
- View all your companies
- See your role in each company
- Switch between companies with a single click

---

## 🧪 API Testing

### Create a Company Group

```bash
curl -X POST http://localhost:3000/api/v1/company-groups \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Swedish Companies",
    "description": "All companies in Sweden",
    "color": "#3b82f6"
  }'
```

### Create a Cross-Company Transaction

```bash
curl -X POST http://localhost:3000/api/v1/cross-company-transactions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from_company_id": "COMPANY_A_ID",
    "to_company_id": "COMPANY_B_ID",
    "transaction_type": "sale",
    "description": "Intercompany sale",
    "amount": 50000,
    "currency": "SEK",
    "transaction_date": "2025-01-15"
  }'
```

### Get All Transactions

```bash
curl http://localhost:3000/api/v1/cross-company-transactions \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Generate Consolidated Report

```bash
curl -X POST http://localhost:3000/api/v1/consolidated-reports/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "company_ids": ["COMPANY_A_ID", "COMPANY_B_ID"],
    "report_type": "profit_loss",
    "date_range_start": "2025-01-01",
    "date_range_end": "2025-03-31",
    "currency": "SEK"
  }'
```

---

## 📚 API Endpoints

### Company Groups

- `POST /api/v1/company-groups` - Create group
- `GET /api/v1/company-groups` - List groups
- `GET /api/v1/company-groups/:id` - Get group
- `PUT /api/v1/company-groups/:id` - Update group
- `DELETE /api/v1/company-groups/:id` - Delete group
- `POST /api/v1/company-groups/:id/companies` - Add company to group
- `DELETE /api/v1/company-groups/:id/companies/:companyId` - Remove company from group
- `GET /api/v1/company-groups/:id/companies` - List companies in group

### Cross-Company Transactions

- `POST /api/v1/cross-company-transactions` - Create transaction
- `GET /api/v1/cross-company-transactions` - List transactions (with filters)
- `GET /api/v1/cross-company-transactions/:id` - Get transaction
- `PUT /api/v1/cross-company-transactions/:id` - Update transaction
- `DELETE /api/v1/cross-company-transactions/:id` - Delete transaction
- `POST /api/v1/cross-company-transactions/:id/reconcile` - Reconcile transaction
- `GET /api/v1/cross-company-transactions/summary/:companyId` - Get summary

### Consolidated Reports

- `POST /api/v1/consolidated-reports/configs` - Create config
- `GET /api/v1/consolidated-reports/configs` - List configs
- `GET /api/v1/consolidated-reports/configs/:id` - Get config
- `PUT /api/v1/consolidated-reports/configs/:id` - Update config
- `DELETE /api/v1/consolidated-reports/configs/:id` - Delete config
- `POST /api/v1/consolidated-reports/generate` - Generate report
- `GET /api/v1/consolidated-reports/transactions` - Get transaction data

---

## 🎯 Features

### ✅ Implemented

- **Company Groups**: Create and manage groups of companies
- **Company Switcher**: Easy switching between companies in the UI
- **Cross-Company Transactions**: Track transactions between companies
- **Transaction Reconciliation**: Mark transactions as reconciled
- **Consolidated Reports**: Generate reports across multiple companies
- **Multi-currency Support**: Support for different currencies
- **Role-based Access Control**: Different permissions per company

### 📝 Database Tables

- `company_groups` - Company group definitions
- `company_group_members` - Many-to-many relationship
- `cross_company_transactions` - Inter-company transactions
- `consolidated_report_configs` - Saved report configurations

---

## 🔐 Authentication

All endpoints require authentication. Include your JWT token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

To get a token, first register/login:

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

---

## 🐛 Troubleshooting

### Database connection error

```bash
# Restart containers
docker-compose down
docker-compose up -d
```

### Port already in use

Change ports in `.env` and `docker-compose.yml`

### Migration already ran

The migration is idempotent - you can run it multiple times safely.

### Frontend not loading

```bash
cd frontend
rm -rf node_modules dist
npm install
npm run dev
```

---

## 📁 Project Structure

```
redovisningssystem/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── companyGroupController.ts
│   │   │   ├── crossCompanyTransactionController.ts
│   │   │   └── consolidatedReportController.ts
│   │   ├── services/
│   │   │   ├── companyGroupService.ts
│   │   │   ├── crossCompanyTransactionService.ts
│   │   │   └── consolidatedReportService.ts
│   │   ├── routes/
│   │   │   ├── companyGroups.ts
│   │   │   ├── crossCompanyTransactions.ts
│   │   │   └── consolidatedReports.ts
│   │   └── types/
│   │       ├── companyGroup.types.ts
│   │       ├── crossCompanyTransaction.types.ts
│   │       └── consolidatedReport.types.ts
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── CompanySwitcher.tsx
│   │   ├── contexts/
│   │   │   └── CompanyContext.tsx
│   │   ├── hooks/
│   │   │   ├── useCompanyGroup.ts
│   │   │   ├── useCrossCompanyTransaction.ts
│   │   │   └── useConsolidatedReport.ts
│   │   ├── pages/
│   │   │   ├── CompanyGroupsPage.tsx
│   │   │   ├── CrossCompanyTransactionsPage.tsx
│   │   │   └── ConsolidatedReportsPage.tsx
│   │   ├── services/
│   │   │   ├── companyGroupService.ts
│   │   │   ├── crossCompanyTransactionService.ts
│   │   │   └── consolidatedReportService.ts
│   │   └── types/
│   │       ├── companyGroup.types.ts
│   │       ├── crossCompanyTransaction.types.ts
│   │       └── consolidatedReport.types.ts
└── database/
    └── migrations/
        └── 005_multi_company_management.sql
```

---

## 🎉 Success!

You now have a fully functional multi-company management system!

For detailed documentation, see: `FAS4_STEP1_MULTI_COMPANY_COMPLETE.md`

---

**Need help?** Check the main README.md or the comprehensive documentation.
