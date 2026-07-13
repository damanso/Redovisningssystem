-- Fas A2: rikare CRM ovanpå parterna — kontaktpersoner, anteckningar och taggar
-- för kunder och leverantörer. Polymorft (party_type + party_id) så samma tabell
-- betjänar båda; tenant tvingas via company_id + RLS (ingen hård FK till parten,
-- existens valideras i servicelagret inom tenant-gränsen).

ALTER TABLE customers ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE suppliers ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

CREATE TABLE party_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id   uuid NOT NULL,
  name       text NOT NULL,
  email      text,
  phone      text,
  role       text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX party_contacts_party_idx ON party_contacts (company_id, party_type, party_id);

CREATE TABLE party_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id   uuid NOT NULL,
  user_id    uuid REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX party_notes_party_idx ON party_notes (company_id, party_type, party_id, created_at DESC);

ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY party_contacts_select ON party_contacts FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY party_contacts_insert ON party_contacts FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY party_contacts_update ON party_contacts FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
CREATE POLICY party_contacts_delete ON party_contacts FOR DELETE USING (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON party_contacts TO app;

ALTER TABLE party_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY party_notes_select ON party_notes FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY party_notes_insert ON party_notes FOR INSERT WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT ON party_notes TO app;
