# Deploy till Railway (produktion)

Den här guiden sätter upp systemet på **Railway** så att du når det från både mobil
och dator via en HTTPS-URL. Arkitekturen: en container med API:t + den serverrenderade
vyn, en managed Postgres 16, och en beständig volym för uppladdade filer.

> **Läs först — viktigt om "produktion".** Det här ger dig en riktig, hostad, säker
> server. Men systemet är **inte** klart för skarp myndighetshantering: det finns
> ingen digital inlämning till Skatteverket/Bolagsverket och ingen BankID/bankkoppling
> (deklarationsfiler genereras som *underlag*). Lägger du in riktig företagsdata
> ansvarar du själv för behandlingen (GDPR: bl.a. personnummer lagras). Se
> "Innan skarp drift" sist i dokumentet.

Allt som kan förberedas i koden är redan committat: `Dockerfile`, `railway.json`,
`docker/start.sh` och roll-provisioneringen. Det du gör nedan är att koppla ditt
Railway-konto och sätta hemligheterna.

---

## 1. Skapa projektet

1. Skapa konto på <https://railway.app> (GitHub-inloggning är enklast).
2. **New Project → Deploy from GitHub repo** och välj det här repot.
   Välj branchen du vill deploya (t.ex. `main` efter merge).
3. Railway upptäcker `Dockerfile` och `railway.json` automatiskt och bygger bilden.
   Första bygget kommer att sakna databas — det fixar vi i nästa steg.

## 2. Lägg till Postgres

1. I projektet: **New → Database → Add PostgreSQL**.
2. Railway skapar en Postgres-tjänst med en privat anslutning
   (`postgres.railway.internal`). Den användaren är ägare/admin — den kör
   migreringarna.

## 3. Lägg till en volym för uppladdade filer

Kvitton och bilagor skrivs till disk. Utan volym försvinner de vid varje deploy.

1. Öppna **API-tjänsten → Settings → Volumes → New Volume**.
2. Mount path: **`/data`**  (bilden använder `UPLOAD_DIR=/data/uploads`).

## 4. Sätt miljövariabler på API-tjänsten

Öppna **API-tjänsten → Variables** och lägg till:

| Variabel | Värde | Kommentar |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` | **Krävs**, ≥32 tecken. Servern startar aldrig utan. |
| `APP_DB_PASSWORD` | `openssl rand -hex 24` | Lösenord för den lågpriv. `app`-rollen. |
| `DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` | Referens till Postgres-tjänsten (kör migreringar). |
| `NODE_ENV` | `production` | |
| `TRUST_PROXY` | `1` | Railway ligger bakom en proxy — krävs för korrekt IP/rate-limit. |

Kör `openssl rand -hex 32` respektive `-hex 24` lokalt och klistra in värdena.

> `DATABASE_URL` (app-anslutningen) behöver du **inte** sätta själv — `start.sh`
> härleder den ur `DATABASE_ADMIN_URL` + `APP_DB_PASSWORD` vid start. Vill du styra
> den explicit kan du ändå sätta `DATABASE_URL`, då används den.

### (Frivilligt) e-post och AI-OCR

| Variabel | Effekt |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Slår på utgående e-post (påminnelser). Utan dessa stannar allt som in-app-notiser. |
| `ANTHROPIC_API_KEY` | Slår på AI-OCR-förslag för kvitton (bokför aldrig automatiskt). |

## 5. Deploya och exponera

1. **Deployments → Redeploy** (eller pusha till branchen). I bygg-/deploy-loggen ska du se:
   `[start] kör migreringar…` → `[start] provisionerar app-rollen…` → `API lyssnar på port 3000`.
2. **Settings → Networking → Generate Domain** ger dig en publik `*.up.railway.app`-URL.
3. Öppna URL:en i mobil/dator → du landar på `/app` (inloggningen).

## 6. Skapa ditt konto

Systemet har ingen förkonfigurerad användare (ingen demo-seed i produktion).
Registrera dig och skapa bolaget:

```bash
BASE=https://DITT-PROJEKT.up.railway.app
curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"du@firma.se","password":"ett-riktigt-langt-losen","name":"Ditt Namn"}'
```

Logga sedan in på `$BASE/app`, skapa bolag + räkenskapsår och börja bokföra.
(Registrering går även att bygga in i vyn om du vill — säg till.)

---

## Så hänger säkerheten ihop

- API:t ansluter som rollen **`app`** — icke-superuser, icke-ägare — så **Row Level
  Security tvingas**. Startar servern mot en roll som kringgår RLS vägrar den att ta
  emot trafik (`assertAppRoleEnforcesRls`).
- **Migreringar** körs som ägar-/adminrollen via `DATABASE_ADMIN_URL`, aldrig av appen.
- Serverprocessen körs som en **icke-root-användare** i containern (root används bara
  för att migrera och rätta volymens ägarskap, sedan släpps privilegierna med `gosu`).
- `helmet` + strikt **CSP** (`script-src 'none'`) och `x-powered-by` avstängt.
- Auditloggen är append-only; känsliga åtgärder hamnar i en godkännandekö.

## Backup (gör detta innan riktig data)

Railway tar egna ögonblicksbilder, men ta egna dumpar också:

```bash
# Med Railway CLI (railway login; railway link):
railway run pg_dump "$DATABASE_ADMIN_URL" -Fc -f backup-$(date +%F).dump
```

Schemalägg regelbundna dumpar och testa en återläsning.

## Innan skarp drift — kvarstående

- **Ingen digital inlämning** (Skatteverket/Bolagsverket) och **ingen BankID** —
  filer är underlag som lämnas manuellt. Det står även i README.
- **GDPR:** du blir personuppgiftsansvarig. Radering/anonymisering finns (Fas E1),
  men gör en egen bedömning av laglig grund, gallring och biträdesavtal (Railway).
- **Sätt starka lösenord**, aktivera 2FA (finns i appen), och håll `JWT_SECRET`/
  `APP_DB_PASSWORD` hemliga (rotera vid läcka).
- Överväg en egen domän (**Settings → Networking → Custom Domain**).

Kör du hellre på egen VPS med `docker compose` i stället för Railway — säg till, så
skriver jag en compose-stack som speglar exakt det här.
