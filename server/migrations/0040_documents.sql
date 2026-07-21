-- K3: generell dokumentkoppling. Ett dokument = en fil i dokumentarkivet (files)
-- kopplad till en registerpost (lönebesked, faktura, kvitto, leverantörsfaktura
-- eller verifikat). Stänger gapet att underlag inte kunde bäras av registerposter:
-- lönespec-PDF:en på lönebeskedet, kvittofotot på kvittot osv. Själva filen ägs
-- av files/fileStorage (UUID-namn utanför webroten); detta är bara kopplingen.

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id),
  entity_type text NOT NULL CHECK (entity_type IN ('payslip', 'invoice', 'receipt', 'supplier_invoice', 'voucher')),
  entity_id   uuid NOT NULL,
  title       text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Samma fil kan kopplas till flera poster, men inte till samma post två gånger.
  CONSTRAINT documents_link_uk UNIQUE (company_id, file_id, entity_type, entity_id)
);
CREATE INDEX documents_entity_idx ON documents (company_id, entity_type, entity_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_select ON documents FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY documents_insert ON documents FOR INSERT WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT ON documents TO app;
