-- ============================================================
-- Migration 023: Add ICD columns to intraday_snapshots
--
-- Mirrors the EOD columns added to daily_scrape_data in migration 019,
-- but at the hourly snapshot level so the RpaPacer UI can pace agents
-- against the 300 RPA min/day target intraday (not just at end of day).
--
-- These three columns are populated by the hourly ICD scraper feed
-- (n8n: dsb-icd-billable-leads, mode = "icd_intraday"). The CRM scraper
-- writes its own columns (total_dials, talk_time_minutes, ib/ob/etc.)
-- under the same (scrape_date, scrape_hour, agent_name) primary key.
-- The icd_intraday ingest path is a SELECT-merge-UPSERT that touches
-- only these three columns so the two scrapers don't clobber each other.
--
-- Defaults to 0 so:
--   - existing rows are unaffected,
--   - any RPA math reads NULL-safe values when the ICD scrape hasn't
--     landed yet for the current hour.
-- ============================================================

ALTER TABLE intraday_snapshots
  ADD COLUMN IF NOT EXISTS queue_minutes        DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_talk_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_wait_minutes     DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN intraday_snapshots.queue_minutes IS
  'ICD: cumulative Time Spent In Queue (minutes) up to scrape_hour. Component of intraday RPAs.';

COMMENT ON COLUMN intraday_snapshots.inbound_talk_minutes IS
  'ICD: cumulative inbound Talk Time (minutes) up to scrape_hour. Distinct from talk_time_minutes (CRM = pure outbound talk).';

COMMENT ON COLUMN intraday_snapshots.avg_wait_minutes IS
  'ICD: average inbound wait time per call (minutes) at the snapshot point. Operational signal for queue health, not summed into RPAs.';
