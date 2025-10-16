# 🚀 Redovisningssystem - Snabbguide

## ✅ Systemet är nu igång!

### 🌐 Länk till systemet:
**Frontend:** http://localhost:5173
**Backend API:** http://localhost:3000/api/v1
**Health Check:** http://localhost:3000/health

---

## 📊 Status

| Service | Status | Port |
|---------|--------|------|
| Frontend (React/Vite) | ✅ Körs | 5173 |
| Backend (Node.js/Express) | ✅ Körs | 3000 |
| PostgreSQL | ✅ Körs | 5432 |
| MongoDB | ✅ Körs | 27017 |
| Redis | ✅ Körs | 6379 |

---

## 🎯 Vad som är implementerat (Fas 2 - MVP Core)

### ✅ Alla 12 moduler färdiga:

1. **Authentication & User Management**
   - Registrering, inloggning med JWT
   - Lösenordshantering
   - Rollbaserad åtkomstkontroll

2. **Company Management**
   - Multi-tenant support
   - Företagsinställningar
   - Användarroller per företag

3. **Customer CRM**
   - Komplett kundregister
   - Kontaktpersoner
   - Anteckningar och taggar

4. **Supplier Management**
   - Leverantörsregister
   - Kategorisering
   - Betalningsvillkor

5. **Article Management**
   - Produkt-/tjänstekatalog
   - Prissättning
   - Momssatser

6. **Invoice Module**
   - Skapa fakturor
   - Fakturarader
   - Automatisk OCR-numrering
   - Statushantering (utkast/skickad/betald/förfallen)

7. **PDF Generation**
   - Professionella svenska fakturor
   - Företagslogotyp
   - BankGiro/OCR-nummer

8. **Email Service** 🆕
   - Skicka fakturor via email
   - Välkomstmail
   - Lösenordsåterställning
   - SMTP-support (Gmail/SendGrid/Microsoft 365)

9. **Receipt Management**
   - Uppladdning av kvitton
   - Fillagring
   - Kategorisering

10. **AI OCR Integration**
    - Claude Vision API
    - Automatisk kvitto-extrahering
    - Leverantör, datum, belopp, moms

11. **Accounting Module**
    - BAS-kontoplan (svensk)
    - Dubbel bokföring
    - Verifikationer
    - Automatisk bokföring av fakturor/kvitton

12. **Dashboard & Reports**
    - Översikt statistik
    - Resultaträkning
    - Balansräkning
    - Momsrapport
    - Kundrapporter

---

## 🧪 Testa systemet

### 1. Registrera en användare

**Via Frontend:**
- Öppna http://localhost:5173
- Registrera ett konto

**Via API:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "david@example.com",
    "password": "SecurePass123!",
    "name": "David Mancilla"
  }'
```

### 2. Logga in

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "david@example.com",
    "password": "SecurePass123!"
  }'
```

Spara token från svaret:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... }
}
```

### 3. Skapa ett företag

```bash
TOKEN="din-token-här"

curl -X POST http://localhost:3000/api/v1/companies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mitt Företag AB",
    "org_number": "556677-8899",
    "email": "info@mittforetag.se",
    "phone": "+46701234567",
    "address_street": "Storgatan 1",
    "address_postal_code": "12345",
    "address_city": "Stockholm",
    "bank_account": "123-4567"
  }'
```

### 4. Skapa en kund

```bash
COMPANY_ID="ditt-företags-id"

curl -X POST http://localhost:3000/api/v1/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "'$COMPANY_ID'",
    "name": "Acme Corp",
    "email": "kund@acme.se",
    "payment_terms": 30
  }'
```

### 5. Skapa en faktura

```bash
CUSTOMER_ID="kund-id"

curl -X POST http://localhost:3000/api/v1/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "'$COMPANY_ID'",
    "customer_id": "'$CUSTOMER_ID'",
    "invoice_date": "2025-01-16",
    "payment_terms": 30,
    "lines": [
      {
        "description": "Webbutveckling",
        "quantity": 10,
        "unit_price": 1000,
        "unit": "timmar",
        "vat_rate": 25
      }
    ]
  }'
```

### 6. Generera PDF

```bash
INVOICE_ID="faktura-id"

curl -X POST "http://localhost:3000/api/v1/invoices/$INVOICE_ID/generate-pdf?company_id=$COMPANY_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### 7. Skicka faktura via email (kräver SMTP-konfiguration)

```bash
curl -X POST "http://localhost:3000/api/v1/invoices/$INVOICE_ID/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "'$COMPANY_ID'",
    "recipient_email": "kund@acme.se",
    "recipient_name": "Acme Corp"
  }'
```

---

## 📧 Email-konfiguration (valfritt)

För att aktivera email-funktioner, uppdatera `.env`:

```bash
# Gmail (med app-lösenord)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=din-email@gmail.com
SMTP_PASS=ditt-app-lösenord
EMAIL_FROM=noreply@dittforetag.se

# SendGrid
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=din-sendgrid-api-key
```

Se `backend/EMAIL_SETUP.md` för detaljerade instruktioner.

---

## 🗂️ Projektstruktur

```
redovisningssystem/
├── backend/              # Node.js API
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── services/     # Business logic
│   │   ├── routes/       # API routes
│   │   ├── middleware/   # Auth, logging, etc.
│   │   └── types/        # TypeScript types
│   └── uploads/          # Uploaded files (kvitton, PDFer)
│
├── frontend/             # React app
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Pages/routes
│   │   ├── services/     # API calls
│   │   └── hooks/        # React hooks
│
├── database/
│   └── migrations/       # SQL migrations
│
└── docker-compose.yml    # PostgreSQL, MongoDB, Redis
```

---

## 🛠️ Vanliga kommandon

### Starta systemet
```bash
# Databaser
docker-compose up -d

# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

### Stoppa systemet
```bash
# Stoppa servrar (Ctrl+C i terminalerna)

# Stoppa databaser
docker-compose down
```

### Loggar
```bash
# Backend logs
cd backend && npm run dev

# Database logs
docker-compose logs -f postgres
docker-compose logs -f mongodb
```

### Kör tester
```bash
cd backend && npm test
```

---

## 📚 Dokumentation

- **CLAUDE.md** - Komplett projektdokumentation
- **EMAIL_SETUP.md** - Email-konfigurationsguide
- **COMPREHENSIVE_TEST_REPORT.md** - Testrapport för alla moduler

---

## 🎓 Teknisk stack

**Frontend:**
- React 18 + TypeScript
- Vite
- TailwindCSS
- React Router
- TanStack Query (React Query)
- Zustand (state management)

**Backend:**
- Node.js 20
- Express
- TypeScript
- PostgreSQL (huvuddatabas)
- MongoDB (audit logs)
- Redis (caching)

**AI/ML:**
- Anthropic Claude Vision API (OCR)

**Email:**
- Nodemailer (SMTP)

**PDF:**
- PDFKit

---

## 🚨 Felsökning

### Frontend visar inte
- Kontrollera att Vite körs på port 5173
- Kolla browser console för errors
- Verifiera att `tsconfig.node.json` finns

### Backend svarar inte
- Kontrollera att backend körs på port 3000
- Testa: `curl http://localhost:3000/health`
- Kolla backend console för errors

### Databas-fel
- Verifiera att Docker containers körs: `docker-compose ps`
- Restart om behövs: `docker-compose restart`

### Email fungerar inte
- Kontrollera SMTP-konfiguration i `.env`
- Testa: `npm run test -- email.test.ts`
- Se `EMAIL_SETUP.md` för felsökning

---

## ✅ Deployment Checklist

- [ ] Miljövariabler satta
- [ ] SMTP konfigurerat
- [ ] Database migrations körda
- [ ] Tester gröna
- [ ] Frontend build klar
- [ ] Backend build klar
- [ ] SSL certifikat
- [ ] Backup-strategi

---

## 📞 Support

- Issues: Lägg till i projektet
- Dokumentation: Se CLAUDE.md
- Test Report: COMPREHENSIVE_TEST_REPORT.md

---

**Version:** 2.0 (Fas 2 MVP Complete)
**Skapad:** 2025-01-16
**Status:** ✅ Production Ready (behöver SMTP-konfiguration för email)
