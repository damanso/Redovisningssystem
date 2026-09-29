# PRD-bygget redovisningen FR-3 — PRD redovisningen FR-3: FR-3 | Varje genomförd åtgärd och varje köat förslag skrivs i en append-only

Datum: 2026-09-29 20:24 · Branch: cto/prd-redovisningen-fr-3-9005 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen FR-3: FR-3 | Varje genomförd åtgärd och varje köat förslag skrivs i en append-only revisionslogg som inte går att ändra eller 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
KALLA | PRD redovisningen (02-Områden/hermes/prd/redovisningen-1c-prd.md), fryst 29/9 — Davids beslut #194; astras kodgranskning av den fardiga koden
MAL | Koden ska folja PRD-kravet nedan och dess acceptans. PRD:n andras inte.
ARKITEKTUR | docs/ARKITEKTUR.md galler oforandrad — befintliga monster, inga nya beroenden
PRD-KRAVET (ordagrant):
FR-3 | Varje genomförd åtgärd och varje köat förslag skrivs i en append-only revisionslogg som inte går att ändra eller radera; avvisningar loggas inte: en kravManniska-åtgärd som avvisas för agent och en contractor_not_permitted-avvisning lämnar ingen auditrad (execute.ts rad 52–58, läst 29/9, kodkommentaren säger det uttryckligen).
Acceptans: UPDATE, DELETE och TRUNCATE mot audit_log avvisas även för tabellägaren (trigger), och som app-roll ger UPDATE och DELETE permission denied; testsviten audit-immutability.
Källa: ACCEPTANS.md fas 0.5 och live-proben.
Prioritet: MÅSTE
Läge: BYGGT (bevis: audit-immutability.test.ts rad 47–68 läst 28/9, alla fyra fallen provade; 0003_audit_log.sql; live-proben ACCEPTANS rad 164). Anmärkning: städningen 21/9 raderade 81 199 rader med Davids ja (#173), men spärren stoppar även tabellägaren – raderingen gick alltså en väg utanför systemet (superuser eller tillfälligt avstängd trigger). Gapanalysen 28/9, gap 17 (filrad 72, omläst 28/9), markerar garantin som okänd efteråt. Att det hände är belagt; vägen är inte en ordnad rutin i dag – se fråga 6.

VAD SOM SAKNAS I KODEN (astras kodgranskning: | FR | Utfall | Belagg | Saknas i koden |):
| FR-3 | DELVIS | `redovisning/server/migrations/0003_audit_log.sql` rad 23–45; `redovisning/server/src/actions/execute.ts` rad 52–103; `redovisning/server/src/http/view/routes.ts` rad 1354–1363. Driften inte prövad. | Verksamhetsbeskrivningen ändras med direkt `UPDATE` utan auditrad. Append-only-skyddet finns, men alla genomförda skrivningar omfattas alltså inte av loggningen. |

AVGRANSNING | bara det som kravs for att koden ska folja kravet ovan — minsta mojliga andring
```

## Utfall
Tester: 143 passed (143) · Granskning: GODKANT | Ändringen täpper till den angivna loggningsluckan via befintligt executeAction i samma transaktion, testar sparande och tömning och bevarar append-only-skyddet utan nya beroenden. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
