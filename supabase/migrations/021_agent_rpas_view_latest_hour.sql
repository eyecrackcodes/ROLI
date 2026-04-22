-- Fix: agent_performance_daily stores cumulative HOURLY snapshots, never a
-- scrape_hour=NULL daily aggregate row. The original 020 view filtered for
-- IS NULL and returned zeros for every quality marker. This rewrite uses a
-- LATERAL subquery to pick the latest available row per (scrape_date,
-- agent_name): a NULL-hour row if it ever exists (per the schema's design
-- intent), otherwise the highest scrape_hour, which equals the running
-- cumulative total at end-of-day.
--
-- Backward compatibility:
--   - CREATE OR REPLACE VIEW preserves the view's name and columns; nothing
--     downstream needs to change.
--   - Column list is identical to migration 020.

BEGIN;

CREATE OR REPLACE VIEW agent_rpas_daily AS
SELECT
  d.scrape_date,
  d.agent_name,
  d.tier,
  d.queue_minutes,
  d.inbound_talk_minutes,
  d.talk_time_minutes                                  AS outbound_talk_minutes,
  d.total_dials                                        AS outbound_dials,
  ROUND((d.total_dials * 0.5)::numeric, 2)             AS outbound_dial_overhead_minutes,
  ROUND(
    (
        d.queue_minutes
      + d.inbound_talk_minutes
      + d.talk_time_minutes
      + (d.total_dials * 0.5)
    )::numeric,
    2
  )                                                    AS rpa_minutes,
  CASE
    WHEN (d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes + d.total_dials * 0.5) >= 360 THEN 'strong'
    WHEN (d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes + d.total_dials * 0.5) >= 300 THEN 'on_floor'
    WHEN (d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes + d.total_dials * 0.5) >= 240 THEN 'light'
    ELSE 'short'
  END                                                  AS rpa_band,
  d.avg_wait_minutes,
  COALESCE(p.conversations,  0)                        AS conversations,
  COALESCE(p.presentations,  0)                        AS presentations,
  COALESCE(p.contacts_made,  0)                        AS contacts_made,
  COALESCE(p.leads_worked,   0)                        AS leads_worked,
  CASE
    WHEN COALESCE(p.leads_worked, 0) > 0
    THEN ROUND((p.contacts_made::numeric / p.leads_worked::numeric) * 100, 2)
    ELSE 0
  END                                                  AS contact_pct,
  COALESCE(pool.long_calls, 0)                         AS pool_long_calls
FROM daily_scrape_data d
LEFT JOIN LATERAL (
  SELECT conversations, presentations, contacts_made, leads_worked
  FROM agent_performance_daily ap
  WHERE ap.scrape_date = d.scrape_date
    AND ap.agent_name  = d.agent_name
  ORDER BY (ap.scrape_hour IS NOT NULL) ASC, ap.scrape_hour DESC NULLS LAST
  LIMIT 1
) p ON TRUE
LEFT JOIN leads_pool_daily_data pool
       ON pool.scrape_date = d.scrape_date
      AND pool.agent_name  = d.agent_name;

COMMENT ON VIEW agent_rpas_daily IS
  'Daily Revenue Producing Activity rollup per agent. RPA = queue + inbound talk + outbound talk + outbound dial overhead (4 additive sources, no double-counting). Quality markers pulled from the latest agent_performance_daily snapshot per agent per day (cumulative hourly snapshots; NULL-hour aggregate preferred if present). See docs/sops/Agent-Activity-SOP.md.';

COMMIT;

-- NOTE: SECURITY DEFINER vs INVOKER fix applied separately in 022.
