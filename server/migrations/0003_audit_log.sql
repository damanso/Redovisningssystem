-- Immutabel, append-only revisionslogg — finns från dag ett (plan §5 punkt 4).
--
-- Tre försvarslinjer mot ändring/radering:
--   1. app-rollen får bara SELECT + INSERT (REVOKE på resten är implicit:
--      privilegier som aldrig GRANT:ats finns inte).
--   2. Triggrar blockerar UPDATE/DELETE/TRUNCATE även för tabellägaren.
--   3. RLS begränsar läsning till det egna bolaget.

CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- NULL för användarnivå-händelser (registrering, misslyckad inloggning)
  company_id  uuid REFERENCES companies(id),
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_company_idx ON audit_log (company_id, occurred_at DESC);

CREATE FUNCTION audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log är append-only: % tillåts inte', TG_OP;
END
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (company_id IS NULL OR app_has_company_access(company_id));

GRANT SELECT, INSERT ON audit_log TO app;
