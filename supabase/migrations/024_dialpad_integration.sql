-- ============================================================
-- Migration 024: Dialpad integration
--
-- Wires real per-call Dialpad data into the RPA pipeline. Today the
-- "outbound dial overhead" component of RPAs is inferred as
-- total_dials × 0.5 minutes (a heuristic). Dialpad gives us the actual
-- ring time per call, so we can replace the inference with real numbers
-- once Dialpad data is present, while keeping the existing CRM Calls
-- Report and ICD reports as the primary sources of truth (per scope:
-- "supplement, not replace").
--
-- What this migration adds:
--
--   1. agents.dialpad_user_id           — int8, optional, mapping to
--                                         Dialpad user id for fast lookup.
--   2. dialpad_calls                    — raw per-call audit table. One
--                                         row per Dialpad call with
--                                         direction, talk seconds, ring
--                                         seconds, target info.
--                                         90-day retention is the default
--                                         operating expectation but no
--                                         hard cleanup is wired here —
--                                         the daily ETL can prune later.
--   3. daily_scrape_data + intraday_snapshots
--      Aggregate columns (per agent per day / per hour):
--        - dialpad_inbound_calls
--        - dialpad_outbound_calls
--        - dialpad_inbound_talk_minutes
--        - dialpad_outbound_talk_minutes
--        - dialpad_dial_minutes  (sum of ring seconds on outbound,
--                                 i.e. real "dial overhead")
--
-- All new columns default to 0/NULL so existing rows are unaffected and
-- existing queries continue to work unchanged.
--
-- The agent_rpas_daily view is rewritten in migration 025 to prefer
-- dialpad_dial_minutes when populated and fall back to the 0.5/dial
-- inference when Dialpad data hasn't arrived for that day yet.
-- ============================================================

BEGIN;

-- 1. agents.dialpad_user_id
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS dialpad_user_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS agents_dialpad_user_id_unique
  ON agents (dialpad_user_id)
  WHERE dialpad_user_id IS NOT NULL;

COMMENT ON COLUMN agents.dialpad_user_id IS
  'Dialpad user id for the agent. Used by ingest-dialpad-calls to map per-call rows to canonical agent_name without fuzzy matching.';

-- 2. dialpad_calls raw audit table
CREATE TABLE IF NOT EXISTS dialpad_calls (
  id                 BIGSERIAL PRIMARY KEY,
  call_id            TEXT NOT NULL,
  master_call_id     TEXT,
  dialpad_user_id    BIGINT NOT NULL,
  agent_name         TEXT NOT NULL,
  direction          TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  scrape_date        DATE NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL,
  ended_at           TIMESTAMPTZ,
  talk_seconds       INTEGER NOT NULL DEFAULT 0,
  ring_seconds       INTEGER NOT NULL DEFAULT 0,
  total_seconds      INTEGER NOT NULL DEFAULT 0,
  was_recorded       BOOLEAN,
  disposition        TEXT,
  target_type        TEXT,
  target_name        TEXT,
  external_number    TEXT,
  raw                JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dialpad_calls_call_id_unique UNIQUE (call_id)
);

CREATE INDEX IF NOT EXISTS dialpad_calls_date_agent_idx
  ON dialpad_calls (scrape_date, agent_name);

CREATE INDEX IF NOT EXISTS dialpad_calls_user_started_idx
  ON dialpad_calls (dialpad_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS dialpad_calls_direction_idx
  ON dialpad_calls (scrape_date, direction);

COMMENT ON TABLE dialpad_calls IS
  'Raw per-call rows from Dialpad Stats API (export_type=records). One row per master_call_id leg attributed to an agent. Source of truth for Dialpad-derived RPA aggregates and call-level audit.';

COMMENT ON COLUMN dialpad_calls.talk_seconds IS
  'Connected talk time in seconds. Source of dialpad_*_talk_minutes aggregates.';

COMMENT ON COLUMN dialpad_calls.ring_seconds IS
  'Time spent ringing before connect (or until abandon). On outbound calls this is the real "dial overhead" we previously inferred as 0.5 min/dial.';

COMMENT ON COLUMN dialpad_calls.scrape_date IS
  'CST date the call started. Stamped at ingest time for fast date-range filtering without re-deriving from started_at.';

-- RLS: SELECT-only policy for anon/authenticated. The edge function
-- writes via SUPABASE_SERVICE_ROLE_KEY which bypasses RLS, so no
-- INSERT/UPDATE/DELETE policies are needed. This matches the pattern
-- used by the rest of the data plane and avoids the
-- rls_policy_always_true lint (0024).
ALTER TABLE dialpad_calls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dialpad_calls' AND policyname = 'dialpad_calls_read'
  ) THEN
    CREATE POLICY dialpad_calls_read ON dialpad_calls FOR SELECT USING (true);
  END IF;
END $$;

-- 3. Aggregate columns on daily_scrape_data
ALTER TABLE daily_scrape_data
  ADD COLUMN IF NOT EXISTS dialpad_inbound_calls         INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_outbound_calls        INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_inbound_talk_minutes  DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_outbound_talk_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_dial_minutes          DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_scrape_data.dialpad_dial_minutes IS
  'Sum of ring_seconds on outbound Dialpad calls, in minutes. Real measured dial overhead. agent_rpas_daily prefers this over the 0.5 min/dial inference when > 0.';

COMMENT ON COLUMN daily_scrape_data.dialpad_inbound_talk_minutes IS
  'Cross-check column: Dialpad-measured inbound talk time. Authoritative inbound talk lives in inbound_talk_minutes (ICD).';

COMMENT ON COLUMN daily_scrape_data.dialpad_outbound_talk_minutes IS
  'Cross-check column: Dialpad-measured outbound talk time. Authoritative outbound talk lives in talk_time_minutes (CRM).';

-- 4. Aggregate columns on intraday_snapshots
ALTER TABLE intraday_snapshots
  ADD COLUMN IF NOT EXISTS dialpad_inbound_calls         INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_outbound_calls        INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_inbound_talk_minutes  DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_outbound_talk_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dialpad_dial_minutes          DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN intraday_snapshots.dialpad_dial_minutes IS
  'Cumulative ring-seconds-as-minutes for outbound Dialpad calls up to scrape_hour. Replaces 0.5/dial inference in RPA pacing when populated.';

COMMIT;
