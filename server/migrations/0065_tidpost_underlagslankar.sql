-- PRD_TIDSRAPPORTERING §4 F1 + §9.5 (story 5): underlaget till en tidpost.
--
-- Rådslagets beslut 1/9: underlag lagras som LÄNKAR, aldrig som filkopior
-- (ILT §6). Anteckningen, ritningen eller ärendet bor redan i det system där
-- arbetet gjordes; en kopia här hade blivit en andra sanning som åldras i
-- tysthet och som dessutom drar med sig kundens material in i vår
-- räkenskapsinformation. En länk säger var underlaget FINNS — den påstår inte
-- att den är underlaget.
--
-- `url` är NOT NULL och kontrolleras till https:// redan i schemat: kravet
-- står i tjänstelagret (400 `invalid_link_url`), men en regel som bara finns i
-- koden gäller inte för raden som skrevs innan koden fanns.

-- ---------------------------------------------------------------------------
-- 0) Referensnyckeln för den sammansatta främmande nyckeln
-- ---------------------------------------------------------------------------
-- Samma mönster som 0011/0051/0053: en FK som bär med sig company_id gör det
-- OMÖJLIGT att hänga en länk på en tidpost i ett annat bolag. time_entries har
-- ingen (id, company_id)-nyckel ännu — den läggs här, som 0053 gjorde för
-- projects.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_id_company_uk') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_id_company_uk UNIQUE (id, company_id);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1) Länkarna
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entry_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  time_entry_id uuid NOT NULL,
  url           text NOT NULL CHECK (url LIKE 'https://%' AND length(url) <= 2000),
  -- Vad länken visar, med människans ord. Nullbar: en länk utan etikett är
  -- fortfarande ett underlag, och ett tvingande fält hade bara gett "länk".
  label         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entry_links_entry_fk FOREIGN KEY (time_entry_id, company_id)
    REFERENCES time_entries (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS time_entry_links_entry_idx
  ON time_entry_links (company_id, time_entry_id, created_at);

COMMENT ON TABLE time_entry_links IS
  'Underlag till en tidpost som https-länkar. Aldrig filkopior (rådslaget 1/9, ILT §6) — länken säger var underlaget finns, den är inte underlaget.';

-- ---------------------------------------------------------------------------
-- 2) RLS och GRANT — exakt 0047:s mönster
-- ---------------------------------------------------------------------------
ALTER TABLE time_entry_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry_links FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'time_entry_links' AND policyname = 'time_entry_links_select') THEN
    CREATE POLICY time_entry_links_select ON time_entry_links FOR SELECT
      USING (app_has_company_access(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'time_entry_links' AND policyname = 'time_entry_links_insert') THEN
    CREATE POLICY time_entry_links_insert ON time_entry_links FOR INSERT
      WITH CHECK (app_has_company_access(company_id));
  END IF;
  -- DELETE tillåts bara så länge tidposten INTE ligger på en faktura — samma
  -- regel som 0047 har för bilageraderna, och samma regel som tjänstelagret
  -- svarar 409 `time_entry_locked` på. Underlaget till en fakturerad post är
  -- en del av det som skickats till kund.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'time_entry_links' AND policyname = 'time_entry_links_delete') THEN
    CREATE POLICY time_entry_links_delete ON time_entry_links FOR DELETE
      USING (
        app_has_company_access(company_id)
        AND EXISTS (
          SELECT 1 FROM time_entries t
          WHERE t.id = time_entry_links.time_entry_id
            AND t.company_id = time_entry_links.company_id
            AND t.status <> 'fakturerad'
        )
      );
  END IF;
END
$$;

GRANT SELECT, INSERT, DELETE ON time_entry_links TO app;
