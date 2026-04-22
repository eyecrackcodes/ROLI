-- Agent dialer activity (RPA components).
-- Adds the three ICD-sourced activity fields needed to compute daily
-- Revenue Producing Activity minutes (RPAs):
--
--   queue_minutes         — Time Spent In Queue (logged in & available)
--   inbound_talk_minutes  — Total Talk Time on inbound calls (ICD source)
--   avg_wait_minutes      — Average inbound wait time (operational signal)
--
-- These three columns were already being scraped from the ICD report by
-- the dsb-icd-scraper Apify actor but were not being persisted by the
-- ingest-daily-scrape edge function in `ib_leads_only` mode. This
-- migration creates the storage; ingest patch + n8n patch will start
-- populating them on the next ICD run.
--
-- Backward compatibility:
--   - All three columns default to 0, so existing rows are auto-filled.
--   - No existing query references these names; nothing breaks.
--   - Queries that ignored these columns continue to ignore them.
--
-- Companion: migration 020 creates `agent_rpas_daily` view that rolls
-- these up alongside the CRM-sourced `talk_time_minutes` (outbound) and
-- `total_dials` (outbound) into a single RPA total.

BEGIN;

ALTER TABLE daily_scrape_data
  ADD COLUMN IF NOT EXISTS queue_minutes        DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_talk_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_wait_minutes     DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_scrape_data.queue_minutes IS
  'ICD: Time Spent In Queue (minutes logged in and available for inbound). Component of daily RPAs.';

COMMENT ON COLUMN daily_scrape_data.inbound_talk_minutes IS
  'ICD: Total Talk Time on inbound calls (minutes). Distinct from talk_time_minutes which is CRM Calls Report = pure outbound talk.';

COMMENT ON COLUMN daily_scrape_data.avg_wait_minutes IS
  'ICD: Average inbound wait time per call (minutes). Operational signal for queue health, not summed into RPAs.';

COMMENT ON COLUMN daily_scrape_data.talk_time_minutes IS
  'CRM Calls Report: Total OUTBOUND talk time (minutes). Cadence + pool + follow-ups + manual outbound combined. Inbound talk lives in inbound_talk_minutes.';

COMMIT;
