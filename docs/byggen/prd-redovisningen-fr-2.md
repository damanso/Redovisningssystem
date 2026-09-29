# PRD-bygget redovisningen FR-2 — PRD redovisningen FR-2: FR-2 | Bokfört verifikat kan inte ändras eller raderas; rättelse sker via ny

Datum: 2026-09-29 15:04 · Branch: cto/prd-redovisningen-fr-2-9003 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen FR-2: FR-2 | Bokfört verifikat kan inte ändras eller raderas; rättelse sker via nytt verifikat, perioder kan låsas och en åter

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
KALLA | PRD redovisningen (02-Områden/hermes/prd/redovisningen-1c-prd.md), fryst 29/9 — Davids beslut #194; astras kodgranskning av den fardiga koden
MAL | Koden ska folja PRD-kravet nedan och dess acceptans. PRD:n andras inte.
ARKITEKTUR | docs/ARKITEKTUR.md galler oforandrad — befintliga monster, inga nya beroenden
PRD-KRAVET (ordagrant):
FR-2 | Bokfört verifikat kan inte ändras eller raderas; rättelse sker via nytt verifikat, perioder kan låsas och en återföring kan inte köras två gånger. Tillämpning av FR-38.
Acceptans: UPDATE på ett bokfört verifikat avvisas av databasen för app-rollen med permission denied, och UPDATE på vouchers och DELETE på voucher_lines avvisas även för tabellägaren av triggern med felet oföränderliga (accounting.test.ts, describe oföränderlighet + rättelseverifikat, rad 104–117, läst 29/9); rättelsen sker via nytt verifikat som speglar originalet med reverses_voucher_id satt (rad 119–123); andra återföringen ger 409; periodlåst bokning avvisas.
Källa: ACCEPTANS.md fas 1.2 och säkerhetsgranskningen (migration 0037).
Prioritet: MÅSTE
Läge: BYGGT (bevis: ACCEPTANS.md slutgrind; 0037_voucher_reversal_unique.sql i migrations/; reverse_voucher rad 2965–2967 och lock_period rad 2973–2975 är sensitive i registry.ts, omläst 28/9)

VAD SOM SAKNAS I KODEN (astras kodgranskning: | FR | Utfall | Belagg | Saknas i koden |):
| FR-2 | DELVIS | `redovisning/server/migrations/0007_vouchers.sql` rad 127–168; `redovisning/server/migrations/0037_voucher_reversal_unique.sql` rad 4–6; `redovisning/server/src/services/accounting/vouchers.ts` rad 316–345; `redovisning/server/src/http/view/routes.ts` rad 1395–1402. | Oföränderlighet och rättelse finns, men bokslutsvyn låser året genom direktanrop till `setFiscalYearLock`, utan godkännandekö. Den vägen behöver följa FR-38. |

AVGRANSNING | bara det som kravs for att koden ska folja kravet ovan — minsta mojliga andring
```

## Utfall
Tester: 143 passed (143) · Granskning: DELVIS | Bokslutsvyn köar nu låsningen korrekt via befintligt action-lager med regressionstest, men FR-2:s tillämpning av FR-38 är inte fullständig. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
