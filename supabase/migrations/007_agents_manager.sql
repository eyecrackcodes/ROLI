-- Add manager (team) and status columns to agents table.
-- The manager name doubles as the team name per org chart convention.
-- agent_status distinguishes Selling vs Training vs Unlicensed.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS manager TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_status TEXT DEFAULT 'selling'
  CHECK (agent_status IN ('selling', 'training', 'unlicensed'));

CREATE INDEX IF NOT EXISTS idx_agents_manager ON agents(manager);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(agent_status);
