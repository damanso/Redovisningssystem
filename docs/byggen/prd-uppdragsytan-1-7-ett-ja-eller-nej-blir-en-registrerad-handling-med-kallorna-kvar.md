# PRD-bygget uppdragsytan 1-7-ett-ja-eller-nej-blir-en-registrerad-handling-med-kallorna-kvar — PRD uppdragsytan 1-7-ett-ja-eller-nej-blir-en-registrerad-handling-med-kallorna-kvar: # Story 1.7: E

Datum: 2026-10-11 06:19 · Branch: cto/prd-uppdragsytan-1-7-ett-ja-eller-nej-blir-en-registrerad-ha-9189 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-7-ett-ja-eller-nej-blir-en-registrerad-handling-med-kallorna-kvar: # Story 1.7: Ett ja eller nej blir en registrerad handling med källorna kvar Status: ready-for-dev <!-- Note: Validation

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.7: Ett ja eller nej blir en registrerad handling med källorna kvar

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.3, 1.4, 1.5 och 1.6 (alla done enligt sprint-status.yaml). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. parallelization-analysis.md rad 382 reserverar migrationen 0080_uppdrag_beslut.sql för berättelsen och anger dess filgräns. -->
<!-- Story key: 1-7-ett-ja-eller-nej-blir-en-registrerad-handling-med-kallorna-kvar · Story ID: 1.7 · Skapad 2026-10-07 med BMAD create-story i autonomt läge (YOLO). -->
<!-- Rättad 2026-10-07 med BMAD correct-course efter bygge #9170 (HALT: saknat arkitekturbeslut om avslutstriggern). Berättelsens tre tekniska vägval står nu som beslut i architecture.md (B-1 ”Avslutstriggern”, tillägget sist i B-2). Se Dev Notes → ”Correct-course 2026-10-07” och sprint-change-proposal-1-7-…md. -->
<!-- Rättad igen 2026-10-07 med BMAD correct-course, andra varvet, efter stoppet som följde valideringen 17:43. architecture.md saknade de tre besluten från förra varvet, eftersom en annan berättelses correct-course hade skrivit tillbaka filen 17:26. Besluten är återinförda utan att någon rad i architecture.md flyttats. Byggkedjan har en förkontroll med exakt HALT-text, och beslutad_av och beslutad_nar läses i SQL ur köposten. Se Dev Notes → ”Correct-course 2026-10-07, andra varvet”. -->

## Story

As a David,
I want att mitt ja eller nej på ett förslag blir en registrerad handling i uppdraget med förslaget och källorna frysta,
so that jag aldrig registrerar samma beslut en gång till och alltid kan följa det tillbaka.

**Krav:** FR-41, FR-2 och FR-4 (samma beslutsspår för varje baselineväg, avslaget synligt i historiken), FR-33 (bindningen som registrerad handling), FR-26 (källorna följer handlingen), NFR-12 (frys–töm–räkna om), NFR-3 och NFR-4, ur `epics.md` rad 775–880. **Regression:** FR-25 (uppfyllt i koden). Beslutsberäkningen är fryst historik och ingen kopia av ekonomidata. Arkitekturens grund är B-1 (`architecture.md` rad 274–294), B-2 (rad 401–416), B-3 (rad 472–505), B-18 (rad 367–371), formatmönstren (rad 866–890) och kommunikationsmönstren (rad 901–933). Genomförandeordningen har berättelsen som punkt 5 (rad 753).

**Läget i dag, i en mening.** Godkännandevägen tar redan emot ett ja eller nej skilt från verkställigheten (Story 1.4), men ingen produktionsåtgärd har `tvafas`, ingen tabell binder ett beslut till sitt förslag och sin källa, svepet tar inte om mottagna beslut, och ett avslag lämnar inget spår i uppdraget. Kodgranskningen ger FR-41 och FR-26 DELVIS (`underlag/kodgranskning.md` rad 58 och 43).

**Vad berättelsen gör.**
1. **Tabellen `uppdrag_beslut`** i migrationen `server/migrations/0080_uppdrag_beslut.sql`. Kategorin är FRYST HISTORIK, och tabellen är append-only med RLS. Varje rad är ett avgjort förslag: källan, köposten, utfallet, det frysta underlaget med `forslag_hash`, skälet vid nej och den faktiska handlingen vid ja.
2. **Den rena regeln `lib/beslutsunderlag.ts`.** Den räknar `forslag_hash`, och den serialiserar med sorterade nycklar. Serialiseringen flyttas hit ur `approvals.ts`, så att regeln har en plats.
3. **Den nya tjänsten `services/uppdragBeslut.ts`.** Den har listan `MANDATATGARDER`, registreringskontraktet (`registreraJa`, `registreraNej`) och nej-åtgärdens tjänst `avbojForslag`.
4. **Registret.** De sex mandatåtgärderna får `tvafas: true`, en handler som skriver beslutsraden i samma transaktion som domänhandlingen och ett `vidAvslag` som skriver nej-raden. Den nya åtgärden `avboj_beslutsforslag` (write, `kravManniska`) tar emot ett nej med skäl.
5. **Svepet tar om mottagna beslut först.** `kor_uppdragssvep` anropar `verkstallMottagnaBeslut` som sitt första steg, och svaret får `mottagna_beslut`.
6. **Läget visar besluten.** `las_uppdragslage` får fältet `beslut` med registrerade beslut och med mottagna beslut som ännu inte verkställts. Lägets vy får panelen ”Beslut”, och ett upprepat ja eller nej på Att göra-sidan leder dit.
7. **Täckningen för `ovrigt` får sin gren för beslutsrader.** Provet `uppdragsytan-agandegrans-cache.test.ts` får förloppet frys–töm–räkna om.

**Vad berättelsen inte gör:**
- **Ingen undantagsvy, ingen rutt `/uppdrag` och ingen menypost.** Det är Story 1.11. Där postar Nej-knappen till `avboj_beslutsforslag`.
- **Ingen `registrera_uppdragsbeslut`, ingen `komplettera_beslutsforslag`, ingen `ersatt_av` och inget `kalla`-fält på `andra_baseline`.** Det är Story 1.14 och 1.15. Kolumnen `alternativ` och kalltypen `anteckning` finns i tabellen men skrivs inte i den här berättelsen.
- **Inget utkast och ingen `utkast_markor`.** Kolumnen `utkast` finns men förblir `NULL`. Markören och utkastet kommer i Story 1.16.
- **Ingen ändring av svepets kostnadsgren (”gren 2”).** Den direkta bindningen tas bort i Story 1.8.
- **Ingen ändring av scopesignalens `avgjord`.** Den nya historiktabellen kommer i Story 1.9.
- **Ingenting under `hermes/`.** Driftprovet för overkställda beslut byggs i Story 1.13. Hermes svepskill rörs inte, eftersom svarets nya fält är additivt.
- **Inga nya kolumner, CHECK-villkor eller triggrar på `action_approvals`.** Kolumnerna och triggern från 0077 räcker. 0080 lägger bara den unika nyckeln `(id, company_id)` som beslutsradens sammansatta FK kräver (AC 1).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med proven P1–P9 i Dev Notes → ”Prov och verifiering”. Varje uppgift skriver sina egna fall och visar dem röda innan koden skrivs, och lämnas först när de är gröna.

## Acceptance Criteria

Kriterierna 1–17 är ordagranna ur `epics.md` (Story 1.7, rad 788–880). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”alla” eller ett ”varje” sant genom konstruktion, alltså en enda väg in, en tillåtelselista eller ett fält som aldrig förs vidare.
- **Fallista:** den ändliga lista som provet prövar.

Allt prövas i kopian. P-numren står i Dev Notes → ”Prov och verifiering”.

1. **Beslutstabellen.**
   **Given** nästa lediga migration
   **When** `uppdrag_beslut` skapas
   **Then** har tabellen kategorin `FRYST HISTORIK` i `COMMENT ON TABLE`, är append-only (`app` får bara `SELECT, INSERT`), har RLS via `app_has_company_access` och sammansatt FK till `contracts`
   **And** den har kolumnerna `kalla_typ` (`anteckning` | `kvitto` | `scopesignal` | `baselineforslag` | `avslut` | `koforslag`), `kalla_id`, `approval_id`, `utfall` (`ja` | `nej`), `alternativ`, `underlag jsonb`, `skal`, `handling jsonb`, `utkast jsonb`, `beslutad_av`, `beslutad_nar` och `forslag_hash`
   **And** `UNIQUE (company_id, kalla_typ, kalla_id, forslag_hash)` och `UNIQUE (approval_id)` gäller
   **And** `agandegrans.py` (Story 1.3) är grönt mot det nya schemat.
   - *Mätbart:* nästa lediga nummer är 0080 (senaste är `0079_baselineversion.sql`). Migrationen står ordagrant i Dev Notes → ”Migrationen 0080”. Utöver de uppräknade kolumnerna har tabellen `id`, `company_id`, `contract_id` och `created_at`.
   - *Mekanism:* append-only bärs av `GRANT SELECT, INSERT ON uppdrag_beslut TO app` och av att ingen kod skriver `UPDATE uppdrag_beslut`. Den sammansatta FK:n är `(contract_id, company_id) REFERENCES contracts (id, company_id)`, i husets ordning (0073). Köposten knyts på samma sätt, `(approval_id, company_id) REFERENCES action_approvals (id, company_id)`, eftersom en barnrad aldrig får kunna hänga på ett annat bolags rad (`docs/project-context.md`, ”Migrationer”). 0080 lägger därför den unika nyckeln `(id, company_id)` på `action_approvals`, och inget annat där. `contract_id` är `NULL` bara när `kalla_typ = 'avslut'`,
```

## Utfall
Tester: 149 passed (149) · Granskning: GODKANT | Alla 17 acceptanskriterier är implementerade, omtagets rättelser håller och kedjans verifierade testutfall är 149/149. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
