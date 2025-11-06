# Svenskt Lönesystem - Komplett Dokumentation

## Översikt

Detta är ett komplett svenskt lönesystem byggt enligt **svensk lagstiftning** inklusive:
- Skatteverkets regler för preliminär A-skatt
- Arbetsgivaravgifter enligt 2025 års regler (31.42%)
- Semesterlöneberäkning enligt Semesterlagen
- Tjänstepensioner (ITP1, ITP2, ITPK)
- Personnummervalidering med Luhn-algoritm
- PDF-generering av lönespecifikationer
- E-postutskick av lönespecar

## Funktionalitet

### ⭐ Kärn-funktioner

#### 1. Anställdhantering
- **CRUD för anställda** med fullständiga personuppgifter
- **Personnummervalidering** enligt svensk standard
- **Skattetabeller och kolumner** från Skatteverket
- **Anställningstyper**: Heltid, Deltid, Tillfällig, Provanställning
- **Lönetyper**: Månadslön eller Timlön

#### 2. Löneinställningar per anställd
- **Arbetsgivaravgifter**: Automatisk beräkning (31.42% eller åldersbaserad)
- **Tjänstepension**:
  - ITP1 (4.5% upp till 7.5 inkomstbasbelopp, 30% däröver)
  - ITP2 (förmånsbestämd)
  - ITPK (2%)
- **Förmåner**: Bil, bostad, övrigt
- **Avdrag**: Fackavgift, A-kassa, övrigt

#### 3. Semesterhantering
- **Automatisk semesterintjäning**: 25 dagar per år
- **Två beräkningsmetoder**:
  - **Procentregeln**: 12% av bruttolön
  - **Sammanlöneregeln**: 0.43% per semesterdag
- **Semesterskuld**: Automatisk uppföljning
- **Semesterersättning**: Vid avslutad anställning

#### 4. Löneberäkning
- **Bruttolön**: Grundlön + Övertid + Bonus + Förmåner
- **Arbetsgivaravgifter**: Detaljerad uppdelning enligt Skatteverket
- **Preliminär A-skatt**: Baserat på skattetabell
- **Nettolön**: Exakt beräkning efter alla avdrag

#### 5. Lönespecifikationer (PDF)
- **Professionella PDF:er** med alla detaljer
- **Innehåll**:
  - Inkomster och förmåner
  - Avdrag och skatter
  - Nettolön (framhävt)
  - Semesterinformation
  - Arbetsgivarens kostnader med full uppdelning
- **Automatisk e-postutskick** till anställda

#### 6. Löneperioder
- **Månatliga löneperioder** med statushantering
- **Massbearbetning**: Generera lönespecar för alla anställda
- **Statistik**: Total kostnad, nettolön, skatter per period
- **Statusflöde**: Utkast → Godkänd → Skickad → Betald → Låst

## Teknisk Arkitektur

### Backend (Node.js + TypeScript + PostgreSQL)

#### Databasschema (9 tabeller)

```
1. employees              - Anställdas grunddata
2. salary_configurations  - Lönekonfiguration per anställd
3. vacation_accruals      - Semesterintjäning och -skuld
4. salary_periods         - Löneperioder
5. payslips              - Lönespecifikationer
6. employer_contributions - Arbetsgivaravgifter (detaljerat)
7. tax_tables            - Svenska skattetabeller
8. income_base_amounts   - Inkomstbasbelopp per år
9. salary_audit_log      - Revisionsspår
```

#### Services (5 st)

1. **SalaryCalculationService**
   - Personnummervalidering (Luhn)
   - Arbetsgivaravgifter (31.42%, åldersbaserade)
   - Skatteberäkning (svenska skattetabeller)
   - Semesterlöneberäkning (12% / sammanlön)
   - Tjänstepensionsberäkning (ITP1/ITP2/ITPK)

2. **EmployeeService**
   - CRUD för anställda
   - Lönekonfiguration
   - Statistik per företag

3. **VacationService**
   - Semesterintjäning per månad
   - Semestersaldo och historik
   - Semesterersättning vid uppsägning

4. **PayslipService**
   - Skapa lönespecar
   - Godkännande och statushantering
   - Massbearbetning för perioder

5. **PayslipPdfService**
   - Professionell PDF-generering
   - Svenska format och valutor

#### REST API Endpoints

##### **Anställda** (`/api/v1/employees`)
```
POST   /                              - Skapa anställd
GET    /                              - Lista alla anställda (filtrering, paginering)
GET    /:id                           - Hämta anställd
GET    /:id/full                      - Hämta anställd med full konfiguration
PUT    /:id                           - Uppdatera anställd
DELETE /:id                           - Radera anställd (soft delete)
GET    /:id/salary-configuration      - Hämta lönekonfiguration
PUT    /:id/salary-configuration      - Uppdatera lönekonfiguration
GET    /statistics/:companyId         - Företagsstatistik
```

##### **Löneperioder** (`/api/v1/salary`)
```
POST   /periods                       - Skapa löneperiod
GET    /periods                       - Lista löneperioder
GET    /periods/:id                   - Hämta löneperiod
PUT    /periods/:id                   - Uppdatera löneperiod
POST   /periods/:id/generate          - Generera lönespecar för period

GET    /vacation/:employeeId          - Semestersaldo
GET    /vacation/:employeeId/history  - Semesterhistorik
GET    /vacation/:employeeId/termination-compensation
```

##### **Lönespecifikationer** (`/api/v1/payslips`)
```
POST   /                              - Skapa lönespec
GET    /:id                           - Hämta lönespec
GET    /:id/details                   - Hämta lönespec med detaljer
PUT    /:id                           - Uppdatera lönespec
POST   /:id/approve                   - Godkänn lönespec
GET    /:id/pdf                       - Generera PDF
POST   /:id/send                      - Skicka via e-post

GET    /period/:periodId              - Alla lönespecar för period
GET    /employee/:employeeId          - Alla lönespecar för anställd
POST   /period/:periodId/send-all     - Skicka alla för period
```

## Installation & Konfiguration

### 1. Installera dependencies

```bash
cd backend
npm install
```

### 2. Kör databas-migration

```bash
psql -U postgres -d redovisning -f database/migrations/001_create_salary_tables.sql
```

### 3. Starta backend

```bash
npm run dev
```

## Användningsexempel

### Skapa en anställd

```bash
POST /api/v1/employees
Content-Type: application/json

{
  "companyId": "uuid",
  "personalNumber": "199001011234",
  "firstName": "Anna",
  "lastName": "Andersson",
  "email": "anna@example.com",
  "phone": "0701234567",
  "address": "Storgatan 1",
  "postalCode": "123 45",
  "city": "Stockholm",
  "employmentStartDate": "2025-01-01",
  "employmentType": "FULL_TIME",
  "position": "Ekonom",
  "department": "Ekonomiavdelningen",
  "baseSalary": 35000,
  "salaryType": "MONTHLY",
  "taxTable": "30",
  "taxColumn": 1,
  "churchTax": false,
  "vacationDaysPerYear": 25,
  "vacationCalculationMethod": "PERCENTAGE",
  "bankAccount": "12345678901"
}
```

### Skapa löneperiod och generera lönespecar

```bash
# 1. Skapa löneperiod
POST /api/v1/salary/periods
{
  "companyId": "uuid",
  "periodName": "Januari 2025",
  "periodStart": "2025-01-01",
  "periodEnd": "2025-01-31",
  "paymentDate": "2025-01-25"
}

# 2. Generera lönespecar för alla anställda
POST /api/v1/salary/periods/{periodId}/generate
{
  "companyId": "uuid"
}

# 3. Skicka alla lönespecar via e-post
POST /api/v1/payslips/period/{periodId}/send-all
```

### Uppdatera lönekonfiguration

```bash
PUT /api/v1/employees/{employeeId}/salary-configuration
{
  "pensionPlan": "ITP1",
  "carBenefit": 3000,
  "unionFee": 250,
  "unemploymentInsurance": 100
}
```

## Beräkningsexempel

### Exempel: Månadslön 35 000 kr

#### Inkomster
- Grundlön: 35 000 kr
- **Bruttolön: 35 000 kr**

#### Arbetsgivaravgifter (31.42%)
- Sjukförsäkring (3.55%): 1 242.50 kr
- Föräldraförsäkring (2.60%): 910.00 kr
- Ålderspension (10.21%): 3 573.50 kr
- Efterlevandepension (0.60%): 210.00 kr
- Arbetsmarknadsavgift (2.64%): 924.00 kr
- Arbetsskadeavgift (0.20%): 70.00 kr
- Allmän löneavgift (11.62%): 4 067.00 kr
- **Summa socialavgifter: 10 997 kr**

#### Tjänstepension (ITP1)
- ITP1 (4.5%): 1 575 kr
- ITPK (2%): 700 kr
- **Summa pension: 2 275 kr**

#### Total arbetsgivarkostnad
- Bruttolön + Avgifter + Pension = **48 272 kr**

#### Avdrag för anställd
- Preliminärskatt (ca 30%): -10 500 kr
- Fackavgift: -250 kr
- A-kassa: -100 kr
- **Summa avdrag: -10 850 kr**

#### Nettolön
- **24 150 kr** (att betala)

#### Semesterintjäning
- 12% av bruttolön: **4 200 kr** per år
- 2.08 dagar per månad

## Svensk Lagstiftning - Implementerad

### ✅ Skatteverkets regler
- Arbetsgivaravgifter 2025: 31.42% (full sats)
- Åldersbaserade avgifter: 10.21% (66-67 år)
- Skattetabeller: Stöd för tabeller 30-34, kolumner 1-6
- Preliminär A-skatt enligt gällande regler

### ✅ Semesterlagen
- 25 dagars semester per år
- 12% semesterlön (procentregeln)
- Sammanlöneregeln (0.43% per dag)
- Semesterersättning vid uppsägning

### ✅ Pensionsregler
- ITP1: 4.5% upp till 7.5 inkomstbasbelopp
- ITP1 hög: 30% över 7.5 inkomstbasbelopp
- ITP2: Förmånsbestämd pension
- ITPK: 2% av månadslön
- Inkomstbasbelopp 2025: 67 167 kr

### ✅ Personnummer
- Validering med Luhn-algoritm
- Format: YYYYMMDD-XXXX eller YYMMDD-XXXX
- Åldersberäkning
- Könsbestämning

## Säkerhet & Revision

### Auditloggning
- Alla ändringar i lönedata loggas
- Spårbarhet: Vem, vad, när
- GDPR-kompatibel

### Rollbaserad åtkomst
- Olika behörigheter för HR, Löneadministratör, Chef
- Skydd av känslig löneinformation

### Dataskydd
- Krypterad lagring av känsliga uppgifter
- Säker PDF-generering
- Autentisering för alla API-anrop

## Framtida Utökningar

### Planerade features
- [ ] Import av skattetabeller från Skatteverket API
- [ ] Integration med bankfiler (Bankgirot)
- [ ] AGI-fil export för redovisning
- [ ] Tidrapportering för timanställda
- [ ] Lönerevision och jämförelser
- [ ] Export till externa löneprogram
- [ ] Avancerad rapportering och diagram

## Support & Kontakt

För frågor och support:
- GitHub Issues: [Repository]
- Email: support@example.com

## Licens

Proprietary - All rights reserved

---

**Utvecklad med 💙 för svenska företag**
**Fortknox-standard lönesystem enligt svensk lag**
