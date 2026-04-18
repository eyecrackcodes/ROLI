-- Intraday pipeline-compliance snapshots.
-- Captures the same metrics as pipeline_compliance_daily three times per day
-- (morning ~8am, midday ~1pm, eod ~7pm CST) so the unified compliance workflow
-- can compute deltas (e.g. "new past dues since morning", "leads cleared midday-to-eod").
-- Daily aggregate stays in pipeline_compliance_daily (one row per agent per day);
-- this table is the time-series companion.

BEGIN;

CREATE TABLE IF NOT EXISTS pipeline_compliance_intraday (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_date         date NOT NULL,
  snapshot_label      text NOT NULL,           -- 'morning' | 'midday' | 'eod'
  scrape_hour         integer NOT NULL,        -- CST hour (0-23) when captured
  agent_name          text NOT NULL,
  agent_id_crm        text,
  past_due_follow_ups integer NOT NULL DEFAULT 0,
  new_leads           integer NOT NULL DEFAULT 0,
  call_queue_count    integer NOT NULL DEFAULT 0,
  todays_follow_ups   integer NOT NULL DEFAULT 0,
  post_sale_leads     integer NOT NULL DEFAULT 0,
  total_stale         integer NOT NULL DEFAULT 0,
  revenue_at_risk     numeric(12,2) NOT NULL DEFAULT 0,
  projected_recovery  numeric(12,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pci_label_check
    CHECK (snapshot_label IN ('morning', 'midday', 'eod')),
  CONSTRAINT pci_unique_snapshot
    UNIQUE (scrape_date, snapshot_label, agent_name)
);

-- Trend queries: "show me an agent's three snapshots for a given day"
CREATE INDEX IF NOT EXISTS pci_agent_date_idx
  ON pipeline_compliance_intraday (agent_name, scrape_date);

-- "Latest snapshot for everyone on this date"
CREATE INDEX IF NOT EXISTS pci_date_label_idx
  ON pipeline_compliance_intraday (scrape_date, snapshot_label);

COMMENT ON TABLE pipeline_compliance_intraday IS
  'Three intraday snapshots per agent per day (morning/midday/eod). Used by the pipeline compliance workflow to compute deltas and produce the EOD after-action report.';
COMMENT ON COLUMN pipeline_compliance_intraday.snapshot_label IS
  'morning ~ 8am CST scrape (state-of-pipeline), midday ~ 1pm (movement), eod ~ 7pm (after-action with WTD context).';

COMMIT;
