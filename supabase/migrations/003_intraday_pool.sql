-- ============================================================
-- Migration 003: Add pool columns to intraday_snapshots
-- Captures hourly Leads Pool progression alongside CRM data.
-- Defaults to 0 so existing rows are unaffected.
-- ============================================================

ALTER TABLE intraday_snapshots
  ADD COLUMN pool_dials INTEGER DEFAULT 0,
  ADD COLUMN pool_talk_minutes DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN pool_answered INTEGER DEFAULT 0,
  ADD COLUMN pool_long_calls INTEGER DEFAULT 0,
  ADD COLUMN pool_self_assigned INTEGER DEFAULT 0,
  ADD COLUMN pool_contact_rate DECIMAL(5,2) DEFAULT 0;
