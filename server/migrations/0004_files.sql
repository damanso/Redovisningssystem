-- Dokumentarkivets metadata. Själva filerna lagras på disk utanför webroten
-- med UUID-namn — aldrig användarens filnamn (path traversal-skydd).
-- CHECK-villkoret på stored_name är sista försvarslinjen: även en manipulerad
-- databasrad kan inte peka utanför uppladdningskatalogen.

CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  original_name text NOT NULL,
  stored_name   text NOT NULL UNIQUE
    CHECK (stored_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'),
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        text NOT NULL,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX files_company_idx ON files (company_id, created_at DESC);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY files_select ON files FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY files_insert ON files FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

GRANT SELECT, INSERT ON files TO app;
