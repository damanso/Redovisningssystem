-- Härdning efter Fas 0-granskningen.

-- 1) FORCE ROW LEVEL SECURITY: som standard kringgår en tabells ÄGARE alla
--    RLS-policyer. Om API:t av misstag skulle ansluta som ägaren vore lager 2
--    tyst avstängt. FORCE gör att policyerna gäller även ägaren. (Startkoden
--    fail-fastar dessutom om rollen är för privilegierad — detta är bältet
--    till hängslet.) Migrationerna själva rör aldrig tenant-radernas data,
--    så FORCE påverkar inte migrationskörningen.
ALTER TABLE companies       FORCE ROW LEVEL SECURITY;
ALTER TABLE company_members FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log       FORCE ROW LEVEL SECURITY;
ALTER TABLE files           FORCE ROW LEVEL SECURITY;

-- 2) Index som betjänar audit-listningens ORDER BY id DESC (keyset-paginering).
--    Utan detta måste Postgres läsa hela bolagets audit-historik och top-N-
--    sortera, med den icke-inlinebara RLS-policyfunktionen utvärderad per rad.
CREATE INDEX audit_log_company_id_idx ON audit_log (company_id, id DESC);
