-- Kvittobilagor (överlämning #272, beslut #178): kvittot får bära FLERA
-- bilagor, uppladdade genom en signerad engångs-PUT utanför MCP-protokollet.
--
-- Varför en egen tabell och inte `receipts.file_id`: ett kvitto har ofta mer än
-- ett underlag (nota + förhandsnota, flersidig faktura, deltagarlista). En
-- enda pekare kan aldrig bära dem, och 60+ bokförda kvitton har i dag `NULL`
-- där eftersom ingen väg in fanns alls.
--
-- Varför en egen lagringsväg och inte `files` (0004): `files` fylls av
-- multipart-vägen, där bytesen passerar servern i en autentiserad POST.
-- Bilagevägen är den motsatta: agenten får en signerad URL, laddaren gör en
-- PUT med rå bytes UTAN JWT, och HMAC-signaturen är hela behörigheten. Raden
-- måste därför finnas FÖRE bytesen (status `awaiting_upload`) — ett tillstånd
-- `files` inte har och inte ska få. `files` och multipart-vägen är orörda.
--
-- Fyra regler bärs av schemat:
--
--   1. **Engångs-uppladdning.** Statusen går bara framåt
--      `awaiting_upload` → `uploaded` → `active`. En andra PUT med samma
--      signatur möter en rad som inte längre är `awaiting_upload` (och ett
--      objekt som redan finns — lagringen skriver med `wx`).
--   2. **Bokförd bilaga är oföränderlig.** Bokföringslagens krav på varaktig,
--      oförändrad form gäller underlaget lika mycket som verifikatet.
--      Triggern nedan släpper igenom EN enda ändring på en aktiv bilaga vars
--      kvitto är bokfört: att `superseded_by` sätts en gång, från NULL. Det är
--      rättelsevägen — lägg till rätt bilaga, peka ut den felaktiga.
--   3. **Radering bara på obokat.** DELETE-policyn nekar varje radering av en
--      AKTIV bilaga vars kvitto har ett verifikat. Obekräftade rader (TTL:n
--      gick ut) får alltid städas — annars hade en påbörjad men aldrig
--      fullföljd uppladdning på ett bokfört kvitto blivit evig.
--   4. **Tenant via RLS, som allt annat.** `company_id` sätts alltid ur
--      tenant-transaktionen, aldrig ur indata.
--
-- FK:n till `receipts` är ENKEL, inte husets komposit-FK — samma avvägning och
-- samma skäl som 0074: `receipts` saknar `UNIQUE (id, company_id)`, och att
-- lägga till den vore en schemaändring på en tabell det här bygget inte äger.
-- Tenant-säkerheten bärs i stället av RLS på båda tabellerna plus av att
-- `receipt_id` aldrig når en INSERT utan att först ha slagits upp i samma
-- tenant-transaktion (services/receiptFiles.ts).

CREATE TABLE IF NOT EXISTS receipt_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  receipt_id    uuid NOT NULL REFERENCES receipts(id),
  -- Användarens filnamn. Bara metadata: det förekommer ALDRIG i en sökväg.
  filename      text NOT NULL CHECK (length(filename) BETWEEN 1 AND 300),
  mime_type     text NOT NULL
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')),
  -- Tak 25 MB. Storleken är BEGÄRD vid steg 1 och prövad mot de faktiska
  -- bytesen vid steg 2 och 3 — en rad kan alltså aldrig påstå en annan storlek
  -- än objektet har.
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  -- NULL tills bilagan bekräftats: sha256 beräknas ur det LAGRADE objektet,
  -- aldrig ur något klienten påstår.
  sha256        text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  -- Nyckeln i objektlagringen: <bolag-uuid>/<uuid>.<ändelse>. Mönstret speglas
  -- av services/objektlagring.ts och är sista försvarslinjen mot att en
  -- manipulerad rad pekar utanför lagringsroten (samma tanke som files.0004).
  storage_key   text NOT NULL UNIQUE
    CHECK (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'),
  status        text NOT NULL DEFAULT 'awaiting_upload'
    CHECK (status IN ('awaiting_upload', 'uploaded', 'active')),
  -- Sätts när bilagan BEKRÄFTAS, inte när raden föds: "uppladdad" är ett
  -- påstående först när objektet finns och hashats.
  uploaded_at   timestamptz,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  -- Rättelsevägen: den här bilagan är ersatt av en annan bilaga på samma
  -- kvitto. Pekaren sätts en gång och tas aldrig bort.
  superseded_by uuid REFERENCES receipt_files(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_files_aktiv_har_hash
    CHECK (status <> 'active' OR (sha256 IS NOT NULL AND uploaded_at IS NOT NULL)),
  CONSTRAINT receipt_files_ersatter_inte_sig_sjalv CHECK (superseded_by IS DISTINCT FROM id)
);

COMMENT ON TABLE receipt_files IS
  'Kvittots underlag (originalkvittot). Flera rader per kvitto. Bytesen laddas upp genom en signerad engångs-PUT utanför MCP; raden aktiveras först av confirm_receipt_file, som hashar det lagrade objektet.';
COMMENT ON COLUMN receipt_files.superseded_by IS
  'Bilagan är ersatt av en annan bilaga på samma kvitto. Rättelsevägen för ett BOKFÖRT kvitto, där radering och överskrivning är omöjliga.';
COMMENT ON COLUMN receipt_files.storage_key IS
  'Nyckeln i objektlagringen (<bolag-uuid>/<uuid>.<ändelse>). Användarens filnamn förekommer aldrig i den.';

CREATE INDEX IF NOT EXISTS receipt_files_receipt_idx
  ON receipt_files (company_id, receipt_id, created_at);
-- Den lata städningen läser exakt den här vägen: obekräftade rader per bolag.
CREATE INDEX IF NOT EXISTS receipt_files_stadning_idx
  ON receipt_files (company_id, status, created_at)
  WHERE status <> 'active';

-- ---------------------------------------------------------------------------
-- Regel 2: bokförd bilaga är oföränderlig
-- ---------------------------------------------------------------------------
-- Spärren sitter i Postgres och inte bara i tjänstelagret därför att tre
-- skrivvägar (REST, MCP, vyn) delar tabellen — en regel som bara finns i en
-- applikationskontroll gäller inte för raden nästa väg in skriver. Samma
-- filosofi som den append-only auditloggen (0003) och 0068:s spärrar.
CREATE OR REPLACE FUNCTION receipt_files_vagrar_andring_pa_bokfort() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bokfort boolean;
BEGIN
  SELECT r.voucher_id IS NOT NULL INTO bokfort
    FROM receipts r WHERE r.id = OLD.receipt_id;
  IF NOT COALESCE(bokfort, false) OR OLD.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Enda tillåtna ändringen: superseded_by sätts en gång, från NULL.
  IF OLD.superseded_by IS NULL
     AND NEW.superseded_by IS NOT NULL
     AND NEW.id           IS NOT DISTINCT FROM OLD.id
     AND NEW.receipt_id   IS NOT DISTINCT FROM OLD.receipt_id
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND NEW.filename     IS NOT DISTINCT FROM OLD.filename
     AND NEW.mime_type    IS NOT DISTINCT FROM OLD.mime_type
     AND NEW.size_bytes   IS NOT DISTINCT FROM OLD.size_bytes
     AND NEW.sha256       IS NOT DISTINCT FROM OLD.sha256
     AND NEW.storage_key  IS NOT DISTINCT FROM OLD.storage_key
     AND NEW.status       IS NOT DISTINCT FROM OLD.status
     AND NEW.uploaded_at  IS NOT DISTINCT FROM OLD.uploaded_at
     AND NEW.uploaded_by  IS NOT DISTINCT FROM OLD.uploaded_by THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'bilagan på ett bokfört kvitto är oföränderlig — rättelse sker genom att lägga till rätt bilaga och sätta superseded_by';
END
$$;

DROP TRIGGER IF EXISTS receipt_files_write_once ON receipt_files;
CREATE TRIGGER receipt_files_write_once
  BEFORE UPDATE ON receipt_files
  FOR EACH ROW EXECUTE FUNCTION receipt_files_vagrar_andring_pa_bokfort();

-- ---------------------------------------------------------------------------
-- RLS och GRANT — husmönstret (0003/0004/0041/0068)
-- ---------------------------------------------------------------------------
ALTER TABLE receipt_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_files_select ON receipt_files;
CREATE POLICY receipt_files_select ON receipt_files FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS receipt_files_insert ON receipt_files;
CREATE POLICY receipt_files_insert ON receipt_files FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

DROP POLICY IF EXISTS receipt_files_update ON receipt_files;
CREATE POLICY receipt_files_update ON receipt_files FOR UPDATE
  USING (app_has_company_access(company_id))
  WITH CHECK (app_has_company_access(company_id));

-- Regel 3: en AKTIV bilaga på ett bokfört kvitto raderas aldrig — varken av
-- delete_draft_receipt, av städningen eller av en direkt DELETE.
DROP POLICY IF EXISTS receipt_files_delete ON receipt_files;
CREATE POLICY receipt_files_delete ON receipt_files FOR DELETE
  USING (
    app_has_company_access(company_id)
    AND (
      status <> 'active'
      OR EXISTS (
        SELECT 1 FROM receipts r
         WHERE r.id = receipt_files.receipt_id
           AND r.company_id = receipt_files.company_id
           AND r.voucher_id IS NULL
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_files TO app;
