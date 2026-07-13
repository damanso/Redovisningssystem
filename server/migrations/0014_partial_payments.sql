-- Fas A3: riktiga delbetalningar. Fakturan spårar hur mycket som betalats
-- (paid_amount_ore), och flera betalningsverifikat per faktura tillåts genom att
-- undanta source_type='payment' från dubbelbokningsspärren. Bokförings-/utgivnings-
-- verifikat (en faktura bokas EN gång) skyddas fortfarande av samma index.

ALTER TABLE invoices ADD COLUMN paid_amount_ore bigint NOT NULL DEFAULT 0
  CHECK (paid_amount_ore >= 0 AND paid_amount_ore <= total_ore);

DROP INDEX vouchers_source_uk;
CREATE UNIQUE INDEX vouchers_source_uk
  ON vouchers (company_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_type <> 'payment';
