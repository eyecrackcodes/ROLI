-- Link the ROLI agents table to ADP Workforce Now via associateOID.
-- ADP is the authoritative source for legal name, employment status, hire date,
-- termination date, job title, and (once Time & Labor is provisioned) attendance.
-- The roster sync workflow (apify/dsb-adp-roster-sync + n8n/dsb-adp-roster-sync)
-- writes to these columns nightly.
--
-- We deliberately do NOT make ADP the primary key — `name` stays the join column
-- for historical scrape data so back-loaded records keep working. associateOID
-- is the *stable* link that survives legal-name changes (marriage, etc).

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS adp_associate_oid       text,
  ADD COLUMN IF NOT EXISTS adp_status              text,
  ADD COLUMN IF NOT EXISTS adp_status_effective_date date,
  ADD COLUMN IF NOT EXISTS adp_job_title           text,
  ADD COLUMN IF NOT EXISTS adp_work_email          text,
  ADD COLUMN IF NOT EXISTS adp_synced_at           timestamptz;

-- One ADP person → at most one ROLI agent row. Allow NULL so 1099s and
-- pre-paperwork hires can still live in agents.
CREATE UNIQUE INDEX IF NOT EXISTS agents_adp_associate_oid_unique_idx
  ON agents (adp_associate_oid)
  WHERE adp_associate_oid IS NOT NULL;

CREATE INDEX IF NOT EXISTS agents_adp_status_idx
  ON agents (adp_status);

COMMENT ON COLUMN agents.adp_associate_oid IS
  'ADP Workforce Now associateOID — stable internal ID, survives name changes. Use this as the join key when reconciling against /hr/v2/workers.';
COMMENT ON COLUMN agents.adp_status IS
  'Latest assignmentStatus.statusCode from ADP: A=Active, T=Terminated, L=Leave. Updated by dsb-adp-roster-sync workflow.';
COMMENT ON COLUMN agents.adp_status_effective_date IS
  'assignmentStatus.effectiveDate from ADP — the real termination date for terminated workers (preferred over our internal terminated_date for new terminations).';
COMMENT ON COLUMN agents.adp_job_title IS
  'workAssignments[primary].jobTitle from ADP — "Agent" for sales staff. Empty for 1099s.';
COMMENT ON COLUMN agents.adp_work_email IS
  'businessCommunication.emails[Work E-mail] from ADP — the @luminarylife.com address.';
COMMENT ON COLUMN agents.adp_synced_at IS
  'Last time the dsb-adp-roster-sync workflow successfully refreshed this row from ADP.';

COMMIT;
