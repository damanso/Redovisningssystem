-- Härdning av verifikatens oföränderlighet och tenant-integritet efter
-- Fas 1-granskningen. Stänger tre luckor mot DIREKTA DB-skrivningar med
-- app-rollen (inte nåbara via API:t idag, men migrationen påstod att
-- invarianterna tvingas "även mot direkta skrivningar").

-- F1: oföränderlighetstriggern täckte bara UPDATE/DELETE. En rad kunde INSERT:as
-- på ett redan bokfört (committat) verifikat i en NY transaktion → gjorde det
-- obalanserat utan UPDATE/DELETE. Vi stämplar verifikatet med sin skapande
-- transaktions-id och avvisar radinsättningar från en annan transaktion.
ALTER TABLE vouchers ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_current_xact_id();

-- F2: en rads company_id var inte bunden till verifikatets bolag. En användare
-- med medlemskap i två bolag kunde attribuera en rad till fel bolag. Composite-
-- FK tvingar voucher_lines.company_id = vouchers.company_id.
ALTER TABLE vouchers ADD CONSTRAINT vouchers_id_company_uk UNIQUE (id, company_id);
ALTER TABLE voucher_lines DROP CONSTRAINT voucher_lines_voucher_id_fkey;
ALTER TABLE voucher_lines
  ADD CONSTRAINT voucher_lines_voucher_fk
  FOREIGN KEY (voucher_id, company_id) REFERENCES vouchers (id, company_id) ON DELETE CASCADE;

-- Avvisa radinsättning på ett verifikat som skapades i en tidigare transaktion.
-- INVOKER (app) med RLS-kontext så att det egna bolagets verifikat är synligt.
CREATE FUNCTION voucher_line_reject_late_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_xid xid8;
BEGIN
  SELECT created_xid INTO parent_xid FROM vouchers WHERE id = NEW.voucher_id;
  IF parent_xid IS NULL THEN
    RAISE EXCEPTION 'okänt verifikat %', NEW.voucher_id;
  END IF;
  IF parent_xid <> pg_current_xact_id() THEN
    RAISE EXCEPTION 'bokförda verifikat är oföränderliga: rader kan inte läggas till i efterhand (använd rättelseverifikat)';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER voucher_lines_no_late_insert
  BEFORE INSERT ON voucher_lines
  FOR EACH ROW EXECUTE FUNCTION voucher_line_reject_late_insert();

-- F4: radnivå-triggrar fångar inte TRUNCATE. Statement-nivå-spärr (endast
-- relevant för ägar-/superuser-roller; app saknar TRUNCATE-privilegium).
CREATE TRIGGER vouchers_no_truncate
  BEFORE TRUNCATE ON vouchers
  FOR EACH STATEMENT EXECUTE FUNCTION voucher_block_mutation();
CREATE TRIGGER voucher_lines_no_truncate
  BEFORE TRUNCATE ON voucher_lines
  FOR EACH STATEMENT EXECUTE FUNCTION voucher_block_mutation();
