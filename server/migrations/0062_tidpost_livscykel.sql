-- PRD_TIDSRAPPORTERING §9 steg 1: tidspostens LIVSCYKEL och debiterbara minuter
-- skilt från registrerade — plus datafixen för juli 2026.
--
-- Felet som gör migrationen nödvändig (PRD §1 rad 1–2): julifakturan skickades
-- och betalades, men ingen av tidsposterna markerades som fakturerad. De ligger
-- kvar som `billable, invoiced = false` — alltså som ofakturerad tid, redo att
-- faktureras EN GÅNG TILL. Två av posterna skulle dessutom aldrig ha
-- fakturerats (egen administration, supportmatris), och det fanns ingen väg i
-- systemet att säga det: `billable` är ett ja/nej satt vid registreringen, utan
-- skäl och utan spår.
--
-- Modellen: `minutes` betyder fortfarande REGISTRERADE minuter och byter
-- varken namn eller innebörd. Det som tillkommer är `billable_minutes` (vad
-- kunden betalar), `status` (var i livscykeln posten är) och `invoice_id` (vad
-- som LÅSER posten). `billable`/`invoiced` behålls som härledda speglingar av
-- statusen, så att de sex befintliga läsarna (projektvyn, styrvyn, kundkortet,
-- relationshärledningarna, fakturabilagan, RLS-policyn i 0053) fungerar
-- oförändrade — den här migrationen ändrar ingen av dem.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna
-- ---------------------------------------------------------------------------
-- IF NOT EXISTS genomgående: filen ska kunna köras om utan fel och utan
-- dubbeleffekt (kedjan är versionsstyrd, men datajobbet nedan prövas genom att
-- köras två gånger — se server/test/tidpost-migration-0062.test.ts).
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS status            text,
  ADD COLUMN IF NOT EXISTS billable_minutes  integer,
  ADD COLUMN IF NOT EXISTS source            text,
  ADD COLUMN IF NOT EXISTS source_ref        text,
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_id        uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_status_check') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_status_check
      CHECK (status IN ('forslag', 'godkand', 'justerad', 'ignorerad', 'fakturerad'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_billable_minutes_check') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_billable_minutes_check
      CHECK (billable_minutes >= 0 AND billable_minutes <= 1440);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_source_check') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_source_check
      CHECK (source IN ('manuell', 'kalender', 'mail', 'harledd'));
  END IF;
  -- Komposit-FK som 0047: låset kan aldrig peka på en faktura i ett annat
  -- bolag. Utan (invoice_id, company_id) vore "fakturerad" ett påstående som
  -- gick att sätta tvärs tenantgränsen.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_invoice_fk') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_invoice_fk
      FOREIGN KEY (invoice_id, company_id) REFERENCES invoices (id, company_id);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Backfill — tre klasser, härledda ur det som redan står i raden
-- ---------------------------------------------------------------------------
-- Villkoret `status IS NULL` är det som gör backfillen körbar om: efter första
-- körningen finns ingen rad kvar utan status, och satsen träffar noll rader.
-- Ordningen är regeln: invoiced väger tyngst (en fakturerad post är låst även
-- om den en gång registrerades som ej debiterbar), därefter billable.
UPDATE time_entries
   SET status = CASE WHEN invoiced      THEN 'fakturerad'
                     WHEN NOT billable  THEN 'ignorerad'
                     ELSE                    'godkand' END,
       -- Den gamla modellen fakturerade alltid hela `minutes`; det är alltså
       -- vad kunden faktiskt betalade för de redan fakturerade posterna.
       billable_minutes = CASE WHEN invoiced     THEN minutes
                               WHEN NOT billable THEN 0
                               ELSE                   minutes END,
       source = COALESCE(source, 'manuell')
 WHERE status IS NULL;

ALTER TABLE time_entries
  ALTER COLUMN source SET DEFAULT 'manuell';
ALTER TABLE time_entries
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN billable_minutes SET NOT NULL,
  ALTER COLUMN source SET NOT NULL;

-- `status` får med flit INGEN default: varje skrivväg ska säga var i
-- livscykeln posten hamnar. Ett tyst 'godkand' hade gjort agentens förslag
-- till ett godkännande utan att någon människa sett det.

CREATE INDEX IF NOT EXISTS time_entries_status_idx
  ON time_entries (company_id, status, work_date);
CREATE INDEX IF NOT EXISTS time_entries_invoice_idx
  ON time_entries (company_id, invoice_id) WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN time_entries.minutes IS
  'REGISTRERADE minuter — vad som hände. Byter aldrig innebörd.';
COMMENT ON COLUMN time_entries.billable_minutes IS
  'DEBITERBARA minuter — vad kunden betalar. Skiljer de sig från minutes är statusen justerad och skälet står i adjustment_reason.';
COMMENT ON COLUMN time_entries.invoice_id IS
  'Fakturan som låste posten. Sätts av fakturabilagan i samma transaktion som status blir fakturerad.';

-- ---------------------------------------------------------------------------
-- 3) Datafix juli 2026 — ett datajobb, inte en lista med id:n
-- ---------------------------------------------------------------------------
-- Davids villkor: idempotent, inga hårdkodade uuid:n, spårbar per rad.
--
-- Posterna identifieras därför på REGELN, inte på identiteten: fakturan är den
-- vars nummer mot kund är 27 (`effective_invoice_number`, den genererade
-- kolumnen ur 0046) och som är daterad i juli–augusti 2026; uppdraget är
-- fakturans projekt när det är satt (0060), annars kundens projekt; perioden är
-- juli 2026. Ingen rad utanför det fönstret rörs. Skulle fakturan inte finnas
-- (t.ex. i en tom testdatabas) träffar satserna noll rader — de gissar aldrig.
--
-- Varje ändrad rad får sin egen rad i den append-only auditloggen, med
-- före-värdena. `user_id` är NULL: det var ingen människa som klickade, det var
-- den här migrationen — och det ska synas.

WITH juli AS (
  SELECT i.id AS invoice_id, i.company_id, i.project_id, i.customer_id
    FROM invoices i
   WHERE i.effective_invoice_number = 27
     AND i.invoice_date >= DATE '2026-07-01'
     AND i.invoice_date <  DATE '2026-09-01'
),
kandidater AS (
  SELECT t.id, t.company_id, t.minutes, t.billable_minutes, t.status, j.invoice_id
    FROM time_entries t
    JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
    JOIN juli j
      ON j.company_id = t.company_id
     AND CASE WHEN j.project_id IS NOT NULL
              THEN t.project_id = j.project_id
              ELSE p.customer_id = j.customer_id END
   WHERE t.work_date >= DATE '2026-07-01'
     AND t.work_date <= DATE '2026-07-31'
     AND t.invoice_id IS NULL
     -- De två som aldrig skulle faktureras: egen administration respektive
     -- supportmatrisen. Beskrivningen är det enda som skiljer dem från de
     -- övriga — och den är skriven av en människa, inte gissad av systemet.
     AND (lower(t.description) LIKE '%admin%' OR lower(t.description) LIKE '%supportmatris%')
     -- En redan fakturerad post är låst och rörs aldrig — inte ens av en
     -- omklassning. Det som är utskickat till kund rättas med kreditering.
     AND t.status <> 'fakturerad'
     -- Idempotens: raden är redan omhändertagen när den både är ignorerad och
     -- bär sitt skäl.
     AND (t.status IS DISTINCT FROM 'ignorerad' OR t.adjustment_reason IS NULL)
),
andrade AS (
  UPDATE time_entries t
     SET status = 'ignorerad',
         billable_minutes = 0,
         billable = false,
         invoiced = false,
         adjustment_reason = CASE WHEN lower(t.description) LIKE '%supportmatris%'
                                  THEN 'Ej debiterbar: supportmatris (juliavstämningen 2026-09-01, PRD §1 rad 2)'
                                  ELSE 'Ej debiterbar: egen administration (juliavstämningen 2026-09-01, PRD §1 rad 2)' END
    FROM kandidater k
   WHERE t.id = k.id
  RETURNING t.id, t.company_id, k.status AS forra_status, k.billable_minutes AS forra_billable_minutes,
            t.adjustment_reason
)
INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details)
SELECT company_id, NULL, 'time_entry.migrated_0062', 'time_entry', id::text,
       jsonb_build_object(
         'migration', '0062_tidpost_livscykel',
         'fran_status', forra_status,
         'till_status', 'ignorerad',
         'fran_billable_minutes', forra_billable_minutes,
         'till_billable_minutes', 0,
         'skal', adjustment_reason)
  FROM andrade;

WITH juli AS (
  SELECT i.id AS invoice_id, i.company_id, i.project_id, i.customer_id
    FROM invoices i
   WHERE i.effective_invoice_number = 27
     AND i.invoice_date >= DATE '2026-07-01'
     AND i.invoice_date <  DATE '2026-09-01'
),
kandidater AS (
  SELECT t.id, t.company_id, t.minutes, t.billable_minutes, t.status, j.invoice_id
    FROM time_entries t
    JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
    JOIN juli j
      ON j.company_id = t.company_id
     AND CASE WHEN j.project_id IS NOT NULL
              THEN t.project_id = j.project_id
              ELSE p.customer_id = j.customer_id END
   WHERE t.work_date >= DATE '2026-07-01'
     AND t.work_date <= DATE '2026-07-31'
     AND t.invoice_id IS NULL
     -- Allt utom de två ignorerade ovan. `status NOT IN` gör satsen idempotent:
     -- en post som redan är fakturerad eller ignorerad rörs inte igen.
     AND t.status NOT IN ('fakturerad', 'ignorerad')
),
andrade AS (
  UPDATE time_entries t
     SET status = 'fakturerad',
         invoice_id = k.invoice_id,
         invoiced = true,
         billable = true,
         -- Det som fakturerades var de registrerade minuterna: bilagan på
         -- faktura 27 är utskriven ur dem.
         billable_minutes = t.minutes
    FROM kandidater k
   WHERE t.id = k.id
  RETURNING t.id, t.company_id, t.invoice_id, t.billable_minutes,
            k.status AS forra_status, k.billable_minutes AS forra_billable_minutes
)
INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details)
SELECT company_id, NULL, 'time_entry.migrated_0062', 'time_entry', id::text,
       jsonb_build_object(
         'migration', '0062_tidpost_livscykel',
         'fran_status', forra_status,
         'till_status', 'fakturerad',
         'fran_billable_minutes', forra_billable_minutes,
         'till_billable_minutes', billable_minutes,
         'invoice_id', invoice_id)
  FROM andrade;
