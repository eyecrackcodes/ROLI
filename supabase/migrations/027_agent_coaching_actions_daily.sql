-- ============================================================
-- Migration 027: agent_coaching_actions_daily
--
-- Single derived view that emits ONE coaching action per agent per day.
-- The point: coaches shouldn't have to triangulate sales + dials + talk
-- + pipeline + pool to figure out what to coach. The view does that and
-- emits a single action label + rationale.
--
-- Action precedence (highest priority wins):
--
--   1. clear_pipeline   past_due > 3
--                       Pipeline backlog is blocking new lead routing
--                       and burning trust with leads. Hygiene before
--                       activity, every time.
--
--   2. get_on_phones    rpa_band IN ('short','light') AND queue_minutes < 60
--                       Effort problem. Don't waste a sales coaching
--                       session — start with attendance and queue-ready.
--
--   3. coach_close      rpa_band IN ('strong','on_floor')
--                       AND total_sales = 0
--                       AND leads_worked >= 5
--                       Skill problem. They put in the work, the work
--                       didn't convert. Pull a presentation recording.
--
--   4. audit_calls      total_sales >= 1
--                       AND rpa_band IN ('short','light')
--                       They closed on minimal volume — either teachable
--                       efficiency or unsustainable luck. Audit calls.
--
--   5. stay_course      rpa_band IN ('strong','on_floor')
--                       AND total_sales >= 1
--                       Star quadrant. Replicate, don't fix.
--
--   6. build_the_day    has_activity AND nothing above matched
--                       Mid-day or partial-effort agent who's on the
--                       floor but no sale yet. Don't coach; let the day
--                       finish, then re-evaluate.
--
--   no_data             Default — agent has zero activity (didn't work
--                       / not on roster).
--
-- One row per (scrape_date, agent_name) pulled from agent_rpas_daily as
-- the spine. Pipeline, sales, and premium come from joined source tables.
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW agent_coaching_actions_daily AS
WITH input AS (
  SELECT
    r.scrape_date,
    r.agent_name,
    r.tier,
    r.rpa_minutes,
    r.rpa_band,
    r.queue_minutes,
    r.outbound_talk_minutes,
    r.inbound_talk_minutes,
    r.outbound_dials,
    r.outbound_dial_overhead_minutes,
    r.contact_pct,
    r.contacts_made,
    r.leads_worked,
    r.conversations,
    r.presentations,
    COALESCE(d.ib_sales, 0) + COALESCE(d.ob_sales, 0) + COALESCE(d.custom_sales, 0)        AS total_sales,
    COALESCE(d.ib_premium, 0) + COALESCE(d.ob_premium, 0) + COALESCE(d.custom_premium, 0)  AS total_premium,
    COALESCE(d.ib_leads_delivered, 0) + COALESCE(d.ob_leads_delivered, 0) + COALESCE(d.custom_leads, 0) AS total_leads,
    COALESCE(pc.past_due_follow_ups, 0) AS past_due,
    COALESCE(pc.todays_follow_ups, 0)   AS todays_fu,
    COALESCE(pc.new_leads, 0)           AS untouched,
    COALESCE(pc.call_queue_count, 0)    AS call_queue,
    COALESCE(pc.total_stale, 0)         AS actionable_leads,
    r.dial_overhead_source,
    (r.rpa_minutes + r.queue_minutes + r.inbound_talk_minutes + r.outbound_talk_minutes) > 0 AS has_activity
  FROM agent_rpas_daily r
  LEFT JOIN daily_scrape_data d
         ON d.scrape_date = r.scrape_date
        AND d.agent_name  = r.agent_name
  LEFT JOIN pipeline_compliance_daily pc
         ON pc.scrape_date = r.scrape_date
        AND pc.agent_name  = r.agent_name
)
SELECT
  i.scrape_date,
  i.agent_name,
  i.tier,
  i.rpa_minutes,
  i.rpa_band,
  i.total_sales,
  i.total_premium,
  i.total_leads,
  i.contact_pct,
  i.leads_worked,
  i.past_due,
  i.todays_fu,
  i.untouched,
  i.call_queue,
  i.actionable_leads,
  i.dial_overhead_source,

  CASE
    WHEN i.past_due > 3                                                            THEN 'clear_pipeline'
    WHEN i.rpa_band IN ('short','light') AND i.queue_minutes < 60                  THEN 'get_on_phones'
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales = 0
         AND i.leads_worked >= 5                                                   THEN 'coach_close'
    WHEN i.total_sales >= 1 AND i.rpa_band IN ('short','light')                    THEN 'audit_calls'
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales >= 1                THEN 'stay_course'
    WHEN i.has_activity                                                            THEN 'build_the_day'
    ELSE 'no_data'
  END                                                                              AS action_code,

  CASE
    WHEN i.past_due > 3                                                            THEN 'Clear the pipeline'
    WHEN i.rpa_band IN ('short','light') AND i.queue_minutes < 60                  THEN 'Get on the phones'
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales = 0
         AND i.leads_worked >= 5                                                   THEN 'Coach the close'
    WHEN i.total_sales >= 1 AND i.rpa_band IN ('short','light')                    THEN 'Audit the calls'
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales >= 1                THEN 'Stay the course'
    WHEN i.has_activity                                                            THEN 'Build the day'
    ELSE 'No data yet'
  END                                                                              AS action_label,

  CASE
    WHEN i.past_due > 3                                                            THEN 1
    WHEN i.rpa_band IN ('short','light') AND i.queue_minutes < 60                  THEN 2
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales = 0
         AND i.leads_worked >= 5                                                   THEN 3
    WHEN i.total_sales >= 1 AND i.rpa_band IN ('short','light')                    THEN 4
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales >= 1                THEN 5
    WHEN i.has_activity                                                            THEN 6
    ELSE 9
  END                                                                              AS action_priority,

  CASE
    WHEN i.past_due > 3
      THEN 'Past due is ' || i.past_due || '. Pipeline is blocking new lead routing — work backlog before any new activity.'
    WHEN i.rpa_band IN ('short','light') AND i.queue_minutes < 60
      THEN 'RPA is ' || ROUND(i.rpa_minutes)::text || ' min with only ' || ROUND(i.queue_minutes)::text || ' min queue-ready. Effort problem — start with attendance and queue discipline.'
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales = 0
         AND i.leads_worked >= 5
      THEN 'Worked ' || i.leads_worked || ' leads, ' || ROUND(i.rpa_minutes)::text || ' RPA min, zero sales. Skill problem — pull a presentation recording.'
    WHEN i.total_sales >= 1 AND i.rpa_band IN ('short','light')
      THEN i.total_sales || ' sale(s) on only ' || ROUND(i.rpa_minutes)::text || ' RPA min. Audit calls — efficient or just lucky?'
    WHEN i.rpa_band IN ('strong','on_floor') AND i.total_sales >= 1
      THEN i.total_sales || ' sale(s) on ' || ROUND(i.rpa_minutes)::text || ' RPA min. Replicate.'
    WHEN i.has_activity
      THEN 'On track at ' || ROUND(i.rpa_minutes)::text || ' RPA min. Mid-day pace — revisit at end of day.'
    ELSE 'No daily scrape data yet.'
  END                                                                              AS action_rationale
FROM input i;

ALTER VIEW agent_coaching_actions_daily SET (security_invoker = true);

COMMENT ON VIEW agent_coaching_actions_daily IS
  'One coaching action per agent per day. Resolves the activity-vs-production-vs-pipeline triangulation into a single action_code (clear_pipeline/get_on_phones/coach_close/audit_calls/stay_course). Highest-priority condition wins. Sort by action_priority ASC, then by total_premium DESC for the daily coaching queue.';

COMMIT;
