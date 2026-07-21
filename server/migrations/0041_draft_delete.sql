-- K6: radering av OBOKADE registerutkast. Oföränderligheten gäller BOKFÖRDA
-- verifikat — ett utkast som aldrig nått huvudboken (voucher_id IS NULL) är
-- inte räkenskapsinformation och ska kunna rättas genom att tas bort (t.ex.
-- fakturautkast registrerade på fel kund). RLS-policyerna är den hårda
-- garantin: DELETE släpps bara igenom för obokade utkast i eget bolag, oavsett
-- vad applikationskoden gör. Tjänstelagret auditloggar varje radering med en
-- snapshot av raden.

CREATE POLICY invoices_delete ON invoices FOR DELETE
  USING (app_has_company_access(company_id) AND voucher_id IS NULL AND status = 'draft');
GRANT DELETE ON invoices TO app;
-- invoice_lines följer med via FK ON DELETE CASCADE (referentiella åtgärder
-- körs som tabellägaren och behöver ingen egen DELETE-policy för app).

CREATE POLICY receipts_delete ON receipts FOR DELETE
  USING (app_has_company_access(company_id) AND voucher_id IS NULL AND status = 'registered');
GRANT DELETE ON receipts TO app;

CREATE POLICY supplier_invoices_delete ON supplier_invoices FOR DELETE
  USING (app_has_company_access(company_id) AND voucher_id IS NULL AND status = 'draft');
GRANT DELETE ON supplier_invoices TO app;

CREATE POLICY payslips_delete ON payslips FOR DELETE
  USING (app_has_company_access(company_id) AND voucher_id IS NULL AND status = 'draft');
GRANT DELETE ON payslips TO app;

-- Dokumentkopplingar till en raderad post städas av tjänstelagret.
CREATE POLICY documents_delete ON documents FOR DELETE
  USING (app_has_company_access(company_id));
GRANT DELETE ON documents TO app;
