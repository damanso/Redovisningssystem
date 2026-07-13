-- Härdning efter Fas 2-granskningen: bind fakturans kund och kvittots leverantör
-- till dokumentets bolag i DATABASEN (inte bara i servicelagret). FK-validering
-- körs som constraint-ägaren och kringgår RLS, så utan detta kan en rad i bolag
-- A referera en kund/leverantör i bolag B (mitigeras idag bara av en service-
-- SELECT). Composite-FK, samma mönster som voucher_lines/invoice_lines.

ALTER TABLE customers ADD CONSTRAINT customers_id_company_uk UNIQUE (id, company_id);
ALTER TABLE suppliers ADD CONSTRAINT suppliers_id_company_uk UNIQUE (id, company_id);

ALTER TABLE invoices DROP CONSTRAINT invoices_customer_id_fkey;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_customer_fk
  FOREIGN KEY (customer_id, company_id) REFERENCES customers (id, company_id) ON DELETE RESTRICT;

ALTER TABLE receipts DROP CONSTRAINT receipts_supplier_id_fkey;
ALTER TABLE receipts
  ADD CONSTRAINT receipts_supplier_fk
  FOREIGN KEY (supplier_id, company_id) REFERENCES suppliers (id, company_id);
