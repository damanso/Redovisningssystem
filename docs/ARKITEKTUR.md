# Arkitektur — redovisningssystemet (styrande)

## Mal med produkten

Ett svenskt redovisningssystem for aktiebolag (K2), byggt AI-forst: ett enda action-lager som drivs likvardigt av Claude via MCP, REST-API:t eller den serverrenderade webbvyn (`/app`, JS-fri HTML). Kansliga atgarder (bokfora, betala, lasa period) kraver alltid manskligt godkannande i Att gora — oavsett vem som foreslog dem. David Mancilla kor systemet skarpt lokalt for Locollabs AB; systemet ska vara fullt anvandbart utan AI (vyn ar en fullstandig reserv).

## Teknisk stack

Exakta versioner ur `package.json`/`server/package.json`. INGET far laggas till, bytas eller uppgraderas utan Davids beslut.

- **Node** >= 22 (`engines`), ESM (`"type": "module"`), npm workspaces (enda workspace: `server`)
- **TypeScript** ^5.7.0 (byggs med `tsc`; dev via **tsx** ^4.19.0)
- **Postgres** via **pg** ^8.16.0 — enda databasen; RLS ar barande
- **express** ^5.1.0, **helmet** ^8.1.0, **express-rate-limit** ^8.0.1, **multer** ^2.0.2
- **zod** ^3.25.0 + **zod-to-json-schema** ^3.25.2 (all indata-validering + action-manifest)
- **jsonwebtoken** ^9.0.2, **bcryptjs** ^3.0.2
- **pdfkit** ^0.15.0, **dotenv** ^17.2.0
- **@anthropic-ai/sdk** ^0.65.0, **@modelcontextprotocol/sdk** ^1.29.0
- Test: **vitest** ^3.2.0 + **supertest** ^7.1.0 (mot riktig Postgres, aldrig mockad databas)

## Arkitekturmonster

**Ett flode, tre ingangar.** REST-API:t (`server/src/http/routes/`), webbvyn (`server/src/http/view/`) och MCP-servern (`server/src/mcp/server.ts`) ar bara transport. Allt som muterar gar genom `executeAction` (`server/src/actions/execute.ts`) → actions-registret (`server/src/actions/registry.ts`) → tjanstelagret (`server/src/services/`) → Postgres. Vyn bokfor via samma `executeAction` (actor `human`) som AI:n — parallella vagar byggs aldrig (lardom 5 i STATUS.md).

- **Actions-registret:** varje action ar en `def({ name, title, sensitivity, inputSchema, handler })` i `ACTIONS`-arrayen. `name` ar snake_case-verb (`create_invoice`, `list_vouchers`). `inputSchema` ar alltid ett `.strict()` zod-schema byggt av delarna i `lib/validation.ts` (`OreSchema`, `UuidSchema`, `safeText` …). `sensitivity` ar `read` | `write` | `sensitive`; `sensitive` (pengaflyttande/periodlasande) kors ALDRIG direkt utan gar via godkannandekon och exekveras forst nar en manniska godkant. Handlern anropar en tjanst — ingen SQL i registret, ingen affarslogik i http-lagret. Det valfria faltet `kraverNyVersion` provar baselineburna indatafalt i `executeAction` fore kobildningen, deklarativt som `kravManniska`.
- **Godkannandets mandat (B-2):** `approveAction` satter `ctx.approvalId` sa handlern vet vilken kopost den verkstaller. Avvisningen ar utbruten till `avvisaGodkannande` i `services/approvals.ts`. For en kanslig atgard med `tvafas: true` tas manniskans ja eller nej emot och committas i en egen transaktion med oforanderliga beslutsfalt (migration 0077), fore verkstalligheten i `verkstallBeslut` i `actions/execute.ts`. Ett misslyckat forsok tas om av `verkstallMottagnaBeslut` utan nytt ja eller nej. Annars gar ett obesvarat forslag efter ett processfel inte att skilja fran ett som David redan avgjort, och han maste svara igen — vilket FR-41 punkt 4 och NFR-3 forbjuder. Samma godkannandeko och actions-lager bar hela flodet; ingen andra exekveringsvag byggs (lardom 5). Atgarder utan `tvafas` beter sig som forut, i en transaktion. Ingen produktionsatgard har annu `tvafas`.
- **Tjanstelagret:** en fil per domankoncept (`invoices.ts`, `payroll.ts`, `crmRelations.ts` …). Tjanster tar `client: PoolClient` + `companyId` och kors inuti `withTenantTransaction` — RLS-kontext, medlemskap och auditlogg i SAMMA transaktion som mutationen.
- **Migrationer:** numrerad kedja i `server/migrations/` (`NNNN_snake_case.sql`, just nu 0001–0079), kors idempotent med `npm run migrate` som agarrollen (`DATABASE_ADMIN_URL`); appen ansluter som icke-superuser `app` sa RLS tvingas.
- **Tester:** vitest mot riktig Postgres pa 5433. `test/env.ts` satter env med `=` (aldrig `??=`) sa att en dev-`.env` aldrig kan lacka in; en mall-databas migreras EN gang i globalSetup och aterskapas farsk fore varje testfil. HTTP testas med supertest genom hela stacken; tenant-isolering, godkannandeflode och auditlogg testas som beteende, inte som implementation. `npm test` och `npm run build` ska vara grona fore varje merge.
- **CRM/ingest:** relationsdata bor i eget schema `crm` med egen gallring. Riktningen ar enkelriktad enligt `docs/crm/API_KONTRAKT.md`: kallsystemen ringer `ingest_crm_events` — det har repot ringer ALDRIG ut. Ursprung markeras per falt och en manniskas vardo vinner alltid over en synk.

## Uppdragsytan (modul)

Uppdragsytan ar en modul i redovisningen, inte en fjarde tjanst. Namnrymden ar `uppdrag_*`: tabellerna `uppdrag_*` (migrationerna 0068–0071), tjansterna `server/src/services/uppdrag*.ts` (daribland `services/uppdragUndantag.ts`), atgarderna i registret (`skapa_uppdrag`, `importera_leveranskontrakt`, `andra_baseline`, `las_leverabelregister`, `satt_bedomning`, `tand_scopesignal`, `avgor_scopesignal`, `binda_kostnad`, `bekrafta_statusbyte`, `avsluta_uppdrag`, `las_uppdragslage`, `las_undantag`, `kor_uppdragssvep`), vyerna under `/app/c/:companyId/uppdrag` i samma vyrouter som resten av `/app`, och testerna `server/test/uppdragsytan-*.test.ts`. Allt gar genom `executeAction` som allt annat. Atgarder markta `kravManniska` (`set_project_status`, `satt_bedomning`, `tand_scopesignal`, `avgor_scopesignal`, `bekrafta_statusbyte`) avvisas for actor `agent` med `human_required` fore varje skrivning — en manniska utfor dem i vyn.

**Agandegransen ar tre datamangder,** och varje `uppdrag_*`-tabell bar sin kategori som tabellkommentar. AGD: leverabelregistret (`uppdrag_leverabel`, `uppdrag_leverabel_handelse` — append-only) och bedomningen (`uppdrag_bedomning` — oforanderlig). BASELINE: avtalets egna ord (`uppdrag_scopelinje`, `uppdrag_scopesignal`) — baselinen sjalv ags av `contracts`/`contract_parts`, som redovisningen redan ager; modulen utvidgar den och dubblerar aldrig en kolumn som `contract_parts` bar. REFERENS: `uppdrag_referens` — pekare till filer, kalenderposter och mejl i deras kallsystem, aldrig innehall, aldrig frammande nycklar over systemgrans. CACHE: `uppdrag_svepvarde` — omrakningsbart ur kallsystemen och far tommas. Cachen bar ocksa svepets tackning under nyckeln `tackning`; tomd cache lases som ofullstandigt underlag, aldrig som verifierat tomt. Modulen ager alltsa tva datamangder helt och utvidgar en tredje.

**Baselineversionen star kvar (B-7, FR-2 och IR-04).** Ingen lagrad baselineversion skrivs over, inte heller en obekraftad. Varje rad i `contract_parts` ar fryst nar den val ar lagrad (`kraver_orsak_vid_ny_version`, migration 0079). Det enda som far andras ar `cap_confirmed` fran false till true (och husets `updated_at`); ingen rad raderas. En andring ar en ny rad med eget `valid_from` och `change_reason` genom `skrivBaselineversion`, och samma nyckel ger 409 `version_finns`. Uppsattningens utkast ar koposten (`satt_baseline`): `skapa_uppdrag` lagrar ingen avtalsdel, och ett nej lamnar inga rader. `update_contract` avvisar baselineburna kolumner (`lib/baselinekolumner.ts`) med 409 `kraver_ny_version` fore kobildningen; samma lista provas vid verkstalligheten for aldre koposter. En version som gar att skriva om kan inte svara pa vad som gallde nar parterna kom overens.

**Undantagsvyns lasvag (B-3, Story 1.6).** `lasUndantag` i `services/uppdragUndantag.ts` ar en enda lasvag med en stangd lista over fyra postslag: baselineandring, kostnadsbindning, avslut och scopeavgorande. `listaVantandeKoposter` laser mandatkon utan LIMIT; `listApprovals` behaller sitt fonster for Att gora. Svepets tackning ar varje oppet avtal (projektstatus active) ganger mandatkallorna godkannandekon, ovrigt, kostnader och baselineforslag. Lasvagen ger `poster`, `verifierat_tomt` eller `ofullstandigt`. Verifierat tomt kraver noll poster och farsk tackning for samtliga kallor, hogst 60 minuter. Ofullstandigt vinner over poster, som anda returneras. `Lasvarde` i `lib/lasvarde.ts` ar typen for varje last varde, med kalla, last_nar och last/olast/saknas. Inget beloppsfilter och inga externa anrop.

**Svepets hemvist ar Hermes, inte redovisningen.** Redovisningen har ingen scheduler och ringer aldrig ut: `kor_uppdragssvep` ar en vanlig `write`-atgard utan externa anrop. Som sista steg skriver svepet `tackning` for alla oppna avtal, aven dem som inte finns i Hermes indata. `upsertSvepvarden` har omfangen svep/tackning, sa stegen aldrig raderar varandras nycklar. Hermes cron (`~/.hermes/skills/uppdragssvep.py`, var 15:e minut) laser kalender, Drive och mejl, skickar resultatet som indata, far nasta arbetslista som svar och skriver Drive-kopiorna sjalv — samma enkelriktade hallning som `ingest_crm_events`. Ett svep som tystnar larmas av Hermes provvakt (`svepfarskhet.py`), inte av redovisningen. Sektionen infordes genom beslut #140 i beslutskon (S11.2, 2026-09-07), enligt andringsregeln nedan.

## Granser

Detta gors ALDRIG, i nagon del av produkten:

- **Inga nya beroenden** (npm-paket, tjanster, infrastruktur) utan Davids uttryckliga beslut. Stacklistan ovan ar sluten.
- **Inga alternativa monster i olika delar.** En ny funktion far inte valja egen arkitektur: mutationer gar via actions-registret, validering via zod-strict, pengar i oren-heltal (aldrig float), UPDATE via `buildAllowlistedUpdate`, `company_id` ur medlemskapet — aldrig ur request-body. Finns ett monster i repot anvands det; vill man byta monster ar det en arkitekturandring (se nedan).
- **Endast `server/src/config.ts` laser `process.env`** (undantag: migrations-CLI:t). Aldrig fallback-hemligheter; appen vagrar starta utan `JWT_SECRET` ≥ 32 tecken.
- **`.env` rors aldrig** — inte lasas upp i svar, inte skrivas om, inte "stad-fixas". Den ar Davids skarpa driftkonfiguration.
- **`npm run mcp:token` kors aldrig** av en utvecklingssession — den mintar riktiga agent-tokens mot Davids skarpa system. Detsamma galler alla handgrepp mot produktionsdatan; de gor David sjalv via vyn/actions.
- **`audit_log` ar append-only** (trigger + REVOKE) och kringgas aldrig; inga statusrapporter ("klart/testat") utan faktisk korning med inklistrad utdata.
- **Fas for fas:** ingen ny fas byggs forran foregaende passerat sina grindar (`/verify`, `/code-review`, `/security-review`).

## Andringsregel

En arkitekturandring — nytt beroende, nytt lager, nytt monster, andrad invariant, andrad stack — galler per definition HELA produkten och beslutas av David uttryckligen i beslutskon, aldrig implicit i ett enskilt bygge. Fram till dess ar det har dokumentet, tillsammans med invarianterna i `CLAUDE.md` och lardomarna i `docs/STATUS.md`, lag: en session som tycker att dokumentet ar fel foreslar en andring i beslutskon och bygger under tiden enligt dokumentet.
