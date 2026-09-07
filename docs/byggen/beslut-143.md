# Bygge beslut #143 — Två nya kravManniska-åtgärder, `paborja_leverabel` (`ej_paborjad`→`pagar`) och `godkann_leverabel` (

Datum: 2026-09-07 09:40 · Branch: cto/tv-nya-kravmanniska-tg-rder-paborja-leve-143 · Overlamning: #143

## Mal
Två nya kravManniska-åtgärder, `paborja_leverabel` (`ej_paborjad`→`pagar`) och `godkann_leverabel` (`levererad`→`godkand`), som stänger statusflödets luckor så att ett avslut kan visa en tom öppna-lista.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har verifierat underlaget mot koden: `bekraftaStatusbyte` i `uppdragStatus.ts` är mycket riktigt enda skrivvägen till `uppdrag_leverabel.status` (endast `pagar`→`levererad|avvisad`, rad 157), `uppdrag_leverabel_handelse` i 0068 saknar `kanal`/`notering` precis som analysen sa, `signed_date` finns i 0064, migrationskedjan slutar på 0071, och testfilen `uppdragsytan-statusbyte.test.ts` finns. Specen nedan står på det.

---

MAL | Statusflödets två saknade övergångar finns som människokrävande åtgärder — `paborja_leverabel` (`ej_paborjad`→`pagar`) och `godkann_leverabel` (`levererad`→`godkand`) — så att alla FR-12:s fem lägen nås och ett avslut kan visa en TOM öppna-lista (`avslutat_med_oppna`).
KALLA | Överlämning #143 (vd 2026-09-07, Linear LOC-418) + Davids ja 2026-09-07 inkl. JA till migration 0072 (två nullbara kolumner, kanal-CHECK som speglar zod-enumen, datum i befintliga `bekraftat_nar`); Davids mandat 3/9 och 5/9.
ARKITEKTUR | Endast befintliga mönster: `def()` i actions-registret med zod-`.strict()` (`UuidSchema`, `safeText`, `IsoDateSchema` ur `lib/validation.ts`), `kravManniska`-spärren i `executeAction`, tjänst i `services/uppdragStatus.ts` efter `bekraftaStatusbyte`-mönstret (`FOR UPDATE`-lås, händelse + status + `koaRegisterkopia` i samma `withTenantTransaction`), append-only `uppdrag_leverabel_handelse` (SELECT+INSERT), idempotent migrationskedja, vitest mot riktig Postgres.
KRAV-1 | Migration `0072` (idempotent, ADDITIV): kolumnerna `kanal` (text, nullbar, `CHECK (kanal IS NULL OR kanal IN ('telefon','mejl','mote','protokoll'))`) och `notering` (text, nullbar) läggs på `uppdrag_leverabel_handelse`; inget befintligt ändras.
KRAV-2 | Åtgärd `paborja_leverabel` (`write`, `kravManniska`) i `actions/registry.ts`: indata `{ contract_id: Uuid, leverabel_kod: safeText(50), nar?: IsoDate, notering?: safeText(500) }` `.strict()`; flyttar `ej_paborjad`→`pagar`; annan status ger 409 `leverabel_ej_ej_paborjad` med samma felform som `leverabel_ej_pagaende`.
KRAV-3 | Åtgärd `godkann_leverabel` (`write`, `kravManniska`): indata som KRAV-2 plus `kanal: z.enum(['telefon','mejl','mote','protokoll'])`; flyttar `levererad`→`godkand`; annan status ger 409 `leverabel_ej_levererad`; saknas avtalets `godkannare` skrivs INGENTING och 409 `saknad_mottagare` kastas; händelsens mottagare läses ur avtalets `godkannare`, aldrig ur indata.
KRAV-4 | Båda skriver EN rad i `uppdrag_leverabel_handelse` i samma transaktion som statusuppdateringen: `fran`/`till`, `bekraftat_av` = userId ur åtgärdskontexten (aldrig ur indata), `bekraftat_nar` = `nar` om angivet annars nu, `notering`; `godkann_leverabel` även `kanal`; `revision` alltid NULL och `paborja_leverabel` utan mottagare — ingen av dem är en överlämning.
KRAV-5 | Bakåtdatering begränsad: `nar` i framtiden ger 400 `framtida_datum`; `nar` före avtalets `signed_date` ger 400 `fore_avtalet`.
KRAV-6 | Leverabeln låses med `SELECT ... FOR UPDATE` före statuskontrollen (samma race-skydd som `bekraftaStatusbyte`), och registerkopian köas om via `koaRegisterkopia` i samma transaktion eftersom statusen står i kopians innehåll.
KRAV-7 | 0068-triggern `vagrar_skrivning_pa_avslutat` kringgås inte: båda åtgärderna nekas på ett avslutat uppdrag.
KRAV-8 | Vitest i `server/test/uppdragsytan-statusbyte.test.ts` (utöka filen): (a) `ej_paborjad→pagar→levererad→godkand` går hela vägen och ger fyra händelserader; (b) `godkann_leverabel` utan `godkannare` ger 409 `saknad_mottagare`; (c) `paborja_leverabel` på redan påbörjad ger 409; (d) agentanrop på båda ger 403 `human_required`; (e) `nar` i framtiden ger 400; (f) när alla leverabler står i `godkand` ger `avsluta_uppdrag` en TOM `avslutat_med_oppna`.
KRAV-9 | docs/MCP_ACTIONS.md: de två åtgärderna in i modulens avsnitt med flödet på en rad (`ej_paborjad → pagar → levererad → godkand`, plus retur-grenen `pagar → avvisad`); docs/STATUS.md en rad i sessionsloggen.
ACCEPTANS | `npm run migrate`, `npm test` och `npm run build` gröna med inklistrad riktig utdata; `grep "UPDATE uppdrag_leverabel"` visar att varje skrivväg ligger i `uppdragStatus.ts` bakom `executeAction`; test (f) bevisar storyns poäng — tomt avslut.
AVGRANSNING | Rör inte `bekrafta_statusbyte`, svepets förslagsskrivning, `avsluta_uppdrag`, vyerna eller något befintligt i schemat; endast `uppdragStatus.ts`, `actions/registry.ts`, `migrations/0072`, `uppdragsytan-statusbyte.test.ts`, `MCP_ACTIONS.md`, `STATUS.md` ändras.
uteslutet: automatisk statussättning ur tid, svepet eller Drive — källan kräver det inte
uteslutet: knappar eller vyändringar för de två åtgärderna — källan kräver det inte
uteslutet: kanal eller mottagare på `paborja_leverabel` — källan kräver det inte
uteslutet: ångra-/bakåtövergångar från `godkand` eller `avvisad` — källan kräver det inte
uteslutet: revisionsräkning i de nya händelserna — källan kräver det inte
```

## Utfall
Tester: 134 passed (134) · Granskning: GODKANT | Alla krav (0072, båda åtgärderna, transmittalreglerna, låset, triggern, testerna a–f, dokumenten) är uppfyllda med enbart befintliga mönster och utan nya beroenden eller filer utanför avgrän · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
