-- FR-6 (B-14 ”Scopelinjens åtgärd”, Story 2.6): scopelinjen bär också
-- åtgärden när en signal tänds.
--
-- Leveranskontraktets del 5 säger tre saker om gränsen — innanför, utanför och
-- fraserna att lyssna efter — och en fjärde om vad som händer när en fras hörs.
-- 0068 gav `uppdrag_scopelinje.sort` ett CHECK utan eget namn (alltså
-- `uppdrag_scopelinje_sort_check`) med bara de tre första. Åtgärden fick då
-- ingen plats, och kontraktets egna ord om den gick förlorade vid importen.
--
-- Villkoret VIDGAS med `atgard`. Inga rader ändras, och eftersom villkoret bara
-- vidgas håller varje befintlig rad — ingen kantkontroll behövs. Värdena är
-- exakt `SCOPELINJESORTER` i server/src/lib/leveranskontrakt.ts, och provet
-- härleder schemat ur konstanten. Tabellkommentaren, rättigheterna och
-- policyerna ägs av 0068 och rörs inte. Filen tål att köras igen.
ALTER TABLE uppdrag_scopelinje DROP CONSTRAINT IF EXISTS uppdrag_scopelinje_sort_check;
ALTER TABLE uppdrag_scopelinje ADD CONSTRAINT uppdrag_scopelinje_sort_check
  CHECK (sort IN ('innanfor', 'utanfor', 'fras', 'atgard'));
COMMENT ON CONSTRAINT uppdrag_scopelinje_sort_check ON uppdrag_scopelinje IS
  'Exakt SCOPELINJESORTER i server/src/lib/leveranskontrakt.ts. atgard = vad David gör när en signal tänds, ur leveranskontraktets del 5.';
