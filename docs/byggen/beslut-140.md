# Bygge beslut #140 — En sektion "Uppdragsytan (modul)" i ARKITEKTUR.md samt rattad migrationsrad

Datum: 2026-09-07 · Branch: cto/en-sektion-uppdragsytan-modul-inf-rs-ord-140 · Overlamning: #140

## Mal
docs/ARKITEKTUR.md (lagen) beskriver uppdragsytemodulen — namnrymd, agandegrans, svepets hemvist — och pastar inget falskt om migrationskedjan. Enbart dokumentation: ingen kod, ingen migration, inga tester, inga nya atgarder eller beroenden.

## Kontroll (KRAV-4)

**1. Alla tolv atgardsnamn i sektionen finns i `server/src/actions/registry.ts`** (samt `set_project_status`, som sektionen listar bland kravManniska-atgarderna trots att den inte ar en `uppdrag_*`-atgard — befintlig atgard som modulen ateranvander):

```
$ grep -nE "name: '(skapa_uppdrag|importera_leveranskontrakt|andra_baseline|las_leverabelregister|satt_bedomning|tand_scopesignal|avgor_scopesignal|binda_kostnad|bekrafta_statusbyte|avsluta_uppdrag|las_uppdragslage|kor_uppdragssvep|set_project_status)'" server/src/actions/registry.ts
1234:    name: 'set_project_status',
1497:    name: 'andra_baseline',
1567:    name: 'skapa_uppdrag',
1584:    name: 'importera_leveranskontrakt',
1603:    name: 'satt_bedomning',
1641:    name: 'las_leverabelregister',
1656:    name: 'tand_scopesignal',
1697:    name: 'avgor_scopesignal',
1778:    name: 'kor_uppdragssvep',
1796:    name: 'binda_kostnad',
1816:    name: 'bekrafta_statusbyte',
1848:    name: 'avsluta_uppdrag',
1887:    name: 'las_uppdragslage',
```
13 av 13 traffar (12 modulatgarder + `set_project_status`).

**2. Alla sju tabellnamn i sektionen finns i `server/migrations/0068_uppdragsytan.sql`:**

```
$ grep -niE "create table (if not exists )?(uppdrag_\w+)" server/migrations/0068_uppdragsytan.sql
109:CREATE TABLE IF NOT EXISTS uppdrag_leverabel (
132:CREATE TABLE IF NOT EXISTS uppdrag_leverabel_handelse (
153:CREATE TABLE IF NOT EXISTS uppdrag_bedomning (
177:CREATE TABLE IF NOT EXISTS uppdrag_scopelinje (
194:CREATE TABLE IF NOT EXISTS uppdrag_scopesignal (
219:CREATE TABLE IF NOT EXISTS uppdrag_referens (
245:CREATE TABLE IF NOT EXISTS uppdrag_svepvarde (
```
7 av 7 traffar.

**3. Inga svenska diakriter (a-ring, a-umlaut, o-umlaut) i docs/ARKITEKTUR.md** (dokumentets konvention, galler saval den nya sektionen som den andrade migrationsraden). Sokningen gjordes over hela filen med teckenklassen for de sex tecknen, gemener och versaler:

```
$ grep -c '[<a-ring><a-umlaut><o-umlaut><A-ring><A-umlaut><O-umlaut>]' docs/ARKITEKTUR.md
No matches found — 0 total occurrences across 0 files.
```
(Teckenklassen skrivs har med namn i stallet for tecken, eftersom journalen halls i samma ASCII-konvention.)

**4. Migrationskedjan:** `server/migrations/` innehaller 71 filer, `0001_extensions.sql` … `0071_registerkopiako.sql`. Dokumentets punkt Migrationer sade "just nu 0001–0059" och sager nu "just nu 0001–0071".

**5. kravManniska-sparren:** `server/src/actions/execute.ts:56` — `if (action.kravManniska && params.actor !== 'human') throw new ForbiddenError('human_required', ...)`, fore varje skrivning, precis som sektionen pastar.

**6. `npm test` och `npm run build`:** noll kodfiler rorda (diffen ar `docs/ARKITEKTUR.md`, `docs/STATUS.md` och den har journalen), sa sviten ska vara oforandrat gron. Utdata klistras in nedan av byggskriptets korning.

## Utfall
(fylls i av byggskriptet)

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
