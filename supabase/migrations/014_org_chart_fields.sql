-- Org-chart and onboarding fields on agents.
-- Adds email, structured manager_id, role, licenses, contract_states, hired_date,
-- phone, slack_user_id. Coexists with the legacy free-text `manager` column for
-- backwards compat — eventually `manager_id` becomes source of truth.

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS manager_id        uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role              text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS licenses          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contract_states   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hired_date        date,
  ADD COLUMN IF NOT EXISTS phone             text,
  ADD COLUMN IF NOT EXISTS slack_user_id     text;

-- Constrain role to a known set; agents are the default, managers/directors
-- become the org chart "parents" referenced by manager_id.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_check;
ALTER TABLE agents
  ADD CONSTRAINT agents_role_check
  CHECK (role IN ('agent', 'manager', 'director', 'admin'));

-- Email uniqueness when present (multiple NULLs are allowed by Postgres).
DROP INDEX IF EXISTS agents_email_unique;
CREATE UNIQUE INDEX agents_email_unique
  ON agents (lower(email))
  WHERE email IS NOT NULL;

-- Manager lookups (org chart traversal, "agents I manage" queries).
CREATE INDEX IF NOT EXISTS agents_manager_id_idx ON agents (manager_id);

-- Schema docs so the next person knows the shape of `licenses`.
COMMENT ON COLUMN agents.email IS
  'Agent email (used by Pipeline Compliance EOD report and notifications). Unique when set.';
COMMENT ON COLUMN agents.manager_id IS
  'FK -> agents.id of the upline (manager/director). Replaces legacy free-text `manager`.';
COMMENT ON COLUMN agents.role IS
  'Org-chart role: agent | manager | director | admin.';
COMMENT ON COLUMN agents.licenses IS
  'Array of license objects: [{state:"CA", license_number:"...", type:"resident", issued_at, expires_at, status}]';
COMMENT ON COLUMN agents.contract_states IS
  'Two-letter state codes the agent is contracted to sell in. Quick filter; derived from licenses + carrier appointments.';
COMMENT ON COLUMN agents.hired_date IS
  'First day on the team (separate from terminated_date). Used for tenure-based metrics.';

COMMIT;
