# PRD-bygget uppdragsytan 1-8-ingen-kostnad-binds-utan-davids-godkannande — PRD uppdragsytan 1-8-ingen-kostnad-binds-utan-davids-godkannande: # Story 1.8: Ingen kostnad binds u

Datum: 2026-10-11 16:58 · Branch: cto/prd-uppdragsytan-1-8-ingen-kostnad-binds-utan-davids-godkann-9190 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-8-ingen-kostnad-binds-utan-davids-godkannande: # Story 1.8: Ingen kostnad binds utan Davids godkännande Status: ready-for-dev <!-- Note: Validation is optional. Run va

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.8: Ingen kostnad binds utan Davids godkännande

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.7 (done enligt sprint-status.yaml) och därmed 1.1–1.6. Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Ingen migration, ingen ny tabell, ingen ny åtgärd. -->
<!-- Story key: 1-8-ingen-kostnad-binds-utan-davids-godkannande · Story ID: 1.8 · Skapad 2026-10-11 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att ingen kostnad binds till en leverabel, en ström eller uppdraget utan att förslaget först når mig,
so that mitt mandat över kostnaderna gäller från första leveransen och inte först när pengaytan byggs.

**Krav:** FR-4 och FR-33 (varje bindning når David, också till ström eller uppdrag, och verkställs aldrig automatiskt), FR-41 och NFR-4, ur `epics.md` rad 882–915. **Regression:** FR-25 (uppfyllt i koden). Belopp läses ur redovisningen och kopieras aldrig. Arkitekturens grund är B-6 (`architecture.md` rad 740–749), kommunikationsmönstret ”Mandatförslag skapas på två sätt” (rad 925–929), svepkontraktet (rad 951–955), B-3:s tabeller (rad 458–476) och B-13 (rad 535). Genomförandeordningen har berättelsen som punkt 6 (rad 776). PRD:ns lydelse: FR-4 (`prd.md` rad 464–472) och FR-33 (rad 528–540).

**Läget i dag, i en mening.** Svepets bindningssteg (`bindSvepetsForslag`, `server/src/services/uppdragKostnad.ts` rad 113–190) köar en `binda_kostnad` bara när kostnadsförslagets leverabel har en aktiv avtalsdel (”gren 1”). Annars binder det kvittot direkt till strömmen eller rotdelen `UPPDRAG` med `UPDATE receipts SET contract_part_id = …, oplanerad = true`, utan köpost och utan godkännande (”gren 2”, rad 154–187). Idempotensen gäller bara väntande köposter (rad 86–106), så ett avslag föreslås igen i nästa svep. Kodgranskningen ger FR-4 och FR-33 DELVIS (`underlag/kodgranskning.md` rad 21 och 50).

**Vad berättelsen gör.**
1. **Bindningssteget får en enda väg.** Varje kostnadsförslag blir en köad `binda_kostnad` med `actor: 'agent'`. Målet är lövet när leverabeln har en aktiv avtalsdel, och annars den ström eller det uppdrag som gren 2 binder till i dag. Gren 2, vakten `kravAutomatmal` och svepets `UPDATE receipts` tas bort. Valet av mål blir den rena funktionen `valjBindningsmal` i den nya filen `server/src/lib/bindningsmal.ts`. Både svepets cache och bindningssteget anropar den (arkitekturens ”En regel har en plats”).
2. **Idempotensen gäller köposter i alla statusar.** En listfråga per körning tar fram de kvitton som redan har en `binda_kostnad`. Ett nej återkommer inte som ny fråga.
3. **Skälet till ström eller uppdrag står i underlaget.** `beskrivKostnadsbindning` säger varför förslaget gäller den grövre nivån. Samma beskrivare fryser underlaget i `uppdrag_beslut` (Story 1.7).
4. **Ett obundet kvitto med bindningsförslag ingår i uppdragets kostnader som obundet.** `lasUppdragspengar` får fältet `obundna_kostnader` per avtal som ett `Lasvarde` med källa och lästid (B-12). Pengar-sidan visar raderna som ”Obunden” med en `.farskhet`-rad.
5. **Dokumentationen och de befintliga proven följer med.** Svarets `bindningar.automatiska` står kvar men är alltid tom, eftersom svepets svar aldrig tappar fält.

**Vad berättelsen inte gör:**
- **Ingen förifyllning ur bokföringsdata** (datum mot leverablernas intervall, leverantör mot tidigare bindningar, verifikattext), ingen `oplanerad`-märkning och ingen idempotens per `forslag_hash`. Det är Story 5.1.
- **Ingen summerad uppdragstotal** med ofördelad tid (B-13) och ingen `Lasvarde` på de bundna raderna (`Kostnadsrad`). Story 5.1 har kriteriet att en obunden kostnad ingår i totalen (`epics.md` rad 2342–2344). Story 5.2 har totalen med ofördelad tid och källa och lästid per kostnadsrad (rad 2366–2394). Båda läser samma `obundna_kostnader`.
- **Inget nytt fält i `binda_kostnad`.** Schemat står kvar som `{ receipt_id, contract_part_id }.strict()` (`registry.ts` rad 1929).
- **Ingen migration, ingen ny tabell och ingen ny åtgärd.**
- **Ingen ändring** av åtgärden `binda_kostnad`:s definition, `bindaKostnad`, `registreraJa`, `registreraNej`, `approveAction`, `rejectApproval`, svepets cachenyckel `kostnadsforslag:` eller täckningsregeln för `kostnader` (`uppdragUndantag.ts` rad 375–399).
- **Ingen undantagsvy och ingen ny rutt.** Det är Story 1.11.
- **Ingenting under `hermes/`.** `bakvag.py`:s fjärde kontroll läser efter bygget bara historiska auditrader (Dev Notes → ”Kedjan kontrollerar i drift”).
- **Ingen ändring av redan bundna kvitton i drift.** Kostnader som gren 2 bundit före bygget står kvar bundna. Frågan om de ska läggas fram i efterhand står sist under ”Frågor till David”.

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med proven K0–K7 i Dev Notes → ”Prov och verifiering”. Varje uppgift skriver sina egna fall och visar dem röda innan koden skrivs. Den lämnas först när fallen är gröna.

## Acceptance Criteria

Kriterierna 1–5 är ordagranna ur `epics.md` (Story 1.8, rad 893–915). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”ingen”, ett ”alla” eller ett ”samtliga” sant genom konstruktion, alltså en enda väg in, en enda skrivsats eller ett fält som aldrig förs vidare.
- **Fallista:** den ändliga lista som provet prövar. Inget prov letar efter ”varje skrivning” i koden.

Allt prövas i kopian. K-numren står i Dev Notes → ”Prov och verifiering”.

1. **Svepet köar i stället för att binda.**
   **Given** svepets kostnadssteg
   **When** en projektkopplad kostnad saknar bindning och ingen leverabel kan föreslås
   **Then** köas ett `binda_kostnad`-förslag (`actor: agent`) till den ström eller det uppdrag som grenen i dag binder till direkt, med källan och skälet i underlaget
   **And** grenen som binder med `UPDATE receipts` utan godkännande (`uppdragKostnad.ts`, ”gren 2”) finns inte längre.
   - *Mätbart:*
     - **Projektkopplad kostnad** är ett bokfört kvitto utan avtalsdel som svepet gett ett kostnadsförslag. Leverantörens namn står då i titeln på en leverabelhandling i uppdragets indata (`uppdragSvep.ts` rad 689–735, cachenyckeln `kostnadsforslag:<receipt_id>`). Kvitton utan förslag rörs inte, som i dag.
     - **Ingen leverabel kan föreslås** betyder att förslagets `leverabel_kod` saknar en aktiv avtalsdel i senaste versionen (`delar.alla` ur `bindningsmal`, `uppdragSvep.ts` rad 320–343). Det är exakt villkoret för gren 2 i dag (`uppdragKostnad.ts` rad 126–130).
     - **Den ström eller det uppdrag som grenen binder till i dag** är strömmen vars intervall täcker kvittots datum, i avtalets ordning, och annars rotdelen `UPPDRAG` (`uppdragKostnad.ts` rad 157–159). Regeln flyttas oförändrad till `valjBindningsmal` i `lib/bindningsmal.ts` (Task 1).
     - **Köposten:** `action = 'binda_kostnad'`, `input` exakt `{ receipt_id, contract_part_id }`, `requested_actor = 'agent'`, `requested_by` = den som kör svepet och `status = 'pending'`. Auditraden `action.approval_requested` har köpostens id som `entity_id` och `details` = `{ action: 'binda_kostnad', actor: 'agent', receipt_id, leverabel_kod }`. Kvittots `contract_part_id` och `oplanerad` är oförändrade, och ingen `receipt.contract_part_assigned` skrivs.
     - **Med källan och skälet i underlaget:** posten för köposten i `las_undantag` bär `skal` = texten i Dev Notes → ”`services/uppdragUndantag.ts`”, med svepcachens `kalla` och `last_nar`. Den bär också `kallor` med handlingens `uppdrag_referens` och kvittoytan. `uppdrag_beslut.underlag` byggs av samma beskrivare (`byggUnderlag`, `uppdragBeslut.ts` rad 88–108). Vid ja eller nej fryses därför `underlag.s
```

## Utfall
Tester: 150 passed (150) · Granskning: GODKANT | Samtliga acceptanskriterier är implementerade, inga konkreta fynd kvarstår och kedjans typecheck och testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
