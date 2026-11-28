-- Uppdragsytan Story 5.8 (FR-19, FR-3, NFR-11): larmregeln för måttet
-- ”Nedlagd tid mot ram” enligt Davids beslut 2026-10-07.
--
-- Kontraktets larmregel jämför förbrukad tid med klara leverabler, och den
-- jämförelsen är den färdigställandegrad som NFR-11 förbjuder. David svarade
-- 2026-10-07 «Ersätt, skriv inte om»: FR-3:s avvikelsetröskel ersätter regeln,
-- och ingen ny kontraktsversion krävs. Importen sätter läget för nya rader
-- genom `larmregelLage` i server/src/lib/leveranskontrakt.ts; den här filen
-- sätter det på befintliga rader och lägger spärren bakom regeln.
--
-- Filen gör två saker, i den här ordningen:
--   1. läget `harleds` på befintliga rader vars utfall härleds, i öppna
--      uppdrag. Villkoret `utfall_lage = 'harleds'` är exakt `larmregelLage`:s
--      regel uttryckt i lagrad data: parsern härleder utfallet bara för
--      läsaren tid mot ram. Ett avslutat uppdrag behåller sin rad (FR-8), så
--      avslutstriggern `uppdrag_matt_vagrar_avslutat` får aldrig anledning att
--      kasta. Inget annat fält sätts;
--   2. villkoret `uppdrag_matt_larmregel_kraver_utfall`, spärren för varje väg
--      in, också en framtida importväg.
--
-- Filen rör inte: kolumnen `larmregel` (kontraktets ord står kvar ordagrant
-- som historik), `contracts` eller `contract_parts`. Ingen ny kolumn, ingen
-- GRANT (`app` behåller SELECT + INSERT och får ingen UPDATE), ingen ändrad
-- tabellkommentar, inga ändrade policyer och ingen ny trigger. Migrationen
-- körs som ägarrollen, precis som 0093:s UPDATE, och behöver ingen policy.
-- Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Läget på befintliga rader i öppna uppdrag
-- ---------------------------------------------------------------------------
UPDATE uppdrag_matt m SET larmregel_lage = 'harleds'
 WHERE larmregel_lage = 'harleds_ej' AND utfall_lage = 'harleds'
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = m.contract_id AND p.status = 'closed');

-- ---------------------------------------------------------------------------
-- 2) Villkoret
-- ---------------------------------------------------------------------------
-- En larmregel som härleds kräver ett utfall att larma på. Alla befintliga
-- rader håller villkoret: läget `harleds` sätts ovan bara där utfallet härleds.
ALTER TABLE uppdrag_matt DROP CONSTRAINT IF EXISTS uppdrag_matt_larmregel_kraver_utfall;
ALTER TABLE uppdrag_matt ADD CONSTRAINT uppdrag_matt_larmregel_kraver_utfall
  CHECK (larmregel_lage = 'harleds_ej' OR utfall_lage = 'harleds');
