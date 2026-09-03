# Bygge beslut #107 — LOC-355: `bookPayslip` görs om från kontantmetodens netto-bokning (7010 D / 1930 K) till bruttobokni

Datum: 2026-09-03 08:07 · Branch: cto/loc-355-bookpayslip-g-rs-om-fr-n-kontant-107 · Overlamning: #103

## Mal
LOC-355: `bookPayslip` görs om från kontantmetodens netto-bokning (7010 D / 1930 K) till bruttobokning med skuldkonton (7010 brutto, 7510 arbetsgivaravgift, 2710/2731 skuld, 1930 netto) och `bookPayrollTax` ändras till att tömma samma skuldkonton — framåtriktat från septemberlönen, historiken är redan rättad via A53+A54.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har grävt klart: koden i `payroll.ts`, standardkontoplanen (0006 — 2710/7510/3740 finns, 2731 saknas), registry-titlarna, MCP_ACTIONS.md rad 150–153 och de fyra testsviterna. Här är kravspecen:

---

MAL | `bookPayslip` bokför septemberlönen och framåt med bruttometod (kostnad + skuldkonton i samma verifikat) och `bookPayrollTax` tömmer exakt samma skuldkonton — så att löneskulder aldrig mer saknas i balansräkningen (K2-fel över årsskifte) och ingen fler manuell engångsrättning behövs.
KALLA | Överlämning #103 (analytiker, 2026-09-03), CTO-underlag LOC-355 med Davids ja 2026-09-03, beslut #49, engångsrättningen A53+A54 (mars–aug mot 2440), Linear LOC-385.
ARKITEKTUR | Befintliga mönster enligt docs/ARKITEKTUR.md: tjänstelagret `server/src/services/payroll.ts` via `postVoucher` (som redan kör `assertAccountsExist`), actions-registret (`book_payslip`/`book_payroll_tax` finns, sensitivity `sensitive` behålls), numrerad idempotent migrationskedja i `server/migrations/` (nästa: 0067), belopp i ören-heltal, audit i samma transaktion, vitest mot riktig Postgres. Inga nya beroenden eller mönster.
KRAV-1 | Brytpunkt: en konstant period `2026-09` i `payroll.ts`. För `period >= '2026-09'` gäller KRAV-3/KRAV-4; för äldre perioder bokför båda funktionerna EXAKT som idag (kontantmetoden) — testat med en period före och en efter brytpunkten.
KRAV-2 | Migration `0067` lägger till standardkontot `(2731, 'Avräkning lagstadgade sociala avgifter', 'liability')` (`company_id IS NULL`), idempotent (`ON CONFLICT`/villkorad insert som kedjans övriga). 2710, 7510, 2510, 1930, 3740 finns redan i 0006 och rörs inte.
KRAV-3 | `bookPayslip` (period ≥ brytpunkt) bokför på utbetalningsdatumet: 7010 D `gross_ore`, 7510 D `employer_contribution_ore`, 2710 K `tax_ore`, 2731 K `employer_contribution_ore`, 1930 K `net_ore` — balanserar per konstruktion; all data finns på payslip-raden. Spärrar (already_booked/cancelled), källkoppling, audit och statusuppdatering oförändrade.
KRAV-4 | `bookPayrollTax` (period ≥ brytpunkt) tömmer skuldkontona: 2710 D = periodens summerade `tax_ore`, 2731 D = summerade `employer_contribution_ore`, 1930 K = `amount` (default: förslag avrundat till hela kronor som idag); öresdifferens mellan amount och summan bokas mot 3740 så verifikatet balanserar. 2510 används inte för perioder ≥ brytpunkt. Datumregel (12:e månaden efter, bankdag), UNIQUE-spärr och `payroll_tax_payments`-raden oförändrade.
KRAV-5 | Testad följd: efter `bookPayslip` + `bookPayrollTax` för samma period ≥ brytpunkt är saldot på 2710 och 2731 exakt 0 (ev. öresrest ligger på 3740, aldrig på skuldkontona) — det är underlaget "krediterar/debiterar exakt de konton `bookPayslip` sätter".
KRAV-6 | Registry-titlarna för `book_payslip` och `book_payroll_tax` (`server/src/actions/registry.ts:1729,1739`) uppdateras till bruttometodens konton; docs/MCP_ACTIONS.md (avsnittet vid rad 150–153) skrivs om med nya konteringen och brytpunkten.
KRAV-7 | De fyra sviterna `payroll.test.ts`, `payroll-tax.test.ts`, `payroll-payment.test.ts`, `payroll-historical.test.ts` uppdateras: nya verifikatrader hävdas radexakt för period ≥ brytpunkt, gamla beteendet hävdas kvarstå för period < brytpunkt, och `payroll-historical` (K1/Tillägg 1) ska fortsatt vara grön utan logikändring.
ACCEPTANS | `npm test` (riktig Postgres) och `npm run build` gröna med faktisk inklistrad utdata; ett test visar septemberverifikatets fem rader exakt (KRAV-3), ett visar nollställda 2710/2731 (KRAV-5), ett visar oförändrad kontantbokning för t.ex. period 2026-08 (KRAV-1); `npm run migrate` idempotent (två körningar). Avstämningen av 2440/2510 efter körningen ~20/9 gör David i drift — ingen kod för den.
AVGRANSNING | Endast `server/src/services/payroll.ts`, migration 0067, de två registry-titlarna, docs/MCP_ACTIONS.md och de fyra testsviterna. Rör INTE: bokförda verifikat/A53+A54, `computePayroll`/`computePayslipTax`/tabell 30, `createPayslip`, godkännandeflödet, vyn, konto 2440.
uteslutet: automatisk ombokning/rättelse av redan bokförda löneverifikat (A14/A48) — källan kräver det inte, historiken är rättad via A53+A54
uteslutet: avstämningsrapport/action för restsaldon på 2440/2510 — källan kräver det inte, avstämningen 20/9 är ett manuellt driftsteg
uteslutet: separat kontering av semesterersättning (t.ex. 7285) eller semesterlöneskuld (2920) — källan kräver det inte
uteslutet: konfigurerbara lönekonton per bolag — källan kräver det inte
uteslutet: nedsättningar av arbetsgivaravgift eller ändrad beräkning — källan kräver det inte

---

Ett grävfynd värt att notera: underlaget säger "säkerställ konton 2710/2731/7510" — i verkligheten saknas **bara 2731** i standardkontoplanen (0006 har 2710 och 7510), därav den avgränsade migrationen 0067. Öresdifferensen i KRAV-4 är framtvingad av matematiken (hela-kronor-betalning mot ören-summor kan inte balansera annars) och använder befintliga 3740, inget nytt konto.
```

## Utfall
Tester: 106 passed (106) · Granskning: GODKANT | Bygget följer kravspecen exakt (brytpunkt 2026-09 som textjämförelse, femradersverifikat, tömning av 2710/2731 med öresdiff mot 3740, idempotent 0067 enligt 0048-mönstret, registry-titlar oc · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
