# Google Drive Integration - Setup Guide

Detta dokument beskriver hur du konfigurerar Google Drive-integrationen för att automatiskt synkronisera fakturor och kvitton till Google Drive.

## Översikt

Google Drive-integrationen möjliggör:
- **Automatisk synkronisering** av fakturor (PDF) till Google Drive
- **Automatisk synkronisering** av kvitton till Google Drive
- **Organiserad mappstruktur** med separata mappar för Fakturor och Kvitton
- **Synkstatus-spårning** för varje dokument
- **OAuth 2.0-autentisering** för säker åtkomst

## Steg 1: Skapa Google Cloud-projekt

1. Gå till [Google Cloud Console](https://console.cloud.google.com/)
2. Skapa ett nytt projekt eller välj ett befintligt
3. Aktivera **Google Drive API**:
   - Navigera till "APIs & Services" > "Library"
   - Sök efter "Google Drive API"
   - Klicka på "Enable"

## Steg 2: Konfigurera OAuth 2.0-klient

### 2.1 Skapa OAuth 2.0-credentials

1. Gå till "APIs & Services" > "Credentials"
2. Klicka på "Create Credentials" > "OAuth client ID"
3. Om du inte redan har konfigurerat OAuth consent screen, måste du göra det först:
   - Välj "External" för användartyp
   - Fyll i applikationsnamn: "Redovisningssystem"
   - Lägg till din e-postadress som support-email
   - Lägg till scopes:
     - `https://www.googleapis.com/auth/drive.file`
   - Lägg till testanvändare (din egen e-postadress)

### 2.2 Konfigurera OAuth-klienten

1. Application type: **Web application**
2. Name: "Redovisning Google Drive Integration"
3. **Authorized redirect URIs**:
   - För lokal utveckling: `http://localhost:3000/api/v1/integrations/google/callback`
   - För produktion: `https://your-domain.com/api/v1/integrations/google/callback`
4. Klicka på "Create"
5. **Kopiera Client ID och Client Secret** - du behöver dessa i nästa steg

## Steg 3: Konfigurera miljövariabler

### Backend (.env)

Lägg till följande i din `.env`-fil i backend-mappen:

```env
# Google Drive Integration
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/integrations/google/callback
```

**OBS:** Byt ut `your-client-id` och `your-client-secret` med dina faktiska värden från Google Cloud Console.

För produktion, uppdatera `GOOGLE_REDIRECT_URI` till din produktions-URL.

## Steg 4: Kör databasmigrering

Kör följande SQL-migration för att skapa nödvändiga databastabeller:

```bash
psql -U postgres -d redovisning -f database/migrations/010_google_drive_integration.sql
```

Eller om du använder en migreringsverktyg, kör migreringen enligt din standard-workflow.

### Migrationsfiler

Migreringen skapar två tabeller:
- `google_drive_credentials` - Lagrar OAuth-tokens per företag
- `google_drive_sync` - Spårar synkstatus för dokument

## Steg 5: Starta applikationen

1. **Backend:**
   ```bash
   cd backend
   npm install  # Installerar googleapis-paketet
   npm run dev
   ```

2. **Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

## Steg 6: Anslut Google Drive

1. Logga in på applikationen
2. Navigera till **Inställningar** > **Integrationer** (eller `/integrations`)
3. Klicka på **"Anslut Google Drive"**
4. Du kommer att omdirigeras till Googles inloggningssida
5. Logga in med ditt Google-konto
6. Godkänn behörigheterna som begärs
7. Du kommer att omdirigeras tillbaka till applikationen
8. Status bör nu visa **"Ansluten"**

## Användning

### Synkronisera fakturor

**Automatiskt:**
Efter att Google Drive är anslutet kan du synkronisera fakturor manuellt eller automatiskt.

**Manuellt via UI:**
1. Gå till en faktura
2. Klicka på **"Synkronisera"**-knappen (molnikon)
3. Fakturan laddas upp till Google Drive i mappen `Redovisning/Fakturor/`

**Programmatiskt via API:**
```bash
POST /api/v1/integrations/google/sync/invoice/:invoiceId
Authorization: Bearer <token>
```

### Synkronisera kvitton

**Manuellt via UI:**
1. Gå till ett kvitto
2. Klicka på **"Synkronisera"**-knappen
3. Kvittot laddas upp till Google Drive i mappen `Redovisning/Kvitton/`

**Programmatiskt via API:**
```bash
POST /api/v1/integrations/google/sync/receipt/:receiptId
Authorization: Bearer <token>
```

## API-endpoints

### Hämta auktoriserings-URL
```
POST /api/v1/integrations/google/auth
Body: { "companyId": "uuid" }
Response: { "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```

### OAuth callback
```
GET /api/v1/integrations/google/callback?code=xxx&state=companyId
```

### Kontrollera anslutningsstatus
```
GET /api/v1/integrations/google/status/:companyId
Response: {
  "connected": true,
  "stats": [
    { "document_type": "invoice", "sync_status": "synced", "count": 15 },
    { "document_type": "receipt", "sync_status": "synced", "count": 42 }
  ]
}
```

### Koppla från
```
POST /api/v1/integrations/google/disconnect/:companyId
```

### Synkronisera faktura
```
POST /api/v1/integrations/google/sync/invoice/:invoiceId
Response: {
  "message": "Invoice synced successfully",
  "driveFileId": "xxx",
  "driveFileName": "Faktura_2024001.pdf",
  "webViewLink": "https://drive.google.com/file/d/xxx/view"
}
```

### Synkronisera kvitto
```
POST /api/v1/integrations/google/sync/receipt/:receiptId
```

### Hämta synkstatus
```
GET /api/v1/integrations/google/sync/status/:documentType/:documentId
Response: {
  "syncStatus": {
    "id": "uuid",
    "drive_file_id": "xxx",
    "drive_file_name": "Faktura_2024001.pdf",
    "web_view_link": "https://...",
    "last_synced_at": "2024-11-06T10:00:00Z",
    "sync_status": "synced"
  }
}
```

### Lista synkroniserade dokument
```
GET /api/v1/integrations/google/sync/documents/:companyId
Response: {
  "documents": [
    {
      "id": "uuid",
      "document_type": "invoice",
      "document_id": "uuid",
      "drive_file_name": "Faktura_2024001.pdf",
      "web_view_link": "https://...",
      "last_synced_at": "2024-11-06T10:00:00Z",
      "sync_status": "synced",
      "document_name": "2024001"
    }
  ]
}
```

## Mappstruktur i Google Drive

När du ansluter till Google Drive skapas följande mappstruktur automatiskt:

```
Redovisning/                    (Root-mapp)
├── Fakturor/                   (Faktura-PDFs)
│   ├── Faktura_2024001.pdf
│   ├── Faktura_2024002.pdf
│   └── ...
└── Kvitton/                    (Kvitton/receipts)
    ├── receipt_abc123.pdf
    ├── receipt_def456.jpg
    └── ...
```

## Frontend-komponenter

### GoogleDriveConnect
Visar anslutningsstatus och statistik, med knappar för att ansluta/koppla från.

```tsx
import GoogleDriveConnect from '@/components/GoogleDriveConnect';

<GoogleDriveConnect companyId={companyId} />
```

### GoogleDriveSyncButton
Knapp för att synkronisera enskilda dokument med statusindikatorer.

```tsx
import GoogleDriveSyncButton from '@/components/GoogleDriveSyncButton';

<GoogleDriveSyncButton
  documentType="invoice"
  documentId={invoiceId}
  companyId={companyId}
  showStatus={true}
/>
```

### GoogleDriveSyncedDocuments
Lista över alla synkroniserade dokument med länkar till Google Drive.

```tsx
import GoogleDriveSyncedDocuments from '@/components/GoogleDriveSyncedDocuments';

<GoogleDriveSyncedDocuments companyId={companyId} />
```

## Hooks

### useGoogleDriveStatus
```tsx
const { data, isLoading } = useGoogleDriveStatus(companyId);
```

### useSyncInvoice
```tsx
const syncInvoice = useSyncInvoice();
await syncInvoice.mutateAsync(invoiceId);
```

### useSyncReceipt
```tsx
const syncReceipt = useSyncReceipt();
await syncReceipt.mutateAsync(receiptId);
```

### useSyncStatus
```tsx
const { data } = useSyncStatus('invoice', invoiceId);
```

### useSyncedDocuments
```tsx
const { data } = useSyncedDocuments(companyId);
```

## Felsökning

### "OAuth2 credentials not configured"
- Kontrollera att `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET` är satta i `.env`
- Starta om backend-servern efter att ha uppdaterat `.env`

### "Failed to obtain access tokens"
- Kontrollera att redirect URI i Google Cloud Console matchar `GOOGLE_REDIRECT_URI` i `.env`
- Kontrollera att Google Drive API är aktiverat i Google Cloud Console

### "Access denied to this company"
- Användaren har inte behörighet till det angivna företaget
- Kontrollera att användaren är kopplad till företaget i `user_companies`-tabellen

### Token har gått ut
- Tokens uppdateras automatiskt av backend
- Om problem kvarstår, koppla från och anslut igen

## Säkerhet

- **OAuth 2.0** används för säker autentisering
- **Refresh tokens** lagras krypterat i databasen
- **Tokens uppdateras automatiskt** innan de går ut
- **Scope** begränsas till `drive.file` (endast filer skapade av appen)
- **Användarverifiering** säkerställer att endast auktoriserade användare kan synkronisera dokument

## Produktionschecklista

Innan du går live med Google Drive-integrationen:

- [ ] Uppdatera `GOOGLE_REDIRECT_URI` till produktions-URL
- [ ] Lägg till produktions-URL i "Authorized redirect URIs" i Google Cloud Console
- [ ] Publicera OAuth consent screen (flytta från "Testing" till "Production")
- [ ] Verifiera att SSL/HTTPS är konfigurerat korrekt
- [ ] Testa OAuth-flödet i produktionsmiljön
- [ ] Säkerhetskopiera databastabellerna
- [ ] Sätt upp monitoring för API-fel och token-uppdateringar

## Begränsningar

- **Rate limits:** Google Drive API har rate limits. Se [Google Drive API Quotas](https://developers.google.com/drive/api/guides/limits)
- **Storage:** Använder företagets Google Drive-lagringsutrymme
- **Scope:** Endast filer skapade av appen är åtkomliga (inte hela Google Drive)

## Support

För problem eller frågor:
- Kontrollera [Google Drive API-dokumentationen](https://developers.google.com/drive)
- Granska loggar i backend-servern
- Kontakta support om problemet kvarstår
