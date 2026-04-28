-- ============================================================
-- Migration 026: agent_rpas_daily — additive dial overhead
--
-- Migration 025 used a hard REPLACE: when ANY Dialpad ring time existed,
-- it threw away the total_dials × 0.5 inference. That assumed Dialpad
-- saw all outbound calls. In production we observed Dialpad sees only
-- 2-9% of CRM dials for most agents (the CRM dialer routes through a
-- different trunking provider). The REPLACE branch then collapsed
-- dial overhead to near-zero on the day Dialpad came online — e.g.
-- AD Hutton went from 18.0 min (36 CRM dials × 0.5) to 0.10 min just
-- because Dialpad recorded 2 short rings.
--
-- This migration switches to ADDITIVE:
--
--   dial_overhead = dialpad_dial_minutes
--                 + GREATEST(total_dials − dialpad_outbound_calls, 0) × 0.5
--
-- That is: real ring time for the calls Dialpad actually recorded, plus
-- the 0.5/dial inference for the remaining CRM-dialer dials. No double
-- counting because we subtract the Dialpad-routed call count from the
-- CRM dial count before applying the inference.
--
-- dial_overhead_source becomes a tri-state:
--   'dialpad'   — all CRM dials are accounted for by Dialpad rows
--   'hybrid'    — some Dialpad ring time, some CRM-only dials
--   'inference' — no Dialpad ring time at all
--
-- Talk-time inputs (queue, inbound_talk, outbound_talk) are unchanged —
-- still use CRM/ICD as authoritative. Dialpad talk numbers stay in the
-- cross-check columns at the end of the view, never added to RPA.
--
-- IMPORTANT: CREATE OR REPLACE VIEW preserves column order and names.
-- Only expressions for outbound_dial_overhead_minutes / rpa_minutes /
-- rpa_band / dial_overhead_source change. No new columns.
-- security_invoker = true is re-applied defensively.
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW agent_rpas_daily AS
WITH base AS (
  SELECT
    d.*,
    GREATEST(
      COALESCE(d.total_dials, 0) - COALESCE(d.dialpad_outbound_calls, 0),
      0
    ) AS crm_only_dials
  FROM daily_scrape_data d
)
SELECT
  d.scrape_date,
  d.agent_name,
  d.tier,
  d.queue_minutes,
  d.inbound_talk_minutes,
  d.talk_time_minutes                                  AS outbound_talk_minutes,
  d.total_dials                                        AS outbound_dials,

  -- Additive: real Dialpad ring time + 0.5/dial inference for CRM-only dials.
  ROUND(
    (
      COALESCE(d.dialpad_dial_minutes, 0)
      + (d.crm_only_dials * 0.5)
    )::numeric,
    2
  )                                                    AS outbound_dial_overhead_minutes,

  ROUND(
    (
        d.queue_minutes
      + d.inbound_talk_minutes
      + d.talk_time_minutes
      + COALESCE(d.dialpad_dial_minutes, 0)
      + (d.crm_only_dials * 0.5)
    )::numeric,
    2
  )                                                    AS rpa_minutes,

  CASE
    WHEN (
      d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes
      + COALESCE(d.dialpad_dial_minutes, 0) + (d.crm_only_dials * 0.5)
    ) >= 360 THEN 'strong'
    WHEN (
      d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes
      + COALESCE(d.dialpad_dial_minutes, 0) + (d.crm_only_dials * 0.5)
    ) >= 300 THEN 'on_floor'
    WHEN (
      d.queue_minutes + d.inbound_talk_minutes + d.talk_time_minutes
      + COALESCE(d.dialpad_dial_minutes, 0) + (d.crm_only_dials * 0.5)
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

  -- dial_overhead_source goes from 2-state to 3-state.
  -- 'dialpad'   = no remaining CRM-only dials (Dialpad covered everything).
  -- 'hybrid'    = some Dialpad coverage + some CRM-only dials (the typical case).
  -- 'inference' = no Dialpad ring at all (pre-Dialpad days, or Dialpad scrape failed).
  CASE
    WHEN COALESCE(d.dialpad_dial_minutes, 0) > 0.01 AND d.crm_only_dials = 0 THEN 'dialpad'
    WHEN COALESCE(d.dialpad_dial_minutes, 0) > 0.01 AND d.crm_only_dials > 0 THEN 'hybrid'
    ELSE 'inference'
  END                                                  AS dial_overhead_source,
  d.dialpad_inbound_calls,
  d.dialpad_outbound_calls,
  d.dialpad_inbound_talk_minutes,
  d.dialpad_outbound_talk_minutes,
  d.dialpad_dial_minutes
FROM base d
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
  'Daily Revenue Producing Activity rollup per agent. RPA = queue + inbound talk + outbound talk + outbound dial overhead. Dial overhead is ADDITIVE: dialpad_dial_minutes (real ring time on Dialpad-routed calls) + 0.5 min × (total_dials - dialpad_outbound_calls) for the remaining CRM-dialer-only dials. dial_overhead_source reports dialpad/hybrid/inference.';

COMMIT;
