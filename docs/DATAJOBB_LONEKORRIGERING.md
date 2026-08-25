# Datajobb: rättelse av lönebokföringen 2026-03–2026-08 (RÅ 2026)

> **Status:** FÖRBEREDD, INTE UTFÖRD. Den här sessionen har byggt om koden
> (bruttometoden) men har inte rört Davids produktionsdata och kan inte göra
> det — allt nedan körs som `post_voucher` / `book_payroll_tax` och landar i
> **Att göra**, där David godkänner varje post. Ingen rå SQL, någonsin.
>
> Källa: överlämning #15 (`docs/inkorg/015-…`, Linear LOC-355) + Davids ja
> 2026-08-25 ("bygg, jag vill se korrekta siffror direkt").

## Vad som är fel i RÅ 2026

Lönebokföringen använde fram till 2026-08-25 en nettometod: `book_payslip`
debiterade 7010 med **nettolönen** och `book_payroll_tax` lade
skattekontobetalningen som en **debet på 2510**. Följden i råbalansen per
2026-08-25 (131 verifikat):

| Konto | Idag | Ska vara | Diff |
|---|---:|---:|---:|
| 7010 Löner | 259 674,00 | 339 000,00 | **+79 326,00** |
| 7510 Arbetsgivaravgifter | *saknas helt* | 106 513,80 | **+106 513,80** |
| 2510 Skattekonto | 185 840,00 (debet) | 0 | **−185 840,00** |
| 2730 Sociala avgifter | 0 | −0,20 (debet) | −0,20 |

339 000,00 = 6 × 56 500,00 — exakt sex månaders bruttolön. Det är
avstämningens första och hårdaste kontroll: går 7010 inte jämnt upp mot sex
bruttolöner är någon periods underlag fel.

Personalkostnaden är alltså understated med **185 839,80 kr** (≈ 186 tkr), och
det talet går rakt in i K2-årsredovisningen, INK2 och nyckeltalen.
Likviditetsprognosen läste samma data och rapporterade **124 032,20 kr** som
FÖRFALLET trots att varje period har ett bokfört betalningsverifikat.

## Härledningen per period

Underlaget finns i systemet — hämta det, gissa inte:

```
list_payslips { period: "2026-03" }      → gross_ore, tax_ore, employer_contribution_ore
list_vouchers { }                        → periodens betalningsverifikat (I20/I36/I72/A17/A35/A47)
get_voucher   { voucher_id: "…" }        → betalningens DEBET på 2510 = `betalt`
```

Per period gäller, med `skatt` + `avgift` ur lönebeskedet och `betalt` ur
betalningsverifikatets 2510-debet:

| Rad | Belopp | Varför |
|---|---|---|
| **D 7010** | `skatt` | 7010 fick bara nettot; skattedelen av bruttolönen saknas |
| **D 7510** | `avgift` | arbetsgivaravgiften kostnadsfördes aldrig |
| **K 2510** | `betalt` | betalningen hör inte hemma på skattekontot |
| **K 2730** | `skatt + avgift − betalt` | öresavrundningen som blir kvar som skuld |

Blir sista raden negativ (`betalt` > `skatt + avgift`) byter den sida:
**D 2730** med `betalt − skatt − avgift`. Verifikatet balanserar i båda fallen
— debet `skatt + avgift` mot kredit `betalt + (skatt + avgift − betalt)`.

**2710 rörs inte.** Varje periods lön skulle ha krediterat 2710 och varje
periods betalning debiterat det med samma belopp. Alla sex perioder ÄR betalda,
så nettoeffekten är noll — och en rad som nettar till noll ska inte skrivas.

**1930 rörs aldrig.** Bankhändelserna är riktiga och redan bokförda. Rättelsen
flyttar kostnad och skuld mellan konton, inte pengar.

### Förväntade tal (för avstämning innan godkännande)

Ur systemets egna värden: brutto 56 500,00 alla sex perioder, skatt
13 360,00 för 2026-03…06 (`tax_source: 'historical'`, Tillägg 1) och 12 943,00
för 2026-07…08 (tabell 30), avgift 17 752,30 (31,42 %) alla perioder.

| Period | D 7010 (skatt) | D 7510 (avgift) | Σ per verifikat |
|---|---:|---:|---:|
| 2026-03 | 13 360,00 | 17 752,30 | 31 112,30 |
| 2026-04 | 13 360,00 | 17 752,30 | 31 112,30 |
| 2026-05 | 13 360,00 | 17 752,30 | 31 112,30 |
| 2026-06 | 13 360,00 | 17 752,30 | 31 112,30 |
| 2026-07 | 12 943,00 | 17 752,30 | 30 695,30 |
| 2026-08 | 12 943,00 | 17 752,30 | 30 695,30 |
| **Summa** | **79 326,00** | **106 513,80** | **185 839,80** |

**Avstämningen (KRAV-4):**

1. Σ `K 2510` över de sex verifikaten ska vara **exakt 185 840,00** — 2510:s
   debetsaldo. Blir det något annat är periodfördelningen fel, och då ska
   ingenting godkännas.
2. Σ (D 7010 + D 7510) = **185 839,80** ur lönebeskeden.
3. Differensen **0,20 kr** är den kända öresavrundningen över sex
   skattekontobetalningar och landar som ett nettodebetsaldo på 2730. Den ska
   INTE trollas bort med ett öresavrundningskonto — det är ett eget vägval som
   inte är taget.
4. Efteråt: 7010 = 339 000,00 (= 6 × 56 500), 7510 = 106 513,80, 2510 = 0.
5. Stäm av `skatt` per period mot **AGI-kvittensen** för samma period innan
   verifikatet läggs i kön. Kvittensen är facit mot Skatteverket; lönebeskedet
   är bara vår bild av den.

### Anropet

Ett verifikat per period — sex stycken, inte ett samlat, så att varje rad går
att följa mot sin AGI-kvittens (överlämningens uttryckliga rekommendation).
Datum: periodens skattekontobetalning, dvs. samma datum som det verifikat vars
2510-debet rättas.

```
post_voucher {
  fiscal_year_id: "<RÅ 2026>",
  voucher_date:   "<betalningsverifikatets datum>",
  description:    "Rättelse lönebokföring 2026-03 — bruttometod (LOC-355)",
  lines: [
    { account_number: 7010, debit_ore:  1336000 },
    { account_number: 7510, debit_ore:  1775230 },
    { account_number: 2510, credit_ore: <betalt> },
    { account_number: 2730, credit_ore: <1336000 + 1775230 − betalt> }
  ]
}
```

RÅ 2026 måste vara **olåst** — annars avvisas verifikatet (`period_locked`),
vilket är avsiktligt.

## Backfyllning av `payroll_tax_payments` (KRAV-5)

Tre av de sex betalningsverifikaten är SIE-importerade (enligt överlämning #15:
**I20, I36 och I72**) och har därför ingen rad i `payroll_tax_payments`. Utan
den raden fortsätter `unpaidPayrollPeriods` rapportera perioderna som obetalda
— och de sex korrigeringsverifikaten ovan hjälper inte, eftersom raden är ett
kvitto på betalningen, inte en bokföringspost.

```
book_payroll_tax { period: "<YYYY-MM>", voucher_id: "<I20|I36|I72>" }
```

Inget nytt verifikat skapas. `payment_date` och `amount_ore` härleds ur
verifikatet självt (dess kreditering av 1930) om de inte anges.

**Innan de tre läggs i kön:** slå upp vilken period varje verifikat avser i
dess egen verifikationstext (`list_vouchers` / `get_voucher`). Den här sessionen
har inte kunnat läsa produktionsdatan och har därför INTE fastställt
kopplingen period ↔ verifikat — den ska bekräftas av den som kör jobbet.
Kör man `book_payroll_tax` utan `voucher_id` för en redan betald period skapas
ett DUBBELT betalningsverifikat; `voucher_id` är hela poängen.

## Ordning

1. Sex `post_voucher` (rättelserna) — avstämda mot 185 840,00 och AGI-kvittenserna.
2. Tre `book_payroll_tax` med `voucher_id` (backfyllningen).
3. Kontroll i vyns **Huvudbok** (`/app/c/<bolag>/ledger`) eller
   `k2_annual_report`: 7010 = 339 000,00, 7510 = 106 513,80, 2510 = 0.
4. Kontroll: `liquidity_forecast` → hinken "Förfallet / nu" utan AGI-belopp,
   källan `agi` utan `OBS:`-notis om lönebesked utan täckning.

Befintliga verifikat skrivs aldrig om — inte I20/I36/I72, inte lönernas
ursprungsverifikat. Rättelse sker genom nya verifikat, som bokföringslagen
kräver.
