-- ============================================================
-- Migration 009: Org Restructure — Flat Unified Model
-- Effective: 2026-04-10
--
-- Austin office closing. Survivors become Remote (RMT) team.
-- CLT consolidates under single CRM agency.
-- Both sites drop T1/T2/T3 tier distinction operationally.
-- Tier column preserved for historical data.
-- ============================================================

-- 1. Add 'RMT' to site constraint
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_site_check;
ALTER TABLE agents ADD CONSTRAINT agents_site_check CHECK (site IN ('CHA', 'AUS', 'RMT'));

-- 2. Terminate the 7 named agents (laid off 2026-04-10)
UPDATE agents
SET is_active = false, terminated_date = '2026-04-10'
WHERE name IN (
  'SandyBenson-AUS',
  'Trent Terrell',
  'Ashley Bryant',
  'Melisa Handley',
  'Jeff Root',
  'Dante Cantu',
  'Nic West'
) AND is_active = true;

-- 3. Terminate all other AUS agents NOT in the 21 surviving names
UPDATE agents
SET is_active = false, terminated_date = '2026-04-10'
WHERE site = 'AUS'
  AND is_active = true
  AND name NOT IN (
    'Arron Hutton',
    'Angelo Baca',
    'Anthony Patton',
    'Austin Houser',
    'Chris Guyton',
    'Crystal Kurtanic',
    'David Druxman',
    'Drew Idahosa',
    'Eric Marrs',
    'Frederick Holguin',
    'John Sivy',
    'Jonathan Dubbs',
    'Jonathon Mejia',
    'Jremekyo Anderson',
    'Kameron Dollar',
    'Leslie Chandler',
    'Mario Herrera',
    'Melodee Young',
    'Noah Wimberly',
    'Roza Veravillalba',
    'Tanya Nel'
  );

-- 4. Move surviving AUS agents to RMT
UPDATE agents
SET site = 'RMT'
WHERE site = 'AUS' AND is_active = true;

-- 5. Update daily_lead_volume for all active agents to 7
UPDATE agents
SET daily_lead_volume = 7
WHERE is_active = true;
