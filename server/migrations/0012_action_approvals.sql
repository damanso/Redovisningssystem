-- Fas 3: godkännandekö för känsliga (pengaflyttande/periodlåsande) actions som
-- en AI-agent begär. Människan godkänner innan de körs.

CREATE TABLE action_approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action       text NOT NULL,
  input        jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_actor text NOT NULL CHECK (requested_actor IN ('human', 'agent')),
  decided_by   uuid REFERENCES users(id),
  decided_at   timestamptz,
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_approvals_company_status_idx ON action_approvals (company_id, status, created_at DESC);

CREATE TRIGGER action_approvals_set_updated_at
  BEFORE UPDATE ON action_approvals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY action_approvals_select ON action_approvals FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY action_approvals_insert ON action_approvals FOR INSERT
  WITH CHECK (app_has_company_access(company_id));
CREATE POLICY action_approvals_update ON action_approvals FOR UPDATE
  USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));

GRANT SELECT, INSERT, UPDATE ON action_approvals TO app;
