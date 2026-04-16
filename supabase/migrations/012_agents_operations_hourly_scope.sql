-- Non-selling managers / ops: excluded from hourly velocity Slack by agent_status = 'operations'.
-- Hourly workflow treats RMT + AUS with status selling|training as "remote scope" (Austin sellers on remote model).

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_agent_status_check;
ALTER TABLE agents ADD CONSTRAINT agents_agent_status_check
  CHECK (agent_status IN ('selling', 'training', 'unlicensed', 'operations'));

UPDATE agents
SET agent_status = 'operations'
WHERE name IN (
  'Trent Terrell',
  'Anthony Patton',
  'Melisa Handley',
  'Nic West',
  'Jeff Root',
  'Dante Cantu',
  'Sofia Sanchez',
  'Brook Coyne',
  'Sandy Benson',
  'SandyBenson-AUS'
);
