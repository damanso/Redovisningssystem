-- K-5: tidpost → ärende.  K-6: faktura → projekt.
--
-- Före den här migrationen:
--   * time_entries hade ingen kolumn för ärende alls. 20 poster, 0 kopplingar.
--     Fakturaunderlaget kunde inte visa vilket ärende timmen gick till.
--   * invoices, invoice_lines och invoice_appendix_rows saknade alla project_id.
--     8 av 18 fakturor gick att nå från ett projekt via kunden, 10 inte.
--
-- Två olika sorters koppling, därför två olika mekanismer:
--   K-6 är INOM den här databasen  -> riktig främmande nyckel.
--   K-5 pekar på ärendeplattformen -> annan databas, ALDRIG en FK.

-- ---------------------------------------------------------------------------
-- K-5: tidpost -> ärende (över systemgränsen)
-- ---------------------------------------------------------------------------
-- arende_id är sanningen (uuid, ärendeplattformens issues.id). arende_nyckel
-- ("LOC-316") är en FRUSEN läsbar kopia, och den finns av ett skäl: ett
-- fakturaunderlag är ett historiskt dokument. Det ska gå att läsa om tio år,
-- och det ska gå att läsa när ärendeplattformen är nere. Att slå upp nyckeln
-- live vid varje utskrift hade gjort faktureringen beroende av ett annat
-- system — och en koppling får aldrig bli ett krav.
ALTER TABLE time_entries
  ADD COLUMN arende_id uuid,
  ADD COLUMN arende_nyckel text,
  ADD COLUMN arende_kalla text;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_arende_komplett_check
    CHECK (
      (arende_id IS NULL AND arende_kalla IS NULL AND arende_nyckel IS NULL)
      OR
      (arende_id IS NOT NULL AND arende_kalla IS NOT NULL)
    );

CREATE INDEX time_entries_arende_idx
  ON time_entries (company_id, arende_id) WHERE arende_id IS NOT NULL;

-- Bilageraden bär bara den frusna nyckeln. Raden ÄR sitt eget bevis när den
-- väl är utskriven; den ska inte kunna ändras av att ett ärende döps om.
ALTER TABLE invoice_appendix_rows ADD COLUMN arende_nyckel text;

COMMENT ON COLUMN time_entries.arende_id IS
  'Ärendeplattformens issues.id. Nullbar, utan FK (annan databas).';
COMMENT ON COLUMN time_entries.arende_nyckel IS
  'Fryst läsbar nyckel, t.ex. LOC-316. Kopia med flit: underlaget ska gå att skriva ut när ärendeplattformen är nere.';

-- ---------------------------------------------------------------------------
-- K-6: faktura -> projekt (inom databasen)
-- ---------------------------------------------------------------------------
-- Sammansatt FK (id, company_id) — samma mönster som invoices_customer_fk.
-- Den gör mer än att peka: den gör det OMÖJLIGT att hänga en faktura på ett
-- projekt i ett annat bolag.
--
-- project_id sitter på ALLA TRE nivåerna, inte bara på huvudet. En faktura kan
-- bära rader från två projekt (resekostnader vidarefakturerade på ett annat
-- uppdrag är redan verklighet i data), och då är ett project_id på huvudet ett
-- medelvärde — alltså en lögn. Huvudets fält betyder "fakturans uppdrag", inte
-- "alla raders uppdrag".
ALTER TABLE invoices
  ADD COLUMN project_id uuid,
  ADD CONSTRAINT invoices_project_fk
    FOREIGN KEY (project_id, company_id) REFERENCES projects (id, company_id);

ALTER TABLE invoice_lines
  ADD COLUMN project_id uuid,
  ADD CONSTRAINT invoice_lines_project_fk
    FOREIGN KEY (project_id, company_id) REFERENCES projects (id, company_id);

ALTER TABLE invoice_appendix_rows
  ADD COLUMN project_id uuid,
  ADD CONSTRAINT invoice_appendix_rows_project_fk
    FOREIGN KEY (project_id, company_id) REFERENCES projects (id, company_id);

CREATE INDEX invoices_project_idx
  ON invoices (company_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX invoice_lines_project_idx
  ON invoice_lines (company_id, project_id) WHERE project_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Ifyllnad: BARA där svaret är entydigt.
-- ---------------------------------------------------------------------------
-- Villkoret är regeln, inte en lista med id:n: sätt project_id endast när
-- fakturans kund har EXAKT ETT projekt. Har kunden noll projekt finns inget
-- att peka på; har kunden två är valet en gissning, och en gissad koppling i
-- faktaform är värre än ett tomt fält. Skulle någon lägga till ett andra
-- projekt på en kund i morgon slutar den här regeln av sig själv att svara —
-- den gissar inte, den tiger.
UPDATE invoices i
   SET project_id = p.id
  FROM projects p
 WHERE p.company_id = i.company_id
   AND p.customer_id = i.customer_id
   AND i.project_id IS NULL
   AND (SELECT count(*) FROM projects q
         WHERE q.company_id = i.company_id AND q.customer_id = i.customer_id) = 1;

-- Raderna ärver huvudets projekt bara när huvudet fick ett. Ingen egen
-- härledning per rad: en rad som "Vidarefakturerade reseutlägg Dublin/London"
-- kan höra till ett annat uppdrag, och det avgörs av en människa.
UPDATE invoice_lines l
   SET project_id = i.project_id
  FROM invoices i
 WHERE i.id = l.invoice_id
   AND i.project_id IS NOT NULL
   AND l.project_id IS NULL;

COMMENT ON COLUMN invoices.project_id IS
  'Fakturans uppdrag. Nullbar: satt bara där kunden har exakt ett projekt, aldrig gissad.';
