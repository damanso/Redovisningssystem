-- Tid, story 1/9 (PRD_TIDSRAPPORTERING §9 steg 1): tidspostens LIVSCYKEL.
--
-- Problemet migrationen löser står i PRD §1: juli-fakturan skickades utan att
-- gå via tidrapporteringen, så de 20 registrerade posterna ligger kvar som
-- `billable = true, invoiced = false` — de kan faktureras en gång till. Och två
-- av dem (admin, supportmatris) skulle aldrig faktureras, men det fanns ingen
-- plats att SÄGA det: `billable` är ett påstående om posten, inte ett beslut
-- någon fattat, och en boolean bär varken orsak, godkännare eller tidpunkt.
--
-- Tre skillnader som modellen hittills saknat, och som var och en är en riktig
-- skillnad i verkligheten:
--   1. REGISTRERADE minuter (`minutes`, vad som hände) vs DEBITERBARA minuter
--      (`billable_minutes`, vad som faktureras). Kolumnen `minutes` byter
--      varken namn eller betydelse — historiken ska fortsätta läsa likadant.
--   2. Ett TILLSTÅND (`status`) i stället för två booleaner. 'forslag' (AI:t
--      gissade), 'godkand' (en människa sa ja), 'justerad' (ja, men med annan
--      tid än registrerad — och då krävs en orsak), 'ignorerad' (räknas aldrig
--      med, men raderas aldrig heller) och 'fakturerad' (låst).
--   3. VILKEN faktura som låste posten (`invoice_id`). Utan den är
--      "fakturerad" ett påstående utan underlag, och en dubbelfakturering
--      syns först när kunden hör av sig.
--
-- `billable`/`invoiced` behålls och hålls i synk av tjänstelagret
-- (invoiced = status='fakturerad', billable = status<>'ignorerad'). Skälet är
-- inte lathet: RLS-policyn i 0053 och sex läsande frågor (projects.ts,
-- steering.ts, crmDerivations.ts, vyn) bygger på dem, och att skriva om dem i
-- samma bygge som modellen ändras hade gjort ett fel omöjligt att lokalisera.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna
-- ---------------------------------------------------------------------------
-- status och billable_minutes läggs NULLBARA, fylls i, och görs därefter
-- NOT NULL. Ingen av dem får ett DEFAULT-värde, med flit: ett default hade
-- gjort det möjligt att skriva en tidpost utan att säga hur mycket av den som
-- är debiterbar — och en post med noll debiterbara minuter plockas aldrig av
-- fakturaunderlaget. Det är precis den sortens tysta nolla som PRD §1 handlar
-- om. Skrivvägen ska tvingas ta ställning.
ALTER TABLE time_entries
  ADD COLUMN status            text,
  ADD COLUMN billable_minutes  integer,
  ADD COLUMN source            text NOT NULL DEFAULT 'manuell',
  ADD COLUMN source_ref        text,
  ADD COLUMN adjustment_reason text,
  ADD COLUMN approved_by       uuid REFERENCES users(id),
  ADD COLUMN approved_at       timestamptz,
  ADD COLUMN invoice_id        uuid;

COMMENT ON COLUMN time_entries.minutes IS
  'REGISTRERADE minuter — vad som hände. Ändras aldrig av en fakturering.';
COMMENT ON COLUMN time_entries.billable_minutes IS
  'DEBITERBARA minuter — vad som faktureras. Får vara 0. Skiljer sig den från minutes krävs adjustment_reason.';
COMMENT ON COLUMN time_entries.invoice_id IS
  'Fakturan som låste posten. Sätts bara av fakturaflödet; en post med invoice_id kan aldrig plockas igen.';

-- ---------------------------------------------------------------------------
-- 2) Backfill av historiken — tre klasser, i den här ordningen
-- ---------------------------------------------------------------------------
-- Ordningen är regeln: `invoiced` väger tyngst (posten ÄR fakturerad, oavsett
-- vad billable råkar stå på), därefter `billable = false` (posten valdes bort),
-- och allt annat är godkänd, ofakturerad tid. Ingen historisk post får ett
-- tillstånd som inte redan var sant om den.
UPDATE time_entries
   SET status = CASE
                  WHEN invoiced      THEN 'fakturerad'
                  WHEN NOT billable  THEN 'ignorerad'
                  ELSE                    'godkand'
                END,
       billable_minutes = CASE
                  WHEN invoiced      THEN minutes
                  WHEN NOT billable  THEN 0
                  ELSE                    minutes
                END
 WHERE status IS NULL;

ALTER TABLE time_entries
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN billable_minutes SET NOT NULL;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_status_check
    CHECK (status IN ('forslag', 'godkand', 'justerad', 'ignorerad', 'fakturerad')),
  ADD CONSTRAINT time_entries_billable_minutes_check
    CHECK (billable_minutes >= 0 AND billable_minutes <= 1440),
  ADD CONSTRAINT time_entries_source_check
    CHECK (source IN ('manuell', 'kalender', 'mail', 'harledd'));

-- Komposit-FK, samma mönster som 0047:s bilagerad och 0060:s projektkoppling:
-- en tidpost i bolag A kan aldrig låsas av en faktura i bolag B, ens om någon
-- lyckas gissa ett uuid.
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_invoice_fk FOREIGN KEY (invoice_id, company_id)
    REFERENCES invoices (id, company_id);

-- Fakturaunderlagets urval (status + invoice_id + period) och
-- godkännandeloopens "vad ligger som förslag" är de två frågor som kommer
-- ställas ofta nog att de förtjänar var sitt index.
CREATE INDEX time_entries_status_idx ON time_entries (company_id, status, work_date);
CREATE INDEX time_entries_invoice_idx
  ON time_entries (company_id, invoice_id) WHERE invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Loggtabell för datajobbet nedan
-- ---------------------------------------------------------------------------
-- En datafix som rör riktig bokföringsnära data ska gå att granska i efterhand,
-- rad för rad. audit_log duger inte här: den kräver en user_id och en
-- RLS-kontext som en migration inte har (0005 satte FORCE ROW LEVEL SECURITY
-- på den), och en migration ska inte behöva låtsas vara en människa.
--
-- UNIQUE (migration, time_entry_id) är det som gör datajobbet bevisbart
-- idempotent: körs det om kan det varken ändra en rad igen eller lägga en
-- andra loggrad om samma rad.
CREATE TABLE time_entry_datafix_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  time_entry_id uuid NOT NULL,
  migration     text NOT NULL,
  from_status   text NOT NULL,
  to_status     text NOT NULL,
  invoice_id    uuid,
  reason        text NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (migration, time_entry_id)
);
CREATE INDEX time_entry_datafix_log_company_idx ON time_entry_datafix_log (company_id, applied_at DESC);

ALTER TABLE time_entry_datafix_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY time_entry_datafix_log_select ON time_entry_datafix_log FOR SELECT
  USING (app_has_company_access(company_id));
-- Bara SELECT till app: loggen skrivs av migrationen (ägarrollen), aldrig av
-- appen. Det som inte går att skriva går inte heller att skriva om.
--
-- MEDVETET UTAN `FORCE ROW LEVEL SECURITY`, till skillnad från t.ex. 0047:s
-- bilagerader. Skälet är att ägarrollen är den ENDA som skriver här, och den
-- skriver från en migration som varken har en inloggad användare eller en
-- RLS-kontext. FORCE hade gjort raden nedanför omöjlig att skriva. Skyddet mot
-- läsning över bolagsgränsen ligger kvar där det betyder något: app-rollen är
-- inte ägare, och policyn ovan gäller den fullt ut.
GRANT SELECT ON time_entry_datafix_log TO app;

-- ---------------------------------------------------------------------------
-- 4) Datafixen: juli 2026 (PRD §1 rad 1 och 2)
-- ---------------------------------------------------------------------------
-- Inga hårdkodade uuid:n. Fakturan pekas ut av det nummer KUNDEN fick på sin
-- PDF — `effective_invoice_number` 27 (0046) — och posterna av vilket projekt
-- och vilken period de hör till. Beskrivningen är enda sättet att hitta de två
-- som aldrig skulle faktureras; det är en svagare nyckel än ett id, och därför
-- loggas varje enskild rad som ändras.
--
-- Stycket mellan markörerna nedan är HELA datajobbet och är skrivet för att
-- kunna köras om utan verkan (testet gör exakt det: läser filen, kör stycket
-- en andra gång och kräver att ingenting rör sig).
-- >>> DATAFIX_START
DO $$
DECLARE
  faktura     record;
  projekt     uuid;
  manad       date;
  antal       integer;
BEGIN
  FOR faktura IN
    SELECT i.id, i.company_id, i.customer_id, i.project_id, i.invoice_date,
           i.effective_invoice_number AS nummer
      FROM invoices i
     WHERE i.effective_invoice_number = 27
     ORDER BY i.company_id
  LOOP
    -- Har jobbet redan gått i det här bolaget är det FÄRDIGT — inte "kör igen
    -- och se vad som händer". Utan den här grinden hade en omkörning kunnat
    -- hitta en NY tidigaste månad (arbete registrerat i efterhand) och låsa
    -- augustitid mot julifakturan. Loggen är alltså inte bara ett kvitto, den
    -- är villkoret.
    SELECT count(*) INTO antal FROM time_entry_datafix_log l
     WHERE l.migration = '0062' AND l.company_id = faktura.company_id;
    IF antal > 0 THEN
      RAISE NOTICE '0062 datafix: bolag % är redan fixat (% loggrader) — hoppar över',
        faktura.company_id, antal;
      CONTINUE;
    END IF;

    -- Projektet: fakturans eget om det finns (0060 satte det där svaret var
    -- entydigt), annars kundens projekt när kunden har EXAKT ETT. Har kunden
    -- två är valet en gissning, och en gissad koppling i faktaform är värre än
    -- ingen — samma regel som 0060 skrev.
    projekt := faktura.project_id;
    IF projekt IS NULL THEN
      SELECT p.id INTO projekt
        FROM projects p
       WHERE p.company_id = faktura.company_id
         AND p.customer_id = faktura.customer_id
         AND (SELECT count(*) FROM projects q
               WHERE q.company_id = faktura.company_id
                 AND q.customer_id = faktura.customer_id) = 1;
    END IF;

    IF projekt IS NULL THEN
      RAISE NOTICE '0062 datafix: faktura % (bolag %) har inget entydigt projekt — inga tidposter ändrade',
        faktura.nummer, faktura.company_id;
      CONTINUE;
    END IF;

    -- Perioden härleds ur posterna, inte ur ett antaget månadsnamn: den
    -- tidigaste kalendermånad som fortfarande bär godkänd, ofakturerad tid på
    -- fakturans projekt före fakturadatumet. Arbete som utförts EFTER att
    -- fakturan ställdes ut hör per definition till nästa faktura och rörs inte.
    SELECT date_trunc('month', min(t.work_date))::date INTO manad
      FROM time_entries t
     WHERE t.company_id = faktura.company_id
       AND t.project_id = projekt
       AND t.status = 'godkand'
       AND t.invoice_id IS NULL
       AND t.work_date < faktura.invoice_date;

    IF manad IS NULL THEN
      RAISE NOTICE '0062 datafix: faktura % (bolag %) — ingen godkänd, ofakturerad tid på projektet, inget att göra',
        faktura.nummer, faktura.company_id;
      CONTINUE;
    END IF;

    -- (a) De två som aldrig skulle faktureras. Görs FÖRST, så att de inte hinner
    --     låsas av fakturan i steg (b).
    WITH urval AS (
      SELECT t.id, t.status
        FROM time_entries t
       WHERE t.company_id = faktura.company_id
         AND t.project_id = projekt
         AND t.status = 'godkand'
         AND t.invoice_id IS NULL
         AND t.work_date >= manad
         AND t.work_date < (manad + interval '1 month')
         AND (t.description ILIKE '%admin%' OR t.description ILIKE '%supportmatris%')
    ), andrade AS (
      UPDATE time_entries t
         SET status = 'ignorerad',
             billable = false,
             billable_minutes = 0,
             adjustment_reason = 'Datafix 0062: skulle inte faktureras (PRD §1 rad 2)'
        FROM urval u
       WHERE t.id = u.id
      RETURNING t.id, u.status AS fran
    )
    INSERT INTO time_entry_datafix_log
      (company_id, time_entry_id, migration, from_status, to_status, invoice_id, reason)
    SELECT faktura.company_id, a.id, '0062', a.fran, 'ignorerad', NULL::uuid,
           'Icke debiterbar post (admin/supportmatris) i julifakturans period'
      FROM andrade a
    ON CONFLICT (migration, time_entry_id) DO NOTHING;
    GET DIAGNOSTICS antal = ROW_COUNT;
    RAISE NOTICE '0062 datafix: faktura % — % post(er) satta till ignorerad', faktura.nummer, antal;

    -- (b) Resten av periodens godkända tid ÄR julifakturan. Posterna låses med
    --     fakturans id, inte bara med en boolean: det är kopplingen som gör en
    --     dubbelfakturering omöjlig i stället för osannolik.
    WITH urval AS (
      SELECT t.id, t.status
        FROM time_entries t
       WHERE t.company_id = faktura.company_id
         AND t.project_id = projekt
         AND t.status = 'godkand'
         AND t.invoice_id IS NULL
         AND t.work_date >= manad
         AND t.work_date < (manad + interval '1 month')
    ), andrade AS (
      UPDATE time_entries t
         SET status = 'fakturerad',
             invoiced = true,
             invoice_id = faktura.id
        FROM urval u
       WHERE t.id = u.id
      RETURNING t.id, u.status AS fran
    )
    INSERT INTO time_entry_datafix_log
      (company_id, time_entry_id, migration, from_status, to_status, invoice_id, reason)
    SELECT faktura.company_id, a.id, '0062', a.fran, 'fakturerad', faktura.id,
           'Ingick i julifakturan (effective_invoice_number 27) men markerades aldrig'
      FROM andrade a
    ON CONFLICT (migration, time_entry_id) DO NOTHING;
    GET DIAGNOSTICS antal = ROW_COUNT;
    RAISE NOTICE '0062 datafix: faktura % — % post(er) satta till fakturerad', faktura.nummer, antal;
  END LOOP;
END
$$;
-- <<< DATAFIX_SLUT
