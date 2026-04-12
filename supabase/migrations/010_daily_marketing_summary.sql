-- ============================================================
-- Daily marketing summary (synced from Marketing AAR via n8n)
-- One row per calendar day — org-wide CPC, ROAS, spend from Company Dashboard
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_marketing_summary (
  report_date         DATE PRIMARY KEY,
  total_cost          NUMERIC NOT NULL DEFAULT 0,
  cpc                 NUMERIC NOT NULL DEFAULT 0,
  total_calls         INTEGER NOT NULL DEFAULT 0,
  total_sales         INTEGER NOT NULL DEFAULT 0,
  total_premium       NUMERIC NOT NULL DEFAULT 0,
  avg_premium         NUMERIC NOT NULL DEFAULT 0,
  roas                NUMERIC NOT NULL DEFAULT 0,
  marketing_acq_pct   NUMERIC NOT NULL DEFAULT 0,
  cost_per_sale       NUMERIC NOT NULL DEFAULT 0,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_marketing_summary_synced
  ON daily_marketing_summary (synced_at DESC);

ALTER TABLE daily_marketing_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all daily_marketing_summary"
  ON daily_marketing_summary
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE daily_marketing_summary IS
  'Org-wide daily marketing metrics (CPC, ROAS) synced from Marketing AAR company_daily_metrics by n8n hourly-action-alert.';
