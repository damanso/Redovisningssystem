# Recurring Invoices Implementation - Complete

## Översikt

En komplett implementering av återkommande fakturor (Recurring Invoices) har implementerats från början till slut enligt specifikationen för Fas 3.2.

## Implementerade komponenter

### 1. Database Migration ✅
**Fil:** `database/migrations/010_recurring_invoices.sql`

Innehåller:
- `recurring_invoices` - Huvudtabell för återkommande fakturor
- `recurring_invoice_lines` - Mallar för fakturaraderna
- `recurring_invoice_history` - Historik över genererade fakturor
- Indexeringar för optimal prestanda
- Triggers för automatisk uppdatering av `updated_at`
- Hjälpfunktion `calculate_next_generation_date()` för datumberäkning

**Funktioner:**
- Stöd för olika frekvenser: daglig, veckovis, månadsvis, kvartalsvis, årlig
- Intervallinställningar (t.ex. var 2:a månad)
- Start- och slutdatum
- Max antal genereringar
- Status: active, paused, completed, cancelled

### 2. Backend Types ✅
**Fil:** `backend/src/types/recurringInvoice.types.ts`

Definierar TypeScript-typer för:
- `RecurringInvoice` - Huvudtyp
- `RecurringInvoiceLine` - Fakturaradsmall
- `RecurringInvoiceHistory` - Historikpost
- `CreateRecurringInvoiceDto` - Skapa ny
- `UpdateRecurringInvoiceDto` - Uppdatera befintlig
- `RecurringInvoiceStats` - Statistik
- Enums för `RecurringFrequency` och `RecurringStatus`

### 3. Backend Service Layer ✅
**Fil:** `backend/src/services/recurringInvoiceService.ts`

Implementerade funktioner:
- `createRecurringInvoice()` - Skapa ny återkommande faktura med rader
- `getRecurringInvoices()` - Hämta alla med filtrering (kund, status, sökning)
- `getRecurringInvoiceById()` - Hämta specifik med alla detaljer
- `updateRecurringInvoice()` - Uppdatera befintlig med omberäkning av nästa datum
- `generateInvoiceFromRecurring()` - Generera ny faktura från mall
- `pauseRecurringInvoice()` - Pausa automatisk generering
- `resumeRecurringInvoice()` - Återuppta automatisk generering
- `cancelRecurringInvoice()` - Avbryt återkommande faktura
- `deleteRecurringInvoice()` - Ta bort helt
- `getRecurringInvoiceHistory()` - Hämta historik över genererade fakturor
- `getRecurringInvoiceStats()` - Hämta statistik
- `processDueRecurringInvoices()` - Bearbeta alla förfallna (för cron)
- `calculateNextGenerationDate()` - Hjälpfunktion för datumberäkning

**Funktioner:**
- Transaktionsstöd för dataintegritet
- Automatisk beräkning av nästa genereringsdatum
- Kontroll av maxgränser (antal och slutdatum)
- Automatisk statusuppdatering till "completed" vid gräns
- Audit logging för alla operationer

### 4. Backend Controller & Routes ✅
**Filer:**
- `backend/src/controllers/recurringInvoiceController.ts`
- `backend/src/routes/recurringInvoices.ts`

**Endpoints:**
```
GET    /api/v1/recurring-invoices              - Lista alla
GET    /api/v1/recurring-invoices/stats        - Hämta statistik
GET    /api/v1/recurring-invoices/:id          - Hämta specifik
GET    /api/v1/recurring-invoices/:id/history  - Hämta historik
POST   /api/v1/recurring-invoices              - Skapa ny
PUT    /api/v1/recurring-invoices/:id          - Uppdatera
DELETE /api/v1/recurring-invoices/:id          - Ta bort
POST   /api/v1/recurring-invoices/:id/generate - Generera faktura nu
POST   /api/v1/recurring-invoices/:id/pause    - Pausa
POST   /api/v1/recurring-invoices/:id/resume   - Återuppta
POST   /api/v1/recurring-invoices/:id/cancel   - Avbryt
```

Alla endpoints är autentiserade och företagsisolerade.

### 5. Cron Job för Automatisk Generering ✅
**Fil:** `backend/src/services/cronScheduler.ts`

**Funktioner:**
- Körs dagligen kl 02:00 (svensk tid)
- Hittar alla aktiva återkommande fakturor som är förfallna
- Genererar fakturor automatiskt
- Loggar resultat och fel
- Graceful shutdown-hantering
- Manuell trigger-funktion för testning

**Integration:**
- Initieras automatiskt vid serverstart (`server.ts`)
- Stoppas vid serveravstängning

### 6. Frontend Types ✅
**Fil:** `frontend/src/types/recurringInvoice.types.ts`

Samma struktur som backend för konsekvent typning.

### 7. Frontend Service ✅
**Fil:** `frontend/src/services/recurringInvoiceService.ts`

API-klientfunktioner för alla endpoints med axios.

### 8. Frontend Hooks ✅
**Fil:** `frontend/src/hooks/useRecurringInvoice.ts`

React Query hooks:
- `useRecurringInvoices()` - Lista med filtrering
- `useRecurringInvoice()` - Hämta specifik
- `useRecurringInvoiceHistory()` - Hämta historik
- `useRecurringInvoiceStats()` - Hämta statistik
- `useCreateRecurringInvoice()` - Skapa ny
- `useUpdateRecurringInvoice()` - Uppdatera
- `useDeleteRecurringInvoice()` - Ta bort
- `useGenerateInvoice()` - Generera faktura
- `usePauseRecurringInvoice()` - Pausa
- `useResumeRecurringInvoice()` - Återuppta
- `useCancelRecurringInvoice()` - Avbryt

Alla hooks hanterar cache-invalidering automatiskt.

### 9. Frontend Pages ✅
**Filer:**
- `frontend/src/pages/recurring-invoices/RecurringInvoiceListPage.tsx`
- `frontend/src/pages/recurring-invoices/RecurringInvoiceFormPage.tsx`
- `frontend/src/pages/recurring-invoices/RecurringInvoiceDetailPage.tsx`

**Funktioner i List Page:**
- Visar alla återkommande fakturor i tabell
- Statistikpanel (totalt, aktiva, pausade, genererade, väntande)
- Sökning och filtrering efter status
- Snabbåtgärder: Generera, Pausa/Återuppta, Redigera, Ta bort
- Status-badges med färgkodning

**Funktioner i Form Page:**
- Skapa ny eller redigera befintlig
- Välj kund från dropdown
- Konfigurera frekvens och intervall
- Ange start/slutdatum och max antal
- Betalningsvillkor och referens
- Dynamisk hantering av fakturaradsmall
- Validering av obligatoriska fält

**Funktioner i Detail Page:**
- Visa alla detaljer om återkommande faktura
- Detaljer om schema och status
- Visa fakturarader med beräknade totaler
- Åtgärdsknappar (Generera, Pausa, Återuppta, Avbryt, Redigera)
- Historik över genererade fakturor med länkar
- Period-information för varje genererad faktura

### 10. Integration Tests ✅
**Fil:** `backend/src/tests/recurringInvoice.test.ts`

**Täcker:**
- Skapa återkommande faktura
- Validering av obligatoriska fält
- Lista och filtrering
- Sökning
- Hämta specifik
- Uppdatera
- Generera faktura från mall
- Pausa och återuppta
- Hämta historik
- Hämta statistik
- Avbryt
- Ta bort
- Validering av avbruten status

**Testtäckning:** 14 testfall

## Teknisk Stack

**Backend:**
- Node.js + TypeScript
- Express.js för API
- PostgreSQL för databas
- node-cron för schemalagda jobb
- Jest för testning

**Frontend:**
- React + TypeScript
- React Query för state management
- Axios för API-anrop
- TailwindCSS för styling

## Installation

1. **Kör migration:**
```bash
cd database
psql -U postgres -d redovisning < migrations/010_recurring_invoices.sql
```

2. **Installera backend-beroenden:**
```bash
cd backend
npm install
```

3. **Starta backend (cron job startar automatiskt):**
```bash
npm run dev
```

4. **Tester:**
```bash
npm test -- recurringInvoice.test.ts
```

## Användning

### Skapa återkommande faktura via API

```bash
POST /api/v1/recurring-invoices
{
  "customer_id": "uuid",
  "template_name": "Månadsprenumeration",
  "frequency": "monthly",
  "interval_count": 1,
  "start_date": "2025-01-01",
  "payment_terms": 30,
  "lines": [
    {
      "description": "Premium-abonnemang",
      "quantity": 1,
      "unit_price": 999.00,
      "unit": "st",
      "vat_rate": 25.00
    }
  ]
}
```

### Manuell trigger av cron job

```typescript
import * as cronScheduler from './services/cronScheduler';

const result = await cronScheduler.runRecurringInvoiceJob();
console.log(`Processed: ${result.processed}, Succeeded: ${result.succeeded}`);
```

## Databasschema

### recurring_invoices
- `id` - UUID primärnyckel
- `company_id` - Företag (FK)
- `customer_id` - Kund (FK)
- `template_name` - Mallnamn
- `payment_terms` - Betalningsvillkor
- `frequency` - Frekvens (daily/weekly/monthly/quarterly/yearly)
- `interval_count` - Intervallmultiplikator
- `start_date` - Startdatum
- `end_date` - Slutdatum (optional)
- `next_generation_date` - Nästa genereringsdatum
- `status` - Status (active/paused/completed/cancelled)
- `last_generated_date` - Senast genererad
- `generated_count` - Antal genererade
- `max_occurrences` - Max antal (optional)

### recurring_invoice_lines
- Mallar för fakturaraderna
- Kopplade till recurring_invoices

### recurring_invoice_history
- Historik över genererade fakturor
- Länkar till både recurring_invoices och invoices

## Statusflöden

```
active -> paused -> active (kan växlas)
active -> cancelled (permanent)
active -> completed (automatiskt vid gräns)
paused -> cancelled (permanent)
```

## Automatisk Generering

Cron-jobbet körs dagligen kl 02:00 och:
1. Hittar alla aktiva recurring_invoices där next_generation_date <= idag
2. För varje:
   - Skapar en ny faktura med invoice-service
   - Uppdaterar next_generation_date
   - Ökar generated_count
   - Sparar i history-tabellen
   - Kontrollerar om status ska ändras till "completed"
3. Loggar resultat och fel

## Säkerhetsåtgärder

- Alla endpoints kräver autentisering
- Företagsisolering (users kan bara se sina egna företags data)
- Transaktioner för dataintegritet
- Validering av input
- Audit logging för alla åtgärder

## Prestanda

- Indexerade kolumner för snabba sökningar
- Paginering för stora listor
- Effektiv JOIN-queries
- Cache-hantering i frontend med React Query

## Status: KOMPLETT ✅

Alla komponenter från specifikationen är implementerade och testade:
- ✅ Migration
- ✅ Types
- ✅ Service layer
- ✅ Controller + Routes
- ✅ Cron job
- ✅ Frontend implementation
- ✅ Tests

Systemet är produktionsredo!
