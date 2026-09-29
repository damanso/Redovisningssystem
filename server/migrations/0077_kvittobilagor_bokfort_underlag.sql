-- Kvittobilagor (FR-12, beslut #194): bokfört underlag förblir bokfört.
--
-- 0075 lät oföränderligheten (triggern) och raderingsspärren (DELETE-policyn)
-- bygga på kvittots AKTUELLA voucher_id. unlink_voucher sätter voucher_id till
-- NULL på ett baklänkat kvitto — och då blev underlaget både skrivbart och
-- raderbart (delete_draft_receipt), fast verifikatet det styrker ligger kvar
-- orört i huvudboken.
--
-- Regeln nu: ett kvitto räknas som bokfört om det HAR ett verifikat eller
-- någon gång har baklänkats till ett. Det senare läses ur auditloggen
-- (`receipt.voucher_linked`), som är append-only och därför inte kan glömma —
-- samma källa unlink_voucher själv prövar sin spärr mot (services/
-- voucherLinks.ts). Obekräftade rader berörs inte: de får alltid städas.
--
-- Funktionen körs som anroparen (app-rollen), så auditloggens RLS gäller.

CREATE OR REPLACE FUNCTION receipt_har_bokfort_underlag(p_receipt_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM receipts r
     WHERE r.id = p_receipt_id
       AND (
         r.voucher_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM audit_log a
            WHERE a.company_id = r.company_id
              AND a.action = 'receipt.voucher_linked'
              AND a.entity_type = 'receipt'
              AND a.entity_id = r.id::text
         )
       )
  )
$$;

-- Uppslaget ovan per kvitto, utan att skanna bolagets hela auditlogg.
CREATE INDEX IF NOT EXISTS audit_log_kvitto_baklankning_idx
  ON audit_log (company_id, entity_id)
  WHERE action = 'receipt.voucher_linked';

-- Regel 2 (0075), nu mot bokfört underlag i stället för aktuellt voucher_id.
CREATE OR REPLACE FUNCTION receipt_files_vagrar_andring_pa_bokfort() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'active' OR NOT receipt_har_bokfort_underlag(OLD.receipt_id) THEN
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

-- Regel 3 (0075), samma byte.
DROP POLICY IF EXISTS receipt_files_delete ON receipt_files;
CREATE POLICY receipt_files_delete ON receipt_files FOR DELETE
  USING (
    app_has_company_access(company_id)
    AND (status <> 'active' OR NOT receipt_har_bokfort_underlag(receipt_id))
  );
