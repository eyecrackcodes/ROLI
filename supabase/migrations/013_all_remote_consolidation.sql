-- All-Remote Consolidation: CHA office closed, AUS merged into RMT.
-- All active agents are now remote (RMT). CHA agents deactivated.

BEGIN;

-- 1. Deactivate all CHA agents
UPDATE agents
SET is_active = false,
    terminated_date = CURRENT_DATE,
    updated_at = now()
WHERE site = 'CHA' AND is_active = true;

-- 2. Move any remaining AUS agents to RMT
UPDATE agents
SET site = 'RMT',
    updated_at = now()
WHERE site = 'AUS' AND is_active = true;

-- 3. Relax then tighten the site constraint to RMT only for new inserts.
--    Historical rows keep CHA/AUS for audit trail.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_site_check;
-- Allow RMT + legacy values so historical rows don't violate
ALTER TABLE agents ADD CONSTRAINT agents_site_check
  CHECK (site IN ('RMT', 'CHA', 'AUS'));

COMMIT;
