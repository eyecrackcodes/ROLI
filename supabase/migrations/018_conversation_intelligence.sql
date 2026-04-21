-- Attention AI conversation intelligence tables.
-- Stores per-call analysis from Attention.com (scorecards, talk ratio,
-- sentiment, objection handling) and pre-aggregated weekly coaching themes.
-- The ingestion pipeline (n8n → ingest-attention edge function) writes
-- conversation_intelligence; a nightly rollup derives coaching_themes_weekly.

BEGIN;

-- ================================================================
-- conversation_intelligence: one row per Attention-analyzed call
-- ================================================================

CREATE TABLE conversation_intelligence (
  attention_uuid  text PRIMARY KEY,
  agent_id        uuid REFERENCES agents(id),
  call_date       date NOT NULL,
  call_started_at timestamptz NOT NULL,
  duration_seconds int NOT NULL,
  call_label      text,                    -- 'Inbound Lead' | 'Pool Follow-up' | etc
  outcome         text,                    -- 'sale' | 'callback_set' | 'lost' | 'no_decision'
  scorecard_name  text,                    -- which scorecard template was applied
  scorecard_total_score numeric,           -- 0-100
  scorecard_breakdown   jsonb,             -- per-item scores { "discovery": 80, "qualifying": 60, ... }
  talk_ratio            numeric,           -- 0-1, agent's share of talk time
  longest_monologue_sec int,               -- agent's longest uninterrupted stretch
  sentiment_overall     numeric,           -- -1 to 1
  first_objection_type  text,              -- e.g. 'cost', 'think_about_it', 'spouse'
  first_objection_at_seconds int,
  recovered_after_objection  bool,
  clip_url        text,                    -- Attention snippet URL for the full call
  transcript_summary text,                 -- 1-3 sentence AI summary
  ai_themes       text[],                  -- e.g. ['skipped_discovery','price_stall']
  raw_payload     jsonb,                   -- full Attention API response for debugging
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ci_agent_date ON conversation_intelligence (agent_id, call_date DESC);
CREATE INDEX idx_ci_call_date  ON conversation_intelligence (call_date DESC);
CREATE INDEX idx_ci_label      ON conversation_intelligence (call_label) WHERE call_label IS NOT NULL;

COMMENT ON TABLE conversation_intelligence IS
  'Per-call analysis from Attention.com. Ingested by the dsb-attention-sync n8n workflow via the ingest-attention edge function.';

-- ================================================================
-- coaching_themes_weekly: max 3 surfaced per agent per week
-- ================================================================

CREATE TABLE coaching_themes_weekly (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid REFERENCES agents(id) NOT NULL,
  week_start_date date NOT NULL,              -- Monday of the week
  theme_key       text NOT NULL,              -- enum key from conversationIntelligence.ts
  theme_label     text NOT NULL,              -- human-readable label
  tier            int NOT NULL,               -- 1=process, 2=behavioral, 3=strategic
  severity        text NOT NULL DEFAULT 'med', -- 'low' | 'med' | 'high'
  evidence_call_uuids text[] NOT NULL DEFAULT '{}', -- attention_uuids of supporting calls
  suggested_action    text,
  benchmark_value     numeric,                -- top-quartile peer value for this metric
  agent_value         numeric,                -- this agent's value
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, week_start_date, theme_key)
);

CREATE INDEX idx_ctw_week_severity ON coaching_themes_weekly (week_start_date DESC, severity);
CREATE INDEX idx_ctw_agent         ON coaching_themes_weekly (agent_id, week_start_date DESC);

COMMENT ON TABLE coaching_themes_weekly IS
  'Pre-aggregated coaching themes derived nightly from conversation_intelligence. Max 3 themes surfaced per agent per week in the UI.';

-- ================================================================
-- coaching_actions: manager close-the-loop tracking
-- ================================================================

CREATE TABLE coaching_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id      uuid REFERENCES coaching_themes_weekly(id) ON DELETE CASCADE,
  agent_id      uuid REFERENCES agents(id) NOT NULL,
  status        text NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'done' | 'dismissed'
  assigned_to   text,                          -- manager name or ID
  manager_notes text,
  outcome_observed text,
  assigned_at   timestamptz DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX idx_ca_agent_status ON coaching_actions (agent_id, status);

COMMENT ON TABLE coaching_actions IS
  'Tracks manager coaching actions against weekly themes. Written from the Coaching Brief UI.';

-- ================================================================
-- agent_attention_map: links Attention user UUIDs to ROLI agent IDs
-- ================================================================

CREATE TABLE agent_attention_map (
  attention_user_uuid text PRIMARY KEY,
  agent_id            uuid REFERENCES agents(id) NOT NULL,
  attention_email     text,
  created_at          timestamptz DEFAULT now()
);

COMMENT ON TABLE agent_attention_map IS
  'Maps Attention.com user UUIDs to ROLI agents. Similar pattern to agent_name_aliases.';

-- ================================================================
-- sync_cursors: incremental pull bookmark for the n8n sync
-- ================================================================

CREATE TABLE sync_cursors (
  source          text PRIMARY KEY,           -- 'attention'
  last_cursor_iso timestamptz NOT NULL,
  updated_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE sync_cursors IS
  'Stores the last-synced timestamp for incremental API pulls (e.g. Attention conversations).';

COMMIT;
