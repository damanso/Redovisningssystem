# Regler för det här repot

**LÄS FÖRST: `docs/STATUS.md`** — projektets aktuella läge, driftmiljö,
sessionslogg och lärdomar. En ny session ska ALDRIG börja på noll: läs STATUS,
fortsätt därifrån, och uppdatera sessionsloggen i STATUS.md innan du avslutar
en session som ändrat något (committa+pusha den med övriga ändringar).

Källa till sanning för byggreglerna: `GRANSKNING_OCH_OMSTARTSPLAN.md` (analys +
omstartsplan) och `KICKOFF_NYSESSION.md` (byggregler + acceptanskriterier per fas).

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


---

## Uppdragsytan — fjärde paketet (kravbild finns, bygg inte utan att läsa den)

En projektmodul planeras i det här systemet. **Kravbilden är skriven och validerad. Läs den innan du rör något som heter uppdrag, baseline, leverabel eller bedömning.**

| Vad | Var i brain-vaulten |
|---|---|
| PRD, 32 FR + 12 NFR | `02-Områden/hermes/uppdragsytan-1c-prd.md` |
| Valideringsrapport, 13 pass | `02-Områden/hermes/uppdragsytan-1c-valideringsrapport.md` |
| Product brief med beslutslogg | `02-Områden/hermes/uppdragsytan-1b-product-brief.md` |
| Davids svar och åtgärder | `02-Områden/hermes/uppdragsytan-1c-svar.md` |
| Skillen som genererar PRD:n | `03-Resurser/scripts/bmad_prd.py` |

**Ramverket är BMAD Loop 1.** Steg 1A, 1B och 1C är klara. Nästa steg är 1D, UX-specifikationen. Skriv ingen kod förrän 1F har gett stories.

**Två villkor spärrar bygget.** Kopplingsprovet K-8 står rött i provvakten, och tre krav vilar på ett fryst leveranskontrakt som ännu bara är utkast. Båda ska vara gröna först.

**Beslutat och stängt, öppna det inte igen:** modulen är en modul här, ingen egen tjänst och ingen fjärde databas. Den äger baselinen, leverabelregistret och bedömningen. Pengar, ärenden och filer läses ur sina källsystem och dupliceras aldrig.
