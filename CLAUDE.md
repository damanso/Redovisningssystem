# Regler för det här repot

Källa till sanning: `GRANSKNING_OCH_OMSTARTSPLAN.md` (analys + omstartsplan) och
`KICKOFF_NYSESSION.md` (byggregler + acceptanskriterier per fas). Läs dem först.

## Icke förhandlingsbart

1. **Fas för fas.** Bygg inte nästa fas förrän föregående passerat sin grind
   (`/verify`, `/code-review`, `/security-review` med faktisk, inklistrad utdata).
2. **Inga falska statusrapporter.** Skriv aldrig "klart/testat/fungerar/produktionsklart"
   utan att först ha kört kommandot och visat den riktiga utdatan. Skapa aldrig
   `*_COMPLETE.md`-filer som påstår framgång utan bevis.
3. **Kontrollpunkter:** vänta på användarens godkännande efter Fas 0 och Fas 1.
4. **Säkerhet är en grind:** tenant-isolering, fail-fast-env och append-only
   auditlogg ska finnas innan affärsobjekt byggs.
5. **Fråga vid vägval** (momskonton, periodlås, SIE-format o.dyl.) — gissa inte.

## Arkitekturinvarianter

- Endast `server/src/config.ts` läser `process.env` (undantag: migrations-CLI:t).
  Appen vägrar starta utan `JWT_SECRET` (≥ 32 tecken). Aldrig en fallback-hemlighet.
- API:t ansluter till Postgres som rollen `app` (icke-superuser) så att RLS tvingas.
  Migrationer körs som ägarrollen (`DATABASE_ADMIN_URL`).
- `company_id` härleds ALLTID från användarens medlemskap (via
  `requireCompanyAccess`/`withTenantTransaction`) — aldrig från request-body.
- Alla UPDATE-satser byggs via allowlist (`buildAllowlistedUpdate`) — aldrig
  kolumnnamn från indata. Alla värden parametriseras.
- `audit_log` är append-only (trigger + REVOKE). Skrivoperationer auditloggas i
  samma transaktion som mutationen.
- Belopp i bokföringen lagras som heltal i ören (Fas 1) — aldrig float.

## Kommandon

```bash
npm test            # vitest mot riktig Postgres (se test/env.ts för anslutning)
npm run build       # tsc — ska passera utan fel
npm run migrate     # kör migrationskedjan (idempotent)
```
