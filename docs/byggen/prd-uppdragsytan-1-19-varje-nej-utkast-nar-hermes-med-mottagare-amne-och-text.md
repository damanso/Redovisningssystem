# PRD-bygget uppdragsytan 1-19-varje-nej-utkast-nar-hermes-med-mottagare-amne-och-text — PRD uppdragsytan 1-19-varje-nej-utkast-nar-hermes-med-mottagare-amne-och-text: # Story 1.19: Varje n

Datum: 2026-10-26 00:15 · Branch: cto/prd-uppdragsytan-1-19-varje-nej-utkast-nar-hermes-med-mottag-9285 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-19-varje-nej-utkast-nar-hermes-med-mottagare-amne-och-text: # Story 1.19: Varje nej-utkast når Hermes med mottagare, ämne och text Status: ready-for-dev <!-- Note: Validation is op

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.19: Varje nej-utkast når Hermes med mottagare, ämne och text

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn), tillagd 2026-10-21 efter Davids svar 2026-10-07 på FR-42 (IR-01). Beror på: Story 1.16, som är mergad till main (byggjournalen docs/byggen/prd-uppdragsytan-1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar.md finns, och migration 0084 och 1.16:s namn finns i arbetskopian). Ingen migration, inget nytt paket, ingen ny env, ingen ny åtgärd och ingen ny tjänst. Våg 17 i parallelization-analysis.md (rad 538–540). -->
<!-- Story key: 1-19-varje-nej-utkast-nar-hermes-med-mottagare-amne-och-text · Story ID: 1.19 · Skapad 2026-10-25 med BMAD create-story i autonomt läge (YOLO). Radnumren i Dev Notes → ”Läget i dag” är lästa i arbetskatalogen samma dag. -->

## Story

As a David,
I want att svarsutkastet efter mitt nej når Hermes med mottagare, ämne och text precis som det fryses,
so that det kan läggas färdigt i min Gmail-utkastmapp utan att jag kopierar något och utan att redovisningen ringer ut.

**Krav:** FR-42 (utkastet i Gmails utkastmapp enligt Davids svar 2026-10-07, «Lägger utkast i gmails utkastfolder»), FR-41 punkt (3c) och (4), FR-26, NFR-1 och NFR-6. Källan är epics.md, Story 1.19 (rad 1612–1665). PRD:ns lydelse står i FR-42 (prd.md rad 887–897), FR-26 (rad 786), NFR-1 (rad 931) och NFR-6 (rad 979). Davids svar står i underlag/davids-svar.md rad 33–35 och gäller som beslut.

**Arkitekturens grund** (architecture.md):
- B-5 (rad 723–747), särskilt *Finns* (rad 725), *Beslut* om Davids skickhandling och utskicksgränsen, och *Det faktiska utfallet*, där formen `{utkast_typ, utkast_id, mottagare, amne, text, markor, byggd_nar}` och den slutna listan `beslut | eskalering | rapport` står;
- åtgärdstabellen, raden `kor_uppdragssvep` (utökas) (rad 448);
- dataflödet (rad 1325): `kor_uppdragssvep` ─→ `oppna_utkast[]` ─→ Hermes (Story 1.20) ─→ Gmails utkastmapp ─→ David skickar, med `mailto:` på Läget som reserv;
- katalogträdet (rad 1130): uppdragSvep.ts får `oppna_utkast[]` med `amne` och `text` (Story 1.19);
- besluten under Utvecklingsflödet om redovisningsberättelser i byggkedjan (rad 1388–1401), diffen (rad 1414), att beroendet ska vara mergat (rad 1415) och redovisningens prov ”Davids utskick” (rad 1416).

**Läget efter Story 1.16, i en mening.** Ett nej på en Övrigt-fråga fryser utkastet i beslutsraden (`uppdrag_beslut.utkast` med mottagare, ämne och text, och `utkast_markor`, migration 0084), och Hermes kan läsa det bara genom `las_uppdragslage` per uppdrag. Svepets arbetslista, den enda väg där Hermes får redovisningens arbete i varje körning, har bara `referenser`, `drive_ko` och `ovrigt_kandidater` (`server/src/services/uppdragSvep.ts` rad 306 och 929).

**Vad berättelsen gör.** Arbetslistan i svaret från `kor_uppdragssvep` får det nya fältet `oppna_utkast[]`, en post per nej-utkast i bolaget, i den form som Story 1.20, 7.1 och 12.5 bygger på.
1. **Läsningen (Task 1).** I `server/src/services/uppdragSvep.ts` tillkommer den slutna listan `UTKAST_TYPER`, typen `Oppetutkast` och funktionen `listaOppnaUtkast(client, companyId)`. Funktionen gör en enda fråga mot de frysta beslutsraderna och skriver ingenting.
2. **Fältet i svaret (Task 2).** `korUppdragssvep` lägger listan i arbetslistan, efter att mottagna beslut verkställts. Provet K7 i `server/test/uppdragsytan-ovrigt.test.ts`, som prövar arbetslistans exakta nyckelmängd, ändras i samma ändring.
3. **Dokumentationen (Task 3).** `docs/MCP_ACTIONS.md`, `docs/ARKITEKTUR.md` och sessionsloggen i `docs/STATUS.md`.

Fallen ligger i `server/test/uppdragsytan-utskick.test.ts`, i nya describe-block efter provet ”Davids utskick”, som står orört.

**Vad berättelsen inte gör:**
- ingen Gmail-kod och ingen ändring under `hermes/`: Hermes lägger utkasten i Gmail i Story 1.20, och redovisningen ringer aldrig ut (ADR-4);
- ingen ändring i svepets indata (`SvepIndataSchema`), i registret, i panelen ”Beslut och utkast” eller i `las_uppdragslage`;
- inga eskaleringsutkast (Story 7.1), inga rapportutkast och inget utfall för skickade utkast (Story 12.4–12.5). Typlistan har redan deras värden, men berättelsen lämnar bara `beslut`;
- ingen migration, ingen ny tabell och ingen ny kolumn.

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan och byggrinden”).
- Förutsättningen före Task 1 prövar att Story 1.16 är mergad, belagt med byggjournalen, och att kopian inte bär rester av ett tidigare bygge av den här berättelsen.
- Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med fallen i Dev Notes → ”Prov och verifiering”.
- Varje uppgift skriver sina egna fall. Fallen beläggs röda innan koden skrivs och gröna efteråt.
- Med skal görs det med vitest och inklistrad utdata. Utan skal skriver du ”inte kört i sessionen: <skälet>” och det förutsagda utfallet i Debug Log och lämnar uppgiften till granskning utan HALT (architecture.md rad 1397).
- Grindarna `npm run typecheck` och `npm test` kör kedjan efter dig och före granskningen, och deployen kör bygget. Ingen ruta ber dig köra en grind.

## Förkrav

Blocket räknar upp allt bygget kräver. Baslinjen är läst ur provvaktens senaste bokförda körning (2026-10-25 06:30, körning 4dc1880cc63a). 28 prov stod där inte GRÖNT (ROD eller KUNDE_INTE). Inget av dem nämner någon av de ändrade modulerna som helt ord: uppdragSvep, uppdragsytan-utskick, uppdragsytan-ovrigt, MCP_ACTIONS eller ARKITEKTUR (Grep i hermes/prov, prov direkt under katalogen). Därför ger baslinjeregeln inga rader med RÖD eller KUNDE_INTE. De åtta Hermes-prov som enligt berättelsens text ska stå kvar GRÖNA (Tekniska krav och Dev Notes → ”Kedjan kontrollerar i drift”) var GRÖNA i baslinjen och står som `prov: … berörs GRÖN`. De läser releasen, och redovisningens byggkedja kör dem inte: för kedjan cto gäller inte K9, och K4 hoppar över ett deklarerat GRÖN.

```förkrav
fil: server/src/services/uppdragSvep.ts ändras
fil: server/test/uppdragsytan-utskick.test.ts ändras
fil: server/test/uppdragsytan-ovrigt.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/services/uppdragOvrigt.ts läses
fil: server/src/lib/utkast.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/migrations/0080_uppdrag_beslut.sql läses
fil: server/migrations/0083_forslag_ersatt.sql läses
fil: server/migrations/0084_utkast_markor.sql läses
fil: server/test/utkastRigg.ts läses
fil: server/test/ovrigtRigg.ts läses
fil: server/test/kompletteringRigg.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/uppdragsytan-svep-bindning.test.ts läses
fil: server/test/uppdragsytan-kostnadssparr.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/package.json läses
fil: docs/project-context.md läses
fil: docs/byggen/prd-uppdragsytan-1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar.md läses
prov: modulprov berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: flerbolag berörs GRÖN
prov: svepet berörs GRÖN
prov: handgrepp berörs GRÖN
prov: continuityvakt berörs GRÖN
prov: agandegrans berörs GRÖN
prov: davids_utskick berörs GRÖN
beroende: vitest
beroende: supertest
beroende: pg
beroende: zod
tjanst: 127.0.0.
```

## Utfall
Tester: 174 passed (174) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade och täcks av fall som ingår i kedjans gröna körning (174 sviter); diffen och File List stämmer överens, och kvar står bara tre LOW-fynd i dokume · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel uppdragsytan
Allt pa Davids abonnemang - inga API-tokens.
