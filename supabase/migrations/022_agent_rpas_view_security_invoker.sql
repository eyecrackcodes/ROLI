-- Postgres views default to SECURITY DEFINER, which the Supabase security
-- advisor flags as ERROR (lint 0010). Switch agent_rpas_daily to
-- security_invoker = true so RLS on the underlying tables is enforced
-- using the querying user's role rather than the view creator's. The
-- underlying tables (daily_scrape_data, agent_performance_daily,
-- leads_pool_daily_data) all have permissive 'USING (true)' policies for
-- anon and authenticated, so dashboard reads behave identically -- this is
-- a pure correctness/audit fix, not a behavior change.

ALTER VIEW agent_rpas_daily SET (security_invoker = true);
