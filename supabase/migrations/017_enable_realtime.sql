-- ============================================================================
-- Migration 017: Enable Supabase Realtime on dashboard-driving tables
-- ============================================================================
--
-- Why:
--   The DataContext now subscribes to postgres_changes on every table that
--   feeds an on-screen panel. Without each table being a member of the
--   `supabase_realtime` publication, the subscription "succeeds" but no
--   events ever arrive — silent failure.
--
-- What this does:
--   ALTER PUBLICATION supabase_realtime ADD TABLE <table>; for every table
--   the frontend listens to. Idempotent — wrapped in DO blocks that no-op
--   if the table is already in the publication.
--
-- Tables added (and the React refresh they trigger):
--   daily_scrape_data         → refreshDaily + refreshPipeline
--   intraday_snapshots        → refreshDaily
--   leads_pool_daily_data     → refreshDaily + refreshPipeline
--   pipeline_compliance_daily → refreshPipeline
--   agent_performance_daily   → refreshPipeline
--   agents                    → refreshDaily + refreshPipeline
--   daily_marketing_summary   → refreshPipeline
--
-- Safe to run multiple times.
-- ============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'daily_scrape_data',
    'intraday_snapshots',
    'leads_pool_daily_data',
    'pipeline_compliance_daily',
    'agent_performance_daily',
    'agents',
    'daily_marketing_summary'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip silently if the table isn't in the public schema yet (some installs
    -- run migrations out of order). Skip silently if it's already published.
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Added % to supabase_realtime publication', t;
    ELSE
      RAISE NOTICE 'Skipped % (missing or already published)', t;
    END IF;
  END LOOP;
END$$;

-- Verify membership — these should all return one row each post-migration.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN (
    'daily_scrape_data',
    'intraday_snapshots',
    'leads_pool_daily_data',
    'pipeline_compliance_daily',
    'agent_performance_daily',
    'agents',
    'daily_marketing_summary'
  )
ORDER BY tablename;
