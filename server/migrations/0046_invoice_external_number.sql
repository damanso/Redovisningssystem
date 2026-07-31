-- LOC-263 del 2: seriesynk mellan systemets interna fakturanummer och den
-- externa kundserien (de nummer kunderna faktiskt fått på sina fakturor).
--
-- Bakgrund: systemets räknare (number_sequences) hade glidit isär från
-- kundserien — internt 14 = externt 26, internt 26 = externt 27. Beslut
-- (David 2026-07-31): EN serie framåt (räknaren flyttas fram), och de gamla
-- avvikande fakturorna får kundnumret i ett eget fält. Bokförd historik
-- skrivs ALDRIG om.

ALTER TABLE invoices ADD COLUMN external_invoice_number integer
  CHECK (external_invoice_number IS NULL OR external_invoice_number > 0);

-- Numret kunden ser: det externa när det finns, annars systemets eget.
-- Genererad kolumn så att både PDF:en, vyn och unikhetsgarantin nedan alltid
-- utgår från EXAKT samma värde — det kan inte glida isär i efterhand.
ALTER TABLE invoices ADD COLUMN effective_invoice_number integer
  GENERATED ALWAYS AS (COALESCE(external_invoice_number, invoice_number)) STORED;

-- Två fakturor får ALDRIG visa samma nummer för en kund. DEFERRABLE gör att en
-- rättelse som byter nummer på flera fakturor i samma transaktion kan göras i
-- valfri ordning (annars skulle t.ex. 14→26 krocka med den befintliga 26:an
-- innan den hunnit bli 27).
ALTER TABLE invoices ADD CONSTRAINT invoices_effective_number_uk
  UNIQUE (company_id, effective_invoice_number) DEFERRABLE INITIALLY IMMEDIATE;
