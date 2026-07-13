# Produktägar-acceptans — Redovisningssystem

En genomgång av **varje** acceptanskriterium i `KICKOFF_NYSESSION.md` §4 och varje
steg i användarresan, skriven för att godkännas av en produktägare utan
programmeringskunskaper. Varje rad pekar på det **test** som bevisar den — inget
här är ett påstående utan körd bevisning.

**Reproducera allt:** `npm test -w server` → **139 tester passerar** i 16 sviter mot
en riktig Postgres. `npm run build -w server` (tsc) utan fel. Samma körs i CI
(`.github/workflows/ci.yml`) på varje push.

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
| 3.4 | **MCP-server** så Cowork/claude.ai kan driva kärnan live (native, typade verktyg) | ✅ | `mcp.test.ts` (startar byggd server, pratar MCP över stdio) |

## Fas 4 — Läsbar vy

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| 4.1 | Read-only vy: översikt, huvudbok, rapporter (resultat/balans/moms), register, dokument, hela revisionsloggen | ✅ | `view.test.ts` (19 tester) |
| 4.2 | Inloggning fungerar; bolagskontext härleds korrekt (regression mot `currentCompanyId`-buggen) | ✅ | `view.test.ts` |
| 4.3 | **Människa-i-loopen i vyn** — godkänn/avvisa AI-förslag; utomstående nekas | ✅ | `view.test.ts` (godkänn → bokförd, avvisa, utomstående nekas) |

## Löpande

| # | Kriterium | Status | Bevis |
|---|---|---|---|
| L.1 | Enhetstester på kärnlogiken körs i **CI**, grönt med testantal > 0 | ✅ | `.github/workflows/ci.yml` (typecheck + build + 139 tester) |
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

## Medvetet skjutet på framtiden (utanför nuvarande scope)

Enligt planens scope-reduktion (`GRANSKNING_OCH_OMSTARTSPLAN.md` §5–6), att besluta om
senare: Skatteverket-integration, bank/Open Banking, Peppol/e-faktura, ROT/RUT/omvänd
moms, BankID/Swish, årsredovisning (K2/K3), GDPR-radering vs bevarandekrav, mobilapp.
