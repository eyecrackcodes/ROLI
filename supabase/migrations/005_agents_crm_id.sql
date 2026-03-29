-- Add CRM agent ID column to agents table for direct lookup (bypasses fuzzy matching)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS crm_agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agents_crm_id ON agents(crm_agent_id);
