-- Daily Agent Performance (Sales Funnel)
-- Captures full funnel metrics from the CRM Daily Agent Performance report:
-- Dials → Leads Worked → Contacts → Conversations → Presentations → Sales
-- scrape_hour NULL = daily aggregate, 0-23 = hourly snapshot

CREATE TABLE agent_performance_daily (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scrape_date   DATE NOT NULL,
  scrape_hour   SMALLINT,
  agent_name    TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'T3',
  dials         INTEGER DEFAULT 0,
  leads_worked  INTEGER DEFAULT 0,
  contacts_made INTEGER DEFAULT 0,
  conversations INTEGER DEFAULT 0,
  presentations INTEGER DEFAULT 0,
  follow_ups_set INTEGER DEFAULT 0,
  sales         INTEGER DEFAULT 0,
  talk_time_minutes INTEGER DEFAULT 0,
  premium       NUMERIC(12,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scrape_date, scrape_hour, agent_name)
);

CREATE INDEX idx_agent_perf_date ON agent_performance_daily(scrape_date);
CREATE INDEX idx_agent_perf_agent ON agent_performance_daily(agent_name);
CREATE INDEX idx_agent_perf_tier ON agent_performance_daily(tier);

ALTER TABLE agent_performance_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all agent_performance_daily" ON agent_performance_daily FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE agent_performance_daily;
