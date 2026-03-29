-- Soft deactivation: agents remain visible in historical views for dates before termination
ALTER TABLE agents ADD COLUMN IF NOT EXISTS terminated_date DATE DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_terminated ON agents(terminated_date);
