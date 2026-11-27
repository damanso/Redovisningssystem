# PRD-bygget uppdragsytan 5-1-varje-kostnadsbindning-nar-david-som-forifyllt-forslag — PRD uppdragsytan 5-1-varje-kostnadsbindning-nar-david-som-forifyllt-forslag: # Story 5.1: Varje kost

Datum: 2026-11-27 14:17 · Branch: cto/prd-uppdragsytan-5-1-varje-kostnadsbindning-nar-david-som-fo-9368 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 5-1-varje-kostnadsbindning-nar-david-som-forifyllt-forslag: # Story 5.1: Varje kostnadsbindning når David som förifyllt förslag Status: ready-for-dev <!-- Validering är frivillig. 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.1: Varje kostnadsbindning når David som förifyllt förslag

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David,
vill jag att varje kostnad når mig som ett förifyllt bindningsförslag, också när den bara kan föras till en ström eller till uppdraget,
så att jag behåller mitt mandat utan att leta underlag eller märka kostnader själv.

Kodbas: redovisning. Krav: FR-33 (förifyllningen, `oplanerad`, `ej bokförd` och obunden kostnad i totalen), FR-4 (bindningsförslaget i kön), FR-41 (bindningen som registrerad handling). Regression: FR-25 (uppfyllt i koden), belopp läses ur redovisningen och kopieras aldrig. Beror på: Story 1.8 (done).

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-27). Berättelsen skapar två nya filer, provfilen och dess hjälpfil. Ingen migration skapas.

```förkrav
fil: server/src/lib/bindningsmal.ts ändras
fil: server/src/lib/beslutsunderlag.ts ändras
fil: server/src/lib/avtalsdelsfalt.ts ändras
fil: server/src/services/uppdragKostnad.ts ändras
fil: server/src/services/uppdragSvep.ts ändras
fil: server/src/services/uppdragUndantag.ts ändras
fil: server/src/services/uppdragPengar.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/receipts.ts läses
fil: server/src/lib/leveranskontrakt.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/forslagsunderlag.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/http/view/html.ts läses
fil: docs/byggen/prd-uppdragsytan-1-8-ingen-kostnad-binds-utan-davids-godkannande.md läses
fil: server/migrations/0007_vouchers.sql läses
fil: server/migrations/0010_invoices_and_receipts.sql läses
fil: server/migrations/0012_action_approvals.sql läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0077_beslut_mottaget.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: server/test/kostnadsforslagHelper.ts ny
fil: server/test/uppdragsytan-kostnadsforslag.test.ts ny
fil: server/test/uppdragsytan-kostnadssparr.test.ts ändras
fil: server/test/kostnadssparrHelper.ts läses
fil: server/test/uppdragsytan-svep-bindning.test.ts ändras
fil: server/test/uppdragsytan-svep.test.ts ändras
fil: server/test/uppdragsytan-bindning.test.ts ändras
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-bedomning.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-rapporterna.test.ts läses
fil: server/test/uppdragsytan-ovrigt.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-luckunderlag.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/kedjaRigg.ts läses
fil: server/test/bedomningsrytmHelper.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: bakvag berörs GRÖN
prov: beslutsverkstallning berörs GRÖN
prov: crmintag berörs GRÖN
prov: designsvep berörs GRÖN
prov: handgrepp berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: kontrollytan berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: registreringsurval berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: svepet berörs GRÖN
prov: uppdragstackning berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de två nya filerna har läget `ny`, de fyra befintliga provfiler som uppgifterna skriver om har läget `ändras`, och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i `hermes/prov/`. De läser releasen eller källan och körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **De GRÖNA raderna** är de Hermes-prov som nämner en modul som berättelsen ändrar och som var GRÖNA i provvaktens senaste bokförda körning (läst 2026-11-27, «Kedjan kontrollerar i drift»). Alla sjutton finns som filer i `hermes/prov/`. Inget Hermes-prov nämner `approvalSummary`, den tionde källfilen som ändras (Grep i `hermes/prov/` 2026-11-27), så den ger ingen ny rad.
- **bmadglidning (RÖD) och continuityvakt (KUNDE_INTE) står inte i blocket.** Kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (Hermes förkontroll, filen forkontroll.py under hermes/skills, funktionen `_k4`; underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Berättelsen gör dem inte röda och ska inte göra dem gröna. Samma val gjordes i Story 4.1–4.4.
- **Inga `beroende:`-rader.** Inget paket tillkommer. K5 läser i kedjan cto bara rotens `package.json`, som saknar `dependencies`, och fäller därför varje beroenderad, också för zod, pg, vitest och supertest som `server/package.json` redan har.
- **Inga `kontrakt:`-rader.** K8 kräver att ett kontrakts prov är ett Hermes-prov i basen (en fil «prov/<namn>.py») som är GRÖNT. Kontraktet för `binda_kostnad` och svepets svar hålls av vitest-fallen i den nya provfilen (F1, F2) och i de befintliga proven.
- **Inga `kommando:`-rader.** K7 godtar bara git-läsformer, och kedjan cto ger inte byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). Körningarna i Tasks är inga rutor.
- **Inga `kraver:`- eller `namner:`-rader.** Bygget skriver bara filer i kopian, och ordregelns fyra ord förekommer inte i berättelsen.

## Acceptance Criteria

Lydelsen är epics.md:s, ordagrant. Under de kriterier som lovar att något aldrig sker eller gäller alla fall står raden «Mätbart» med mekanismen och den ändliga fallistan. Fallens fulla förväntan står i Dev Notes, avsnittet «Fallen».

1. **Given** spärren ur Story 1.8
   **When** berättelsen byggs
   **Then** står den kvar: svepet köar alltid ett `binda_kostnad`-förslag (`actor: agent`), också till ström eller uppdrag, och ingen kodväg binder en kostnad med `UPDATE receipts` utan godkänd köpost.
   - **Mätbart:** mekanismen är en enda väg in. `bindaKostnad` i `server/src/services/uppdragKostnad.ts` är den enda skrivningen av `receipts.contract_part_id`, och den nås bara genom `binda_kostnad`:s handler, som går genom `registreraJa` och kräver en mottagen köpost. Ett förifyllt förslag kan bara skapas av svepets bindningssteg, eftersom `koasAvSvepet` får `executeAction` att avvisa indata med `forslagsunderlag`. Svepet köar varje kandidat vars underlag håller mot `BindaKostnadSchema`. Ett underlag som inte håller köas inte, binder 
```

## Utfall
Tester: 217 passed (217) · Granskning: GODKANT | Alla nio acceptanskriterier är implementerade, föregående fynd är åtgärdat och inga nya fynd återstår. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
