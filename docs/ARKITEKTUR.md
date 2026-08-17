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

- **Actions-registret:** varje action ar en `def({ name, title, sensitivity, inputSchema, handler })` i `ACTIONS`-arrayen. `name` ar snake_case-verb (`create_invoice`, `list_vouchers`). `inputSchema` ar alltid ett `.strict()` zod-schema byggt av delarna i `lib/validation.ts` (`OreSchema`, `UuidSchema`, `safeText` …). `sensitivity` ar `read` | `write` | `sensitive`; `sensitive` (pengaflyttande/periodlasande) kors ALDRIG direkt utan gar via godkannandekon och exekveras forst nar en manniska godkant. Handlern anropar en tjanst — ingen SQL i registret, ingen affarslogik i http-lagret.
- **Tjanstelagret:** en fil per domankoncept (`invoices.ts`, `payroll.ts`, `crmRelations.ts` …). Tjanster tar `client: PoolClient` + `companyId` och kors inuti `withTenantTransaction` — RLS-kontext, medlemskap och auditlogg i SAMMA transaktion som mutationen.
- **Migrationer:** numrerad kedja i `server/migrations/` (`NNNN_snake_case.sql`, just nu 0001–0059), kors idempotent med `npm run migrate` som agarrollen (`DATABASE_ADMIN_URL`); appen ansluter som icke-superuser `app` sa RLS tvingas.
- **Tester:** vitest mot riktig Postgres pa 5433. `test/env.ts` satter env med `=` (aldrig `??=`) sa att en dev-`.env` aldrig kan lacka in; en mall-databas migreras EN gang i globalSetup och aterskapas farsk fore varje testfil. HTTP testas med supertest genom hela stacken; tenant-isolering, godkannandeflode och auditlogg testas som beteende, inte som implementation. `npm test` och `npm run build` ska vara grona fore varje merge.
- **CRM/ingest:** relationsdata bor i eget schema `crm` med egen gallring. Riktningen ar enkelriktad enligt `docs/crm/API_KONTRAKT.md`: kallsystemen ringer `ingest_crm_events` — det har repot ringer ALDRIG ut. Ursprung markeras per falt och en manniskas vardo vinner alltid over en synk.

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
