-- CRM E7a: aktör på tidrapport + inköpskostnad.
--
-- Varför nu (BMAD-underlaget, beslut B3): underkonsulter kommer inom sex
-- månader. Utan aktör på tidposten går varken attribuering, beläggning per
-- person, marginal eller utbetalning till underkonsult att räkna. Migreringen
-- rör fakturaunderlaget och är billig vid 1 985 loggade minuter — inte vid
-- 50 000. Därför flyttades den fram i byggordningen.
--
-- Två belopp som lätt blandas ihop:
--   time_entries.hourly_rate_ore = PRISET vi tar av kunden (fanns sedan 0017)
--   time_entries.cost_rate_ore   = INKÖPSKOSTNADEN vi betalar för timmen (ny)
-- Marginal = pris − kostnad. Utan det andra fältet är marginalen ogissbar.
--
-- Två roller som också lätt blandas ihop:
--   time_entries.created_by            = vem som REGISTRERADE posten (fanns sedan 0017)
--   time_entries.performed_by_actor_id = vem som UTFÖRDE arbetet (ny)
-- created_by rörs inte och byter inte betydelse. Att låta det ena fältet betyda
-- båda sakerna hade förstört spårbarheten i det ögonblick AI:n loggar tid åt
-- någon annan — vilket är precis vad B3 förbereder för.

-- 1) Aktören. En egen tabell, inte users: en underkonsult ska kunna få tid
--    registrerad på sig LÅNGT innan hen har (eller ska ha) en inloggning.
--    Kopplingarna är valfria och pekar ut var pengarna faktiskt går:
--      user_id     — aktören har inloggning i systemet
--      employee_id — intern, kostnaden syns i lönekörningen
--      supplier_id — underkonsult, kostnaden kommer som leverantörsfaktura
CREATE TABLE work_actors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'subcontractor')),
  user_id       uuid REFERENCES users(id),
  employee_id   uuid,
  supplier_id   uuid,
  -- Standardkostnad per timme i ören. Heltal, aldrig float — samma invariant
  -- som allt annat penningbelopp i systemet.
  cost_rate_ore bigint CHECK (cost_rate_ore IS NULL OR cost_rate_ore >= 0),
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Unikhet på (id, company_id) krävs för de tenant-säkra sammansatta
-- främmandenycklarna nedan: en tidpost i bolag A ska inte kunna peka på en
-- aktör i bolag B ens om någon lyckas gissa ett uuid.
CREATE UNIQUE INDEX work_actors_id_company_uk ON work_actors (id, company_id);

-- Samma dubblettspärr som kontakterna fick i 0050: ett härledningsjobb som körs
-- om ska UPPDATERA aktören, inte lägga en till. Skiftlägesokänsligt.
CREATE UNIQUE INDEX work_actors_name_uk ON work_actors (company_id, lower(name));
-- En användare kan bara vara en aktör i samma bolag.
CREATE UNIQUE INDEX work_actors_user_uk ON work_actors (company_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX work_actors_company_active_idx ON work_actors (company_id, active);

-- Tenant-säkra kopplingar till lön och leverantörsreskontra. Kräver unikhet på
-- (id, company_id) i måltabellerna: suppliers fick den redan i 0011, employees
-- saknade den. IF NOT EXISTS matchar på indexnamnet, så 0011:s constraint står
-- kvar orörd.
CREATE UNIQUE INDEX IF NOT EXISTS employees_id_company_uk ON employees (id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_id_company_uk ON suppliers (id, company_id);
-- Inget ON DELETE: varken employees eller suppliers har DELETE-grant för
-- app-rollen, och ett SET NULL på en sammansatt nyckel hade nollat company_id
-- (NOT NULL) om det inte skrivs som kolumnlista. NO ACTION är både enklare och
-- rätt här — en aktör ska inte tappa sin koppling i tysthet.
ALTER TABLE work_actors
  ADD CONSTRAINT work_actors_employee_fk FOREIGN KEY (employee_id, company_id)
    REFERENCES employees (id, company_id),
  ADD CONSTRAINT work_actors_supplier_fk FOREIGN KEY (supplier_id, company_id)
    REFERENCES suppliers (id, company_id);

CREATE TRIGGER work_actors_set_updated_at
  BEFORE UPDATE ON work_actors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE work_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_actors FORCE ROW LEVEL SECURITY;
CREATE POLICY work_actors_select ON work_actors FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY work_actors_insert ON work_actors FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY work_actors_update ON work_actors FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
-- Ingen DELETE: en aktör med historik ska inaktiveras, inte raderas bort under
-- fakturaunderlaget. Samma linje som projects/time_entries.
GRANT SELECT, INSERT, UPDATE ON work_actors TO app;

-- 2) Tidposten: vem utförde arbetet, och vad kostade timmen oss.
ALTER TABLE time_entries
  ADD COLUMN performed_by_actor_id uuid,
  ADD COLUMN cost_rate_ore bigint CHECK (cost_rate_ore IS NULL OR cost_rate_ore >= 0);
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_actor_fk FOREIGN KEY (performed_by_actor_id, company_id)
    REFERENCES work_actors (id, company_id);
CREATE INDEX time_entries_actor_idx ON time_entries (company_id, performed_by_actor_id, work_date);

-- 3) Backfill av historiken.
--
-- ANTAGANDE, uttalat: fram till den här migreringen var systemet enanvändar-
-- drivet — den som registrerade tiden var också den som utförde arbetet. Därför
-- får varje befintlig tidpost en aktör härledd ur created_by. Antagandet gäller
-- ENBART historiken; framåt sätts aktören explicit eller härleds ur den
-- inloggade användaren vid registreringen.
--
-- Alternativet — lämna historiken utan aktör — hade gjort 1 985 minuter
-- oattribuerade i varje beläggnings- och marginalrapport. Det är sämre, och
-- fältet går att korrigera i efterhand (NULL vs aktör är inte bokföringsdata).
INSERT INTO work_actors (company_id, name, kind, user_id, created_by)
SELECT DISTINCT t.company_id, COALESCE(NULLIF(btrim(u.name), ''), u.email), 'internal', u.id, u.id
FROM time_entries t
JOIN users u ON u.id = t.created_by
WHERE t.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- Två användare i samma bolag kan heta likadant. Namnkrocken fälls av
-- unik-indexet ovan, och utan det här andra passet hade den användarens
-- tidposter blivit tysta nollor i rapporterna. E-posten är unik per användare.
INSERT INTO work_actors (company_id, name, kind, user_id, created_by)
SELECT DISTINCT t.company_id, u.email, 'internal', u.id, u.id
FROM time_entries t
JOIN users u ON u.id = t.created_by
WHERE t.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM work_actors a WHERE a.company_id = t.company_id AND a.user_id = u.id)
ON CONFLICT DO NOTHING;

UPDATE time_entries t
SET performed_by_actor_id = a.id
FROM work_actors a
WHERE a.company_id = t.company_id
  AND a.user_id = t.created_by
  AND t.performed_by_actor_id IS NULL;
