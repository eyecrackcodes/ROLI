-- agent_rpas_daily view.
-- Computes daily Revenue Producing Activity minutes (RPAs) per agent.
--
-- RPA formula (per docs/sops/Agent-Activity-SOP.md):
--
--   Daily RPAs =
--       queue_minutes              [ICD — logged in & available]
--     + inbound_talk_minutes       [ICD — talk on inbound calls]
--     + outbound_talk_minutes      [CRM Calls Report — talk on outbound]
--     + (outbound_dials × 0.5 min) [CRM Calls Report — ring/connect overhead]
--
-- The CRM Calls Report is purely OUTBOUND and the ICD report is purely
-- INBOUND, so the four components are additive (no double-counting).
--
-- Quality markers (joined from agent_performance_daily and
-- leads_pool_daily_data) are surfaced alongside the RPA total but do NOT
-- enter the formula — they are read-only coaching signals.
--
-- Backward compatibility:
--   - This is a new view. No existing query references it; nothing breaks.
--   - View can be dropped/recreated without touching base tables.
--   - All inputs default to 0 if rows are missing on either side.

BEGIN;

CREATE OR REPLACE VIEW agent_rpas_daily AS
SELECT
  d.scrape_date,
  d.agent_name,
  d.tier,

  -- RPA components (the 300-min/day floor is computed from these)
  d.queue_minutes,
  d.inbound_talk_minutes,
  d.talk_time_minutes                                  AS outbound_talk_minutes,
  d.total_dials                                        AS outbound_dials,
  ROUND((d.total_dials * 0.5)::numeric, 2)             AS outbound_dial_overhead_minutes,

  -- the single RPA number
  ROUND(
    (
        d.queue_minutes
      + d.inbound_talk_minutes
      + d.talk_time_minutes
      + (d.total_dials * 0.5)
    )::numeric,
    2
  )                                                    AS rpa_minutes,

  -- health band (string for dashboard rendering)
  CASE
    WHEN (d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes + d.total_dials * 0.5) >= 360 THEN 'strong'
    WHEN (d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes + d.total_dials * 0.5) >= 300 THEN 'on_floor'
    WHEN (d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes + d.total_dials * 0.5) >= 240 THEN 'light'
    ELSE 'short'
  END                                                  AS rpa_band,

  -- operational signal (not in RPA total)
  d.avg_wait_minutes,

  -- quality markers from CRM Daily Agent Performance Report
  COALESCE(p.conversations,  0)                        AS conversations,
  COALESCE(p.presentations,  0)                        AS presentations,
  COALESCE(p.contacts_made,  0)                        AS contacts_made,
  COALESCE(p.leads_worked,   0)                        AS leads_worked,
  CASE
    WHEN COALESCE(p.leads_worked, 0) > 0
    THEN ROUND((p.contacts_made::numeric / p.leads_worked::numeric) * 100, 2)
    ELSE 0
  END                                                  AS contact_pct,

  -- quality marker from CRM Pool Report
  COALESCE(pool.long_calls, 0)                         AS pool_long_calls

FROM daily_scrape_data d
LEFT JOIN agent_performance_daily p
       ON p.scrape_date = d.scrape_date
      AND p.agent_name  = d.agent_name
      AND p.scrape_hour IS NULL          -- daily aggregate row only, not hourly
LEFT JOIN leads_pool_daily_data pool
       ON pool.scrape_date = d.scrape_date
      AND pool.agent_name  = d.agent_name;
-- NOTE: scrape_hour IS NULL filter is broken in practice — see migration 021.
-- agent_performance_daily currently only writes hourly snapshots, so this
-- join returns NULL for every quality marker. Migration 021 swaps in a
-- LATERAL "latest snapshot" lookup that handles both cases.

COMMENT ON VIEW agent_rpas_daily IS
  'Daily Revenue Producing Activity rollup per agent. RPA = queue + inbound talk + outbound talk + outbound dial overhead (4 additive sources, no double-counting). See docs/sops/Agent-Activity-SOP.md.';

COMMIT;
