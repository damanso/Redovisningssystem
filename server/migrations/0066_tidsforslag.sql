-- PRD_TIDSRAPPORTERING §4 F4–F5 (story 7): mottagarsidan för AI-föreslagen tid.
--
-- Story 1 gav tidposten en livscykel med statusen `forslag`, men ingenting
-- kunde SKAPA ett förslag i batch och ingenting kunde godkänna flera på en
-- gång. Den här migrationen lägger de fyra egenskaper som skiljer ett förslag
-- från en registrerad post:
--
--   1. `source_ref` som IDEMPOTENSNYCKEL. Kalendern och mailindexet läses om
--      varje natt; utan ett unikt index blir intaget en dubblettgenerator, och
--      en dubblerad tidpost är dubbla pengar på nästa faktura. Indexet är
--      partiellt: manuellt registrerad tid har ingen källa och ska inte
--      behöva hitta på en.
--   2. `uncertainty` — hur säkert förslaget är. Ett förslag som påstår sig
--      säkert när det gissar är värre än inget förslag.
--   3. `reasoning` — EN mening om varför, som gallras (se nedan). Aldrig
--      ordagrann mailtext; regeln står i docs/crm/API_KONTRAKT.md och gäller
--      avsändaren, men fältets längd och livslängd bärs här.
--   4. `overlaps_manual` — det finns redan en manuell post samma dag på samma
--      uppdrag. Vyn frågar då "redan registrerad?" i stället för att lägga en
--      tyst andra rad.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna
-- ---------------------------------------------------------------------------
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS uncertainty     text,
  ADD COLUMN IF NOT EXISTS reasoning       text,
  ADD COLUMN IF NOT EXISTS overlaps_manual boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_uncertainty_check') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_uncertainty_check
      CHECK (uncertainty IS NULL OR uncertainty IN ('lag', 'medel', 'hog'));
  END IF;

  -- 0017:s CHECK (minutes > 0 AND minutes <= 1440) ersätts.
  --
  -- Skälet: ett mailspår har ingen varaktighet. Rådslaget 1/9 beslutade att
  -- mailförslag kommer in med `minutes = 0` — de säger ATT något hände, inte
  -- hur länge. Den nollan får aldrig bli fakturerbar tid, så taket 1440 står
  -- kvar och nollan tillåts BARA i de två statusar som ligger utanför
  -- fakturan: `forslag` (ännu inte bedömt) och `ignorerad` (bedömt, ska inte
  -- faktureras). `godkand`, `justerad` och `fakturerad` kräver som förut minst
  -- en minut — annars hade en nolla kunnat vandra in på en faktura.
  --
  -- `ignorerad` MÅSTE rymmas här: KRAV-6 säger att en 0-minuters mailmarkering
  -- ska kunna få tid satt ELLER ignoreras, och utan undantaget hade den enda
  -- vägen bort från kön varit stängd av ett CHECK-villkor.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_minutes_check') THEN
    ALTER TABLE time_entries DROP CONSTRAINT time_entries_minutes_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_minutes_range_check') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_minutes_range_check
      CHECK (minutes >= 0 AND minutes <= 1440
             AND (minutes > 0 OR status IN ('forslag', 'ignorerad')));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Idempotensnyckeln
-- ---------------------------------------------------------------------------
-- Samma regel som crm.interactions har på (company_id, source_system,
-- source_ref): samma händelse två gånger blir EN rad. Här är den viktigare än
-- där — en dubblerad kontaktpunkt är brus, en dubblerad tidpost är pengar.
--
-- Tjänstelagret slår upp källan innan det skriver och rapporterar `duplicates`;
-- indexet är andra försvarslinjen, för två samtidiga batchar hinner annars
-- båda göra sitt uppslag innan någon skriver.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_source_ref_uk
  ON time_entries (company_id, source_ref) WHERE source_ref IS NOT NULL;

-- Kön läses per dag, nyaste först, och bara för statusen `forslag`.
CREATE INDEX IF NOT EXISTS time_entries_forslag_idx
  ON time_entries (company_id, work_date DESC) WHERE status = 'forslag';

COMMENT ON COLUMN time_entries.uncertainty IS
  'Hur säkert AI-förslaget är (lag/medel/hog). NULL för allt en människa skrivit.';
COMMENT ON COLUMN time_entries.reasoning IS
  'EN mening om varför posten föreslogs. Aldrig ordagrann mailtext eller tredje parts namn. Nollställs när posten blir fakturerad och efter 90 dagar för ignorerade poster — source_ref behålls som spår.';
COMMENT ON COLUMN time_entries.overlaps_manual IS
  'Det fanns redan en manuellt registrerad post samma dag på samma uppdrag när förslaget skapades. Vyn frågar "redan registrerad?" i stället för att tyst lägga en andra rad.';
