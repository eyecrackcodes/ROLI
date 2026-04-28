-- ============================================================
-- Migration 025: agent_rpas_daily — prefer real Dialpad dial-time
--
-- Migration 021 defined the view with outbound_dial_overhead computed
-- as `total_dials × 0.5 minutes`. That was a stopgap because we had no
-- per-call dial duration source.
--
-- Migration 024 added dialpad_dial_minutes (sum of outbound ring seconds
-- in minutes) on both daily_scrape_data and intraday_snapshots, written
-- by the new ingest-dialpad-calls edge function once Dialpad is wired.
--
-- This migration replaces the inference branch with a COALESCE that
-- prefers the real number when it's > 0 and falls back to the 0.5/dial
-- inference otherwise. The fallback is critical — if the Dialpad scrape
-- hasn't run yet for the current hour or fails, RPA pacing must keep
-- producing reasonable numbers from CRM dial counts alone.
--
-- IMPORTANT: Postgres CREATE OR REPLACE VIEW does NOT allow column
-- reordering or renaming — only changing expressions in existing
-- positions and APPENDING new columns at the end. The first 17 columns
-- below match migration 021 exactly (same names, same order); only the
-- expressions for outbound_dial_overhead_minutes / rpa_minutes / rpa_band
-- changed. New Dialpad cross-check columns are appended after
-- pool_long_calls.
--
-- security_invoker = true is preserved (set in 022) and re-applied here
-- defensively in case CREATE OR REPLACE drops it on some PG versions.
-- ============================================================

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

  -- Real dial overhead from Dialpad if we have any, else inference.
  -- Threshold is 0.01 (basically any non-zero) so a no-data day from
  -- Dialpad doesn't accidentally zero out an agent's RPAs.
  ROUND(
    CASE
      WHEN COALESCE(d.dialpad_dial_minutes, 0) > 0.01
        THEN d.dialpad_dial_minutes
      ELSE (d.total_dials * 0.5)
    END::numeric,
    2
  )                                                    AS outbound_dial_overhead_minutes,

  ROUND(
    (
        d.queue_minutes
      + d.inbound_talk_minutes
      + d.talk_time_minutes
      + CASE
          WHEN COALESCE(d.dialpad_dial_minutes, 0) > 0.01
            THEN d.dialpad_dial_minutes
          ELSE (d.total_dials * 0.5)
        END
    )::numeric,
    2
  )                                                    AS rpa_minutes,

  CASE
    WHEN (
      d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes
      + CASE WHEN COALESCE(d.dialpad_dial_minutes,0) > 0.01 THEN d.dialpad_dial_minutes ELSE d.total_dials * 0.5 END
    ) >= 360 THEN 'strong'
    WHEN (
      d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes
      + CASE WHEN COALESCE(d.dialpad_dial_minutes,0) > 0.01 THEN d.dialpad_dial_minutes ELSE d.total_dials * 0.5 END
    ) >= 300 THEN 'on_floor'
    WHEN (
      d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes
      + CASE WHEN COALESCE(d.dialpad_dial_minutes,0) > 0.01 THEN d.dialpad_dial_minutes ELSE d.total_dials * 0.5 END
    ) >= 240 THEN 'light'
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
  COALESCE(pool.long_calls, 0)                         AS pool_long_calls,

  -- Appended columns (new in 025).
  -- dial_overhead_source lets the UI show "Live (Dialpad)" vs
  -- "Estimated (CRM)" badges so coaches know which RPAs are real.
  CASE
    WHEN COALESCE(d.dialpad_dial_minutes, 0) > 0.01 THEN 'dialpad'
    ELSE 'inference'
  END                                                  AS dial_overhead_source,
  d.dialpad_inbound_calls,
  d.dialpad_outbound_calls,
  d.dialpad_inbound_talk_minutes,
  d.dialpad_outbound_talk_minutes,
  d.dialpad_dial_minutes
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

ALTER VIEW agent_rpas_daily SET (security_invoker = true);

COMMENT ON VIEW agent_rpas_daily IS
  'Daily Revenue Producing Activity rollup per agent. RPA = queue + inbound talk + outbound talk + outbound dial overhead. Dial overhead prefers real Dialpad ring-seconds (dialpad_dial_minutes) when present, falls back to total_dials * 0.5 inference otherwise. dial_overhead_source column reports which branch fired.';

COMMIT;
