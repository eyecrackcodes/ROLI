-- Pipeline Compliance Daily Snapshots
-- Stores per-agent pipeline hygiene metrics scraped from CRM Advanced Dashboard Stats.
-- Financial projections computed at scrape time using tier-specific heuristics.

CREATE TABLE pipeline_compliance_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_date DATE NOT NULL,
  agent_name TEXT NOT NULL,
  agent_id_crm TEXT,
  tier TEXT NOT NULL DEFAULT 'T3',

  -- Raw dashboard metrics
  past_due_follow_ups INTEGER DEFAULT 0,
  new_leads INTEGER DEFAULT 0,
  call_queue_count INTEGER DEFAULT 0,
  todays_follow_ups INTEGER DEFAULT 0,
  post_sale_leads INTEGER DEFAULT 0,

  -- Computed stale/financial metrics
  total_stale INTEGER DEFAULT 0,
  revenue_at_risk DECIMAL(12,2) DEFAULT 0,
  projected_recovery DECIMAL(12,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(scrape_date, agent_name)
);

CREATE INDEX idx_pipeline_compliance_date ON pipeline_compliance_daily(scrape_date);
CREATE INDEX idx_pipeline_compliance_agent ON pipeline_compliance_daily(agent_name);
CREATE INDEX idx_pipeline_compliance_tier ON pipeline_compliance_daily(tier);

ALTER TABLE pipeline_compliance_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all pipeline_compliance_daily" ON pipeline_compliance_daily FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_compliance_daily;
