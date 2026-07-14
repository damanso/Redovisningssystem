# Produktägar-acceptans — Redovisningssystem

En genomgång av **varje** acceptanskriterium i `KICKOFF_NYSESSION.md` §4 och varje
steg i användarresan, skriven för att godkännas av en produktägare utan
programmeringskunskaper. Varje rad pekar på det **test** som bevisar den — inget
här är ett påstående utan körd bevisning.

**Reproducera allt:** `npm test -w server` → **331 tester passerar** i 50 sviter mot
en riktig Postgres. `npm run build -w server` (tsc) utan fel. Samma körs i CI
(`.github/workflows/ci.yml`) på varje push.

Utöver grundfaserna 0–4 nedan är utökningsfaserna **A1–A14**, bokslut/skatt **B1–B4**,
deklarationsprogram **C1–C7**, myndighetsfiler **D1–D4** och regelefterlevnad **E1–E3**
byggda och grindade — se README för fas-för-fas-tabeller med testsvit per rad, och
avsnittet "B–E-serierna" längst ned här.

Legend: ✅ = byggt och bevisat med test.

## Fas 0 — Fundament & förtroendegräns

| # | Kriterium (klarspråk) | Status | Bevis |
|---|---|---|---|
| 0.1 | Migrationskedjan kör rent på en **tom** databas; tillägg (uuid, pg_trgm) skapas först | ✅ | `migrate.test.ts` + varje testkörning bygger en färsk DB och kör alla 12 migrationer |
| 0.2 | Appen **vägrar starta** utan `JWT_SECRET` (ingen hemlig fallback) | ✅ | `failfast.test.ts` |
| 0.3 | **Ett annat bolag går inte att läsa** — B som anger A:s bolags-ID får 403/404, aldrig 200 | ✅ | `tenant-isolation.test.ts` (11 tester) |
| 0.4 | Uppdateringar via allowlist — en elak fältnyckel kan inte injicera SQL | ✅ | `allowlist.test.ts` |
| 0.5 | **Oföränderlig revisionslogg** — skrivs vid åtgärder, går inte att ändra/radera | ✅ | `audit-immutability.test.ts` |
| 0.6 | Filuppladdning validerar filtyp, lagrar med UUID utanför webroten; `../` kan inte rymma | ✅ | `upload.test.ts` |

## Fas 1 — Korrekt bokföringskärna

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| 1.1 | Verifikat: serier per bolag/år, löpnummer, **debet = kredit i ören** framtvingat; obalans avvisas | ✅ | `accounting.test.ts`, `accounting-review-fixes.test.ts` |
| 1.2 | Bokfört verifikat kan **inte ändras/raderas**; rättelse via nytt verifikat; periodlås fungerar | ✅ | `accounting.test.ts`, `audit-immutability.test.ts` |
| 1.3 | Moms 0/6/12/25 % på rätt konton; momsrapport (utgående − ingående) stämmer på känt exempel | ✅ | `domain.test.ts`, `autopost-vat-sie.test.ts` |
| 1.4 | Automatkontering med **dubbelbokningsspärr** — samma faktura kan inte bokas två gånger | ✅ | `autopost-vat-sie.test.ts`, `business.test.ts` |
| 1.5 | **Luhn/OCR** genererat och verifierat med en oberoende Luhn-kontroll | ✅ | `domain.test.ts` |
| 1.6 | **SIE4-export** validerar mot formatet på känt exempel | ✅ | `autopost-vat-sie.test.ts` |

## Fas 2 — Affärsobjekt

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| 2.1 | Kunder/leverantörer/artiklar/fakturor/kvitton bakom förtroendegränsen (medlemskap krävs) | ✅ | `business.test.ts`, `tenant-isolation.test.ts` |
| 2.2 | Standardlistning visar **aktiva** poster (regression mot `is_active`-buggen) | ✅ | `business-review-fixes.test.ts` |
| 2.3 | PDF återanvänds; **Bankgiro/bank_account** finns i schemat och syns på PDF:en | ✅ | `business.test.ts` (läser PDF-texten) |
| 2.4 | Uppladdade filer kan hämtas via en auth-skyddad endpoint | ✅ | `upload.test.ts`, `view.test.ts` (dokumentnedladdning) |

## Fas 3 — AI-först-gränssnittet

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| 3.1 | Action-lager med serverpåtvingade regler + audit + **mänskligt godkännande** på pengaflyttande operationer | ✅ | `actions.test.ts`, `mcp.test.ts`, `view.test.ts` |
| 3.2 | **Prompt-injection-skydd** — text i ett kvitto kan inte ändra behörighet eller utlösa en bokning | ✅ | `actions.test.ts` |
| 3.3 | AI-OCR: giltig nyckel, aktuell modell, PDF-stöd, **kräver mänsklig granskning** före bokföring | ✅ | `actions.test.ts` |
| 3.4 | **MCP-server** så Cowork/claude.ai kan driva kärnan live (native, typade verktyg) | ✅ | `mcp.test.ts` (startar servern som barnprocess, pratar MCP över stdio) |

## Fas 4 — Läsbar vy

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| 4.1 | Read-only vy: översikt, huvudbok, rapporter (resultat/balans/moms), register, dokument, hela revisionsloggen | ✅ | `view.test.ts` (19 tester) |
| 4.2 | Inloggning fungerar; bolagskontext härleds korrekt (regression mot `currentCompanyId`-buggen) | ✅ | `view.test.ts` |
| 4.3 | **Människa-i-loopen i vyn** — godkänn/avvisa AI-förslag; utomstående nekas | ✅ | `view.test.ts` (godkänn → bokförd, avvisa, utomstående nekas) |

## Löpande

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| L.1 | Enhetstester på kärnlogiken körs i **CI**, grönt med testantal > 0 | ✅ | `.github/workflows/ci.yml` (typecheck + build + 331 tester) |
| L.2 | De gamla vilseledande `*_COMPLETE.md`-rapporterna är arkiverade | ✅ | `docs/archive/` |

## Användarresan, ände till ände (produktägarens vy)

1. **Kom igång** — registrera användare, skapa bolag och räkenskapsår. *(API/MCP)*
2. **Lägg upp register** — kunder, leverantörer, artiklar. *(MCP: "skapa kund …")*
3. **Fakturera** — skapa faktura (giltigt OCR, Bankgiro, PDF i dokumentarkivet).
4. **Bokför** — faktura → verifikat i huvudboken. Känsligt ⇒ AI föreslår, du godkänner.
5. **Kvitto** — fota kvitto → AI-OCR föreslår belopp/moms → du godkänner → bokförs.
6. **Se allt** — översikt (årets resultat), rapporter, huvudbok, dokument, revisionslogg.
7. **Bestäm** — godkänn/avvisa AI:ts förslag under **Att göra**; varje beslut loggas.
8. **Lämna över** — SIE4-export till revisor eller vid systembyte.

Steg 1–5 och 8 sker via action-/MCP-lagret (Cowork/claude.ai) och/eller HTTP-API:t;
steg 6–7 i den läsbara webbvyn. Alla känsliga steg kräver ett mänskligt godkännande.

## B–E-serierna — bokslut, deklaration, myndighetsfiler, regelefterlevnad

Byggda och grindade efter grundfaserna. Varje rad har en egen acceptanstestsvit.

| Fas | Kriterium (klarspråk) | Status | Bevis (testsvit) |
|---|---|---|---|
| B1 | K2-årsredovisning: resultat, balans, noter, jämförelseår, CSV-export | ✅ | `k2-annual` |
| B2 | Skatteskuld & skattekonto: moms, AGI, uppskattad bolagsskatt, deadlines | ✅ | `taxes` |
| B3 | Skattestöd: underskottsavdrag, periodiseringsfond, momsavdrag, checklista | ✅ | `tax-planning` |
| B4 | Skattepåminnelser: deadlines → notiser + (SMTP-gated) e-post, idempotent | ✅ | `tax-reminders` |
| C1 | Anläggningsregister + planenlig avskrivning, bokförs idempotent | ✅ | `fixed-assets` |
| C2 | Bokförda bokslutstransaktioner (periodiseringsfond, årets skatt, resultat) | ✅ | `bokslut` |
| C3 | Komplett årsredovisning: förvaltningsberättelse, K2-noter, fastställelseintyg | ✅ | `annual-management` |
| C4 | Skattemässiga justeringar → INK2R (balanserar) + INK2S | ✅ | `ink2` |
| C5 | Momsdeklaration alla rutor 05–49 ur bokföringen | ✅ | `vat-declaration` |
| C6 | SRU-filgenerering för INK2 (SKV 269-fältkoder) | ✅ | `sru-export` |
| C7 | iXBRL-årsredovisning (K2, XBRL Sweden-taxonomi) för Bolagsverket | ✅ | `ixbrl-export` |
| D1 | AGI — arbetsgivardeklaration på individnivå, Skatteverkets XML (schema 1.1) | ✅ | `agi` |
| D2 | K10 — gränsbelopp/3:12, förenklings- & huvudregel, SRU-blankett | ✅ | `k10` |
| D3 | KU10 — kontrolluppgift (kontant bruttolön), Skatteverkets XML | ✅ | `ku10` |
| D4 | Periodisk sammanställning (EU-moms), SKV574008, avstämd mot huvudboken | ✅ | `ec-sales-list` |
| E1 | GDPR-radering/anonymisering av parter — bokföringslagen-säker, känslig åtgärd → godkännandekö; obokförda fakturors PDF + återkommande rensas; namn/org.nr behålls bara vid bokförda transaktioner | ✅ | `gdpr` |
| E2 | F-skatt på faktura-PDF + omvänd skattskyldighet (ingen moms, konto 3231, ruta 41) | ✅ | `f-tax-reverse-charge` |
| E3 | ROT/RUT-avdrag (fakturamodellen): 30/50 % kapat mot årets tak, delad fordran (1510/1513) | ✅ | `housework-deduction` |

Varje B/C/D/E-fas passerade dessutom en **adversariell grind** (finansmatte-,
SRU-, iXBRL-, filformat-, GDPR- och moms-/bokföringsgranskning) där varje bekräftat
fynd åtgärdades med regressionstest innan fasen stängdes.

## Slutgrind — live-verifiering (`/verify`)

Utöver testsviten startades API:t **på riktigt** mot en färsk Postgres och kärnflödet
+ säkerhetsproberna kördes med curl. Faktisk utfall:

| Prob | Förväntat | Utfall |
|---|---|---|
| `POST /api/auth/register` → token | 201 | ✅ 201, token |
| Skapa bolag, `PATCH` F-skatt, `GET` läser tillbaka | 200 / `approved_for_f_tax=true` | ✅ |
| Användare B mot A:s bolag + revisionslogg | 404 | ✅ 404 / 404 |
| Token signerad med `'your-secret'` | 401 | ✅ 401 |
| `PATCH` med okänd/skadlig nyckel | 400 | ✅ 400 |
| `audit_log`-UPDATE som postgres | append-only-fel | ✅ "audit_log är append-only: UPDATE tillåts inte" |
| Uppladdning med `../`-filnamn | 201, lagras som UUID, ingen rymning | ✅ UUID-namn, inget `/etc/evil.png` |
| `.sh` / fel magic bytes | 400 `invalid_file` | ✅ 400 / `invalid_file` |
| Omvänd skattskyldighet: faktura → bokför → ruta 41 | ingen moms, 3231, ruta 41 | ✅ `vat_ore=0`, konto 3231, ruta 41 = 50 000 kr, ruta 10 = 0 |
| ROT-faktura: avdrag beräknas | 30 % av 12 500 = 3 750 kr | ✅ `housework_reduction_ore=375000` |
| GDPR-anonymisering via agent-token | 202 (godkännandekö, ej direkt körd) | ✅ 202 |

## Medvetet utanför scope (kräver extern integration)

Nedanstående är **inte** byggt eftersom det kräver anslutning till en extern tjänst
och kan inte levereras som en självständig fil/beräkning:

- **BankID** och direkt **API-inlämning** till Skatteverket/Bolagsverket (nivå 5) — inget signeras eller skickas digitalt.
- **PSD2 / Open Banking / live bankkoppling** — bankimport sker via manuell CSV-fil.
- **Peppol / e-faktura-nätverk** och **Swish** — kräver operatörsanslutning.

Systemet producerar i stället **färdiga filer att ladda upp själv** (SRU, iXBRL, AGI-,
KU10-, SKV574008-XML/CSV) och **beräknat underlag** med tydliga förbehåll. Tidigare
scope-noteringar om ROT/RUT, omvänd moms, K2-årsredovisning och GDPR-radering är
**inte längre uppskjutna** — de är byggda (C- och E-serierna ovan).
