# Email Service Setup Guide

## Översikt

Email-service använder Nodemailer för att skicka emails via SMTP. Systemet stöder:
- 📧 Faktura-emails med PDF-bifogning
- 👋 Välkomst-emails till nya användare
- 🔒 Lösenordsåterställning

## SMTP-konfiguration

### Gmail (Rekommenderat för development)

1. **Aktivera 2-Factor Authentication** på ditt Gmail-konto
2. **Generera App Password:**
   - Gå till [Google Account Security](https://myaccount.google.com/security)
   - Välj "App passwords"
   - Generera nytt lösenord för "Mail"
   - Kopiera det genererade lösenordet

3. **Uppdatera .env:**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=din-email@gmail.com
SMTP_PASS=din-app-password
EMAIL_FROM=noreply@dindomän.se
FRONTEND_URL=http://localhost:5173
```

### SendGrid (Rekommenderat för production)

1. **Skapa SendGrid-konto:** https://sendgrid.com
2. **Generera API Key**
3. **Uppdatera .env:**
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=din-sendgrid-api-key
EMAIL_FROM=noreply@dindomän.se
FRONTEND_URL=https://din-produktion-url.se
```

### Microsoft 365 / Outlook

```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=din-email@outlook.com
SMTP_PASS=ditt-lösenord
EMAIL_FROM=noreply@dindomän.se
FRONTEND_URL=http://localhost:5173
```

## Använda Email Service

### Skicka Faktura via Email

**Endpoint:** `POST /api/v1/invoices/:id/send`

**Request:**
```json
{
  "company_id": "uuid",
  "recipient_email": "kund@example.com",
  "recipient_name": "Kundnamn" // Optional, hämtas från customer om ej angiven
}
```

**Response:**
```json
{
  "message": "Invoice sent successfully",
  "sent_to": "kund@example.com"
}
```

**Funktioner:**
- ✅ Genererar PDF av fakturan
- ✅ Skickar email med PDF som bilaga
- ✅ Markerar faktura som "sent"
- ✅ Svensk email-mall med företagsinformation
- ✅ Betalningsinstruktioner med OCR-nummer
- ✅ Responsiv HTML-design

### Programmatisk Användning

```typescript
import * as emailService from './services/emailService';

// Skicka faktura
await emailService.sendInvoiceEmail(
  invoiceId,
  companyId,
  'kund@example.com',
  'Kundnamn'
);

// Välkomst-email
await emailService.sendWelcomeEmail(
  'user@example.com',
  'Användarnamn'
);

// Lösenordsåterställning
await emailService.sendPasswordResetEmail(
  'user@example.com',
  'Användarnamn',
  'reset-token-123'
);

// Verifiera SMTP-konfiguration
const isConfigured = await emailService.verifyEmailConfig();
if (isConfigured) {
  console.log('Email is ready to use!');
}
```

## Email-mallar

### Faktura Email

Innehåller:
- Företagslogotyp och information
- Fakturadetaljer (nummer, datum, förfallodag)
- Sammanfattningstabell
- Betalningsinformation (Bankgiro, OCR-nummer)
- PDF-bilaga
- Responsiv HTML-design

### Välkomst Email

Innehåller:
- Välkomstmeddelande
- Snabbstart-guide
- "Logga in"-knapp med länk till frontend
- Supportkontakt

### Lösenordsåterställning

Innehåller:
- Säker återställningslänk
- Tidsbegränsning (1 timme)
- Säkerhetsvarning
- Fallback-länk för kopiering

## Testning

### Manuell testning med cURL

```bash
# Skicka faktura (kräver giltig invoice ID och auth token)
curl -X POST http://localhost:3000/api/v1/invoices/{invoice-id}/send \
  -H "Authorization: Bearer {your-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "uuid",
    "recipient_email": "test@example.com",
    "recipient_name": "Test User"
  }'
```

### Automatiska tester

```bash
# Kör email-tester
npm test -- email.test.ts
```

**OBS:** Email-testerna kräver giltig SMTP-konfiguration för att passera fullt ut. Utan SMTP-config kommer vissa tester att skippas.

## Troubleshooting

### "Authentication failed"

**Problem:** SMTP-autentisering misslyckas

**Lösningar:**
- Kontrollera att SMTP_USER och SMTP_PASS är korrekta
- För Gmail: Använd App Password, inte vanligt lösenord
- Kontrollera att 2FA är aktiverat (Gmail)

### "Connection timeout"

**Problem:** Kan inte ansluta till SMTP-server

**Lösningar:**
- Kontrollera SMTP_HOST och SMTP_PORT
- Kontrollera firewall-inställningar
- Kontrollera nätverksanslutning

### "Certificate error"

**Problem:** SSL/TLS-certifikat fel

**Lösningar:**
- Använd port 587 med TLS (inte SSL)
- För development kan du sätta `secure: false` i transporter

### Email kommer inte fram

**Lösningar:**
- Kontrollera spam-mappen
- Verifiera att EMAIL_FROM är korrekt konfigurerad
- Kontrollera SendGrid/Gmail-loggar
- Testa med `verifyEmailConfig()` funktionen

## Säkerhet

### Best Practices

1. **Secrets Management:**
   - Använd aldrig SMTP-lösenord i kod
   - Lagra alltid i .env eller secrets manager
   - Rotera credentials regelbundet

2. **Email-validering:**
   - Validera email-adresser före sändning
   - Implementera rate limiting för email-endpoints
   - Logga alla email-försök

3. **Production:**
   - Använd dedikerad email-service (SendGrid, AWS SES)
   - Implementera email-verifiering för användare
   - Sätt upp SPF, DKIM, DMARC records
   - Använd egen domän för EMAIL_FROM

## Production Checklist

- [ ] Registrera professionell email-service (SendGrid, AWS SES)
- [ ] Konfigurera SPF record för domänen
- [ ] Konfigurera DKIM signing
- [ ] Konfigurera DMARC policy
- [ ] Testa email-leverans till olika providers (Gmail, Outlook, etc.)
- [ ] Implementera email-queue för stora volymer
- [ ] Sätt upp monitoring för email-fel
- [ ] Implementera bounce/complaint handling
- [ ] Konfigurera email-templates i extern service
- [ ] Testa responsivitet på olika email-klienter

## Kostnader (Production)

### SendGrid
- **Free:** 100 emails/dag
- **Essentials:** $19.95/månad - 50,000 emails
- **Pro:** $89.95/månad - 100,000 emails

### AWS SES
- **$0.10** per 1,000 emails
- **$0.12** per GB bifogningar
- Mycket kostnadseffektivt för stora volymer

### Mailgun
- **Free:** 5,000 emails/månad
- **Foundation:** $35/månad - 50,000 emails

## Support

För frågor om email-funktionaliteten:
1. Kontrollera denna dokumentation
2. Granska email-testerna i `src/tests/email.test.ts`
3. Läs Nodemailer-dokumentationen: https://nodemailer.com
4. Kontrollera SMTP-provider-dokumentationen
