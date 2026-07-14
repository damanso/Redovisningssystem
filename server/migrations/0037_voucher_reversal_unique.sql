-- Slutgrind (säkerhetsfynd): ett verifikat får återföras EXAKT en gång. Applagret
-- kontrollerar detta, men ett partiellt unikt index gör dubbel återföring omöjlig
-- även vid samtidiga transaktioner (två parallella rättelser av samma verifikat).
CREATE UNIQUE INDEX vouchers_reverses_uk
  ON vouchers (company_id, reverses_voucher_id)
  WHERE reverses_voucher_id IS NOT NULL;
