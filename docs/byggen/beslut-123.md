# Bygge beslut #123 — Drive-kön för registrets frysta kopia: en registerändring går alltid igenom lokalt och markerar refe

Datum: 2026-09-06 16:45 · Branch: cto/drive-k-n-f-r-registrets-frysta-kopia-en-123 · Overlamning: #123

## Mal
Drive-kön för registrets frysta kopia: en registerändring går alltid igenom lokalt och markerar referensen `ko_status='koad'`, kön syns som öppen post i vyn, och Hermes (S7.5) tömmer den via två nya åtgärder — hämta kön samt rapportera `skriven`/`fel` med felet synligt loggat.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är på plats: jag har läst 0068:s `uppdrag_referens` (CHECK:en saknar `fel`, ingen felkolumn), S7.1:s tjänst `uppdragReferens.ts`, registrets enda skrivväg (importen, `uppdragImport.ts` steg e), 1E Del 3/ADR-4 (kön bor på referensen; rapporten bär Drive-id), `kravManniska`-mekaniken i `execute.ts:56` och vymönstret från S4.1/S5.1. Här är kravspecen:

---

MAL | Drive-kön för registrets frysta kopia: en registerändring går alltid igenom lokalt och köar kopian som synlig öppen post, och Hermes (S7.5) kan tömma kön via två åtgärder utan handpåläggning, med fel som lagrat, synligt tillstånd — inga tysta fel. Utan den är S7.5 tömningslös (S7.2; FR-11, NFR-3, NFR-5).
KALLA | Överlämning #123 med CTO-underlag och Davids ja + svar på analysfrågan 6/9 (additivt `fel` + felkolumn OK); 1F S7.2 med acceptans; 1E Del 3 (kön bor på `uppdrag_referens`, rad 447 redan uppdaterad med 0071-avvikelsen) och ADR-4 (repot ringer aldrig ut; S7.5 rapporterar `skriven` med Drive-id); PRD FR-11/NFR-3/NFR-5; byggjournal beslut-120 (S7.1).
ARKITEKTUR | Åtgärdsregistrets `def` med zod-`.strict()` och `kravManniska`-spärren (`execute.ts:56`); tjänstelagret med `PoolClient`+`companyId` under `withTenantTransaction` (RLS, `company_id` ur medlemskapet, audit via `executeAction` i samma transaktion); numrerad idempotent migrationskedja; UPDATE med fasta kolumnnamn och parametriserade värden; JS-fri serverrenderad vy med befintliga komponentklasser; vitest mot riktig Postgres. Inga nya beroenden, ingen scheduler, inga externa anrop (samma enkelriktade hållning som `ingest_crm_events`).
KRAV-1 | Migration `0071` (additiv, idempotent): CHECK:en på `uppdrag_referens.ko_status` utökas till `NULL|koad|skriven|fel`, ny kolumn `ko_fel text` (NULL = inget fel) med kommentar; befintliga rader, värden och NULL-semantik rörs inte, ingen GRANT-ändring (app har redan UPDATE).
KRAV-2 | `services/uppdragReferens.ts` får `koaRegisterkopia(client, companyId, contractId)`: upsertar uppdragets EN kopiereferensrad (`sort='drive'`, `extern_nyckel='registerkopia'`, `extern_kalla` för spärrmappen; första gången platshållar-`extern_id` `registerkopia:<contract_id>` tills Drive-id:t finns) och sätter `ko_status='koad'`, `ko_fel=NULL` — även från `skriven`/`fel` (omkö vid ny ändring).
KRAV-3 | `hamtaDriveKo(client, companyId)`: alla referenser med `ko_status IN ('koad','fel')` — per post `referens_id`, `contract_id`, `ko_status`, `ko_fel` samt innehållet som ska skrivas, härlett vid hämtning ur `lasLeverabelregister` (kopian är derivat och lagras aldrig i kön); `fel`-poster ingår så att Hermes provar om dem när Drive svarar.
KRAV-4 | `rapporteraDriveKopia(client, companyId, {referens_id, utfall})` (zod-strict, discriminated union): `skriven` med `drive_id` (S7.1:s `StabiltIdSchema`) sätter `ko_status='skriven'`, `extern_id=drive_id`, `ko_fel=NULL`; `fel` med feltext sätter `ko_status='fel'`, `ko_fel`=texten; rapport mot en rad utan öppen köpost (`ko_status` NULL eller okänd referens) fälls med begripligt fel — ingen tyst övergång.
KRAV-5 | Köning i registrets skrivväg: importen (`uppdragImport.ts`, efter steg e:s registerrader) anropar `koaRegisterkopia` i SAMMA transaktion som registerändringen; funktionen exporteras så kommande skrivvägar (S3.2:s `bekrafta_statusbyte`) köar samma väg.
KRAV-6 | Två def-poster i `actions/registry.ts`: `hamta_drive_ko` (`read`) och `rapportera_drive_kopia` (`write`, UTAN `kravManniska` — kön ska tömmas utan handpåläggning, agent-actor tillåten); handlrar delegerar till tjänsten, ingen SQL i registret; båda dokumenteras under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md`.
KRAV-7 | Vyn: uppdragets projektsida (`/app/c/:id/projects/:pid`) visar öppen köpost tills `skriven` — `koad` som väntande, `fel` med `ko_fel`-texten synlig — med befintliga komponentklasser (chip/muted), JS-fritt, ingen ny CSS, läst via tjänstens funktioner (vyn rör aldrig `uppdrag_referens` själv).
KRAV-8 | Ny svit `server/test/uppdragsytan-drive-ko.test.ts`: `koad→skriven` (extern_id blir Drive-id:t), `koad→fel` (felet läsbart i `ko_fel` och i hämtningen), omkö efter `skriven`/`fel`, negativ kontroll (rapport utan öppen köpost fälls), registerändring via importen skapar köposten i samma transaktion, hämtningen bär registerinnehållet, agent får köra rapportåtgärden, tenant-isolering (grannbolag ser/rör inte kön).
ACCEPTANS | `npm test` och `npm run build` gröna med faktisk inklistrad utdata; granskaren kan visa att en registerändring alltid går igenom utan externa anrop och lämnar synlig köpost, att `fel` är lagrat+synligt i vy och hämtning (aldrig svalt), att tillståndsmaskinen har negativ kontroll i sviten, och att rapportvägen fungerar med actor agent; migrationen är idempotent (två körningar); MCP_ACTIONS.md- och STATUS.md-raderna finns.
AVGRANSNING | Minsta möjliga: inga andra kolumner eller GRANT-ändringar i 0071; befintliga `ko_status`-värden och rader orörda; ingen sensitivity- eller `kravManniska`-ändring på befintliga åtgärder; ingen scheduler, cron eller Drive-anrop i repot; `.env`, `time_entry_links` och 1E:s `.py`-prov rörs inte; S10.1:s egen uppdragsvy byggs inte.
uteslutet: automatisk omprovning/backoff eller retry-räknare i repot — kallan kraver det inte (Hermes provar om vid nästa svep, `svepfarskhet.py` fäller gammal kö vid S7.5)
uteslutet: egen kötabell — kallan kraver det inte (1E Del 3: kön bor på referensen, en köad kopia ÄR en oskriven referens)
uteslutet: lagring av kopians innehåll eller Drive-skrivning i repot — kallan kraver det inte (kopian är derivat, Hermes äger Drive-åtkomsten, ADR-4)
uteslutet: `kor_uppdragssvep` och arbetslistemekaniken — kallan kraver det inte (S7.3)
uteslutet: notifiering/larm vid `fel` — kallan kraver det inte (synlig köpost + loggat tillstånd bär NFR-3; larmbäraren är Hermes provvakt i S7.5)
uteslutet: manuellt Drive-nere-scenario som automattest — kallan kraver det inte (uttryckligen manuellt vid S7.5:s driftsättning med loggraden som bevis)

---

Specen är självbärande: utvecklaren behöver bara den plus `docs/ARKITEKTUR.md`. Två designval värda att känna till som jag löste ur källorna snarare än gissade: (1) förstagångskön har inget Drive-id ännu, så kopiereferensen föds med ett deterministiskt platshållar-id och får sitt riktiga `extern_id` när Hermes rapporterar `skriven` med Drive-id — exakt vad S7.5-storyn säger att rapporten bär; (2) `fel`-poster ingår i hämtningen, annars kan kön aldrig "tömmas automatiskt när Drive svarar" efter ett fel. Noterat även att 1E rad 447 redan bär 0071-avvikelsen, så det efterarbetet David nämnde är gjort.
```

## Utfall
Tester: 119 passed (119) · Granskning: GODKANT | Alla åtta krav är uppfyllda med minsta möjliga ändring inom repots mönster (0071 additiv/idempotent med 0068:s autonamngivna CHECK, upsert via befintliga `skapaReferens` vars url-spärr släpp · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
