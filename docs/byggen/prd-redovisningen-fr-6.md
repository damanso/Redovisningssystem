# PRD-bygget redovisningen FR-6 — PRD redovisningen FR-6: FR-6 | En faktura skapas med Luhn-giltigt OCR, husets PDF-mall (logotyp, ref

Datum: 2026-09-29 20:44 · Branch: cto/prd-redovisningen-fr-6-9006 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen FR-6: FR-6 | En faktura skapas med Luhn-giltigt OCR, husets PDF-mall (logotyp, referenser, IBAN/BIC) och tids- eller utläggssp

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
KALLA | PRD redovisningen (02-Områden/hermes/prd/redovisningen-1c-prd.md), fryst 29/9 — Davids beslut #194; astras kodgranskning av den fardiga koden
MAL | Koden ska folja PRD-kravet nedan och dess acceptans. PRD:n andras inte.
ARKITEKTUR | docs/ARKITEKTUR.md galler oforandrad — befintliga monster, inga nya beroenden
PRD-KRAVET (ordagrant):
FR-6 | En faktura skapas med Luhn-giltigt OCR, husets PDF-mall (logotyp, referenser, IBAN/BIC) och tids- eller utläggsspecifikation som sida 2, och två fakturor kan aldrig visa samma nummer; fakturanummerräknaren flyttas bara framåt, flytten auditloggas, och både räknarflytten och tilldelningen av kundens fakturanummer på befintliga fakturor är känsliga åtgärder som köas för Davids godkännande (LOC-263: båda åtgärderna kräver mänskligt godkännande).
Acceptans: PDF matchar mallen från faktura 0000024/0000027 (testsviten invoice-pdf-mall); OCR:et är Luhn-giltigt mot en oberoende Luhn-implementation i testet (domain.test.ts rad 9–11 och 26, läst 29/9); set_invoice_number_series ger 202 och först efter godkännande 200 (sviten kör med människans token, invoice-series-appendix.test.ts rad 17 och 63–66, läst 29/9, så 202 visar att åtgärden köas även för människa; agentfallet bärs av registrets sensitivity 'sensitive' och execute.ts rad 60–84, inte av den här sviten), nästa faktura får det nya numret, ett försök att backa ger 409 series_cannot_move_backwards, och hoppet auditloggas med gammalt och nytt värde (invoice-series-appendix.test.ts rad 62–87, läst 29/9); set_external_invoice_numbers ger 202 till godkännande, PDF och vy visar kundens nummer med internnumret spårbart, och ett redan upptaget nummer avvisas vid godkännandet så att två fakturor aldrig visar samma nummer (rad 94–135; effective_invoice_number med DEFERRABLE unik nyckel är mekanismen).
Källa: ACCEPTANS.md raderna Mall och LOC-263.
Prioritet: MÅSTE
Läge: BYGGT (bevis: ACCEPTANS.md, testsviter invoice-pdf-mall och invoice-series-appendix; registry.ts läst 29/9: set_invoice_number_series rad 383–391 och set_external_invoice_numbers rad 393–406, båda sensitivity 'sensitive')

VAD SOM SAKNAS I KODEN (astras kodgranskning: | FR | Utfall | Belagg | Saknas i koden |):
| FR-6 | DELVIS | `redovisning/server/src/domain/ocr.ts` rad 24–32; `redovisning/server/src/services/pdfService.ts` rad 151–198 och 324; `redovisning/server/src/services/invoiceNumbering.ts` rad 24–37 och 60–89. | Räknarens framåtflytt är inte skyddad mot samtidighet: två godkännanden kan läsa samma gamla värde, varefter en lägre flytt skriver över en högre. Läsning, kontroll och uppdatering behöver serialiseras även mot fakturaskapande. |

AVGRANSNING | bara det som kravs for att koden ska folja kravet ovan — minsta mojliga andring
```

## Utfall
Tester: 143 passed (143) · Granskning: GODKANT | Ändringen uppfyller FR-6 genom att serialisera räknarflytt, kundnummertilldelning och fakturaskapande med samma radlås, med relevanta samtidighetstester och bibehållet godkännandeflöde, audi · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
