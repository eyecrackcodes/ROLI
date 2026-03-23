-- ============================================================
-- DSB Tier Calculator — Full Supabase Schema
-- Migration 001: Initial schema, seed data, and functions
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Table: agents — Canonical roster (source of truth for tier)
-- ============================================================
CREATE TABLE agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL CHECK (site IN ('CHA', 'AUS')),
  tier TEXT NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
  daily_lead_volume INTEGER NOT NULL DEFAULT 25,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agents_tier ON agents(tier);
CREATE INDEX idx_agents_active ON agents(is_active);

-- ============================================================
-- Table: lead_cost_config — Per-tier, per-day cost overrides
-- ============================================================
CREATE TABLE lead_cost_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
  lead_channel TEXT NOT NULL CHECK (lead_channel IN ('inbound', 'outbound')),
  cost_per_lead DECIMAL(10,2) NOT NULL,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  UNIQUE(tier, lead_channel, effective_date)
);

CREATE INDEX idx_lead_cost_lookup ON lead_cost_config(tier, lead_channel, effective_date DESC);

-- ============================================================
-- Table: evaluation_windows — Monthly evaluation cycles
-- ============================================================
CREATE TABLE evaluation_windows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  working_days INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT false,
  is_inaugural BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: daily_scrape_data — Raw daily CRM scraper output
-- ============================================================
CREATE TABLE daily_scrape_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_date DATE NOT NULL,
  agent_name TEXT NOT NULL,
  agent_id_crm INTEGER,
  tier TEXT NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
  ib_leads_delivered INTEGER DEFAULT 0,
  ob_leads_delivered INTEGER DEFAULT 0,
  custom_leads INTEGER DEFAULT 0,
  ib_sales INTEGER DEFAULT 0,
  ob_sales INTEGER DEFAULT 0,
  custom_sales INTEGER DEFAULT 0,
  ib_premium DECIMAL(10,2) DEFAULT 0,
  ob_premium DECIMAL(10,2) DEFAULT 0,
  custom_premium DECIMAL(10,2) DEFAULT 0,
  total_dials INTEGER DEFAULT 0,
  talk_time_minutes DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scrape_date, agent_name)
);

CREATE INDEX idx_scrape_date ON daily_scrape_data(scrape_date);
CREATE INDEX idx_scrape_agent ON daily_scrape_data(agent_name);
CREATE INDEX idx_scrape_date_range ON daily_scrape_data(scrape_date, tier);

-- ============================================================
-- Table: intraday_snapshots — Hourly CRM scraper snapshots
-- ============================================================
CREATE TABLE intraday_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_date DATE NOT NULL,
  scrape_hour INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
  ib_leads_delivered INTEGER DEFAULT 0,
  ob_leads_delivered INTEGER DEFAULT 0,
  ib_sales INTEGER DEFAULT 0,
  ob_sales INTEGER DEFAULT 0,
  custom_sales INTEGER DEFAULT 0,
  ib_premium DECIMAL(10,2) DEFAULT 0,
  ob_premium DECIMAL(10,2) DEFAULT 0,
  custom_premium DECIMAL(10,2) DEFAULT 0,
  total_dials INTEGER DEFAULT 0,
  talk_time_minutes DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scrape_date, scrape_hour, agent_name)
);

CREATE INDEX idx_intraday_date ON intraday_snapshots(scrape_date);
CREATE INDEX idx_intraday_agent ON intraday_snapshots(agent_name, scrape_date);

-- ============================================================
-- Table: monthly_snapshots — Computed monthly aggregates
-- ============================================================
CREATE TABLE monthly_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  window_id UUID REFERENCES evaluation_windows(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
  site TEXT,
  total_ib_calls INTEGER DEFAULT 0,
  total_ob_leads INTEGER DEFAULT 0,
  total_leads_delivered INTEGER DEFAULT 0,
  total_ib_sales INTEGER DEFAULT 0,
  total_ob_sales INTEGER DEFAULT 0,
  total_custom_sales INTEGER DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  total_ib_premium DECIMAL(10,2) DEFAULT 0,
  total_ob_premium DECIMAL(10,2) DEFAULT 0,
  total_custom_premium DECIMAL(10,2) DEFAULT 0,
  total_premium DECIMAL(10,2) DEFAULT 0,
  total_dials INTEGER DEFAULT 0,
  total_talk_minutes DECIMAL(10,2) DEFAULT 0,
  lead_cost DECIMAL(10,2) DEFAULT 0,
  profit DECIMAL(10,2) DEFAULT 0,
  roli DECIMAL(10,4) DEFAULT 0,
  close_rate DECIMAL(10,4) DEFAULT 0,
  ib_close_rate DECIMAL(10,4),
  ob_close_rate DECIMAL(10,4),
  daily_pace DECIMAL(10,4),
  prior_roli DECIMAL(10,4),
  status TEXT,
  rank_in_tier INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(window_id, agent_name)
);

CREATE INDEX idx_snapshot_window ON monthly_snapshots(window_id);
CREATE INDEX idx_snapshot_tier ON monthly_snapshots(tier);

-- ============================================================
-- Table: tier_movements — Audit log of tier changes
-- ============================================================
CREATE TABLE tier_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  window_id UUID REFERENCES evaluation_windows(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  from_tier TEXT NOT NULL CHECK (from_tier IN ('T1', 'T2', 'T3')),
  to_tier TEXT NOT NULL CHECK (to_tier IN ('T1', 'T2', 'T3')),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('PROMOTE', 'DEMOTE', 'LATERAL')),
  gate_results JSONB,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: system_config — Key-value store for gate thresholds
-- ============================================================
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- ============================================================
-- Trigger: auto-update updated_at on agents
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Function: get_active_lead_costs(target_date)
-- Returns the active cost for each tier+channel on a given date
-- ============================================================
CREATE OR REPLACE FUNCTION get_active_lead_costs(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(tier TEXT, lead_channel TEXT, cost_per_lead DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (lc.tier, lc.lead_channel)
    lc.tier, lc.lead_channel, lc.cost_per_lead
  FROM lead_cost_config lc
  WHERE lc.effective_date <= target_date
  ORDER BY lc.tier, lc.lead_channel, lc.effective_date DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Function: compute_monthly_snapshot(window_id)
-- Aggregates daily_scrape_data into monthly_snapshots
-- ============================================================
CREATE OR REPLACE FUNCTION compute_monthly_snapshot(p_window_id UUID)
RETURNS void AS $$
DECLARE
  v_window evaluation_windows%ROWTYPE;
  v_prev_window_id UUID;
  v_working_days INTEGER;
BEGIN
  SELECT * INTO v_window FROM evaluation_windows WHERE id = p_window_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Window not found: %', p_window_id;
  END IF;
  v_working_days := v_window.working_days;

  SELECT id INTO v_prev_window_id
  FROM evaluation_windows
  WHERE end_date < v_window.start_date
  ORDER BY end_date DESC LIMIT 1;

  DELETE FROM monthly_snapshots WHERE window_id = p_window_id;

  INSERT INTO monthly_snapshots (
    window_id, agent_name, tier, site,
    total_ib_calls, total_ob_leads, total_leads_delivered,
    total_ib_sales, total_ob_sales, total_custom_sales, total_sales,
    total_ib_premium, total_ob_premium, total_custom_premium, total_premium,
    total_dials, total_talk_minutes,
    lead_cost, profit, roli, close_rate, ib_close_rate, ob_close_rate, daily_pace,
    prior_roli
  )
  SELECT
    p_window_id,
    d.agent_name,
    d.tier,
    a.site,
    SUM(d.ib_leads_delivered),
    SUM(d.ob_leads_delivered),
    SUM(d.ib_leads_delivered + d.ob_leads_delivered),
    SUM(d.ib_sales),
    SUM(d.ob_sales),
    SUM(d.custom_sales),
    SUM(d.ib_sales + d.ob_sales + d.custom_sales),
    SUM(d.ib_premium),
    SUM(d.ob_premium),
    SUM(d.custom_premium),
    SUM(d.ib_premium + d.ob_premium + d.custom_premium),
    SUM(d.total_dials),
    SUM(d.talk_time_minutes),
    -- Lead cost: sum of (daily IB * IB cost) + (daily OB * OB cost)
    SUM(
      d.ib_leads_delivered * COALESCE(ib_cost.cost_per_lead, 0) +
      d.ob_leads_delivered * COALESCE(ob_cost.cost_per_lead, 0)
    ),
    -- Profit
    SUM(d.ib_premium + d.ob_premium + d.custom_premium) -
    SUM(
      d.ib_leads_delivered * COALESCE(ib_cost.cost_per_lead, 0) +
      d.ob_leads_delivered * COALESCE(ob_cost.cost_per_lead, 0)
    ),
    -- ROLI
    CASE WHEN SUM(
      d.ib_leads_delivered * COALESCE(ib_cost.cost_per_lead, 0) +
      d.ob_leads_delivered * COALESCE(ob_cost.cost_per_lead, 0)
    ) > 0 THEN
      (SUM(d.ib_premium + d.ob_premium + d.custom_premium) -
       SUM(d.ib_leads_delivered * COALESCE(ib_cost.cost_per_lead, 0) +
           d.ob_leads_delivered * COALESCE(ob_cost.cost_per_lead, 0))) /
      SUM(d.ib_leads_delivered * COALESCE(ib_cost.cost_per_lead, 0) +
          d.ob_leads_delivered * COALESCE(ob_cost.cost_per_lead, 0))
    ELSE 0 END,
    -- Close Rate (excludes custom)
    CASE WHEN SUM(d.ib_leads_delivered + d.ob_leads_delivered) > 0 THEN
      (SUM(d.ib_sales + d.ob_sales)::DECIMAL / SUM(d.ib_leads_delivered + d.ob_leads_delivered)) * 100
    ELSE 0 END,
    -- IB Close Rate
    CASE WHEN SUM(d.ib_leads_delivered) > 0 THEN
      (SUM(d.ib_sales)::DECIMAL / SUM(d.ib_leads_delivered)) * 100
    ELSE NULL END,
    -- OB Close Rate
    CASE WHEN SUM(d.ob_leads_delivered) > 0 THEN
      (SUM(d.ob_sales)::DECIMAL / SUM(d.ob_leads_delivered)) * 100
    ELSE NULL END,
    -- Daily Pace (T3 only)
    CASE WHEN d.tier = 'T3' THEN
      SUM(d.ib_sales + d.ob_sales + d.custom_sales)::DECIMAL / v_working_days
    ELSE NULL END,
    -- Prior ROLI
    prev.roli
  FROM daily_scrape_data d
  JOIN agents a ON a.name = d.agent_name
  LEFT JOIN LATERAL (
    SELECT lc.cost_per_lead FROM lead_cost_config lc
    WHERE lc.tier = d.tier AND lc.lead_channel = 'inbound' AND lc.effective_date <= d.scrape_date
    ORDER BY lc.effective_date DESC LIMIT 1
  ) ib_cost ON true
  LEFT JOIN LATERAL (
    SELECT lc.cost_per_lead FROM lead_cost_config lc
    WHERE lc.tier = d.tier AND lc.lead_channel = 'outbound' AND lc.effective_date <= d.scrape_date
    ORDER BY lc.effective_date DESC LIMIT 1
  ) ob_cost ON true
  LEFT JOIN monthly_snapshots prev ON prev.window_id = v_prev_window_id AND prev.agent_name = d.agent_name
  WHERE d.scrape_date BETWEEN v_window.start_date AND v_window.end_date
  GROUP BY d.agent_name, d.tier, a.site, prev.roli;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Function: ingest_daily_scrape(payload JSONB)
-- Upserts scraped data from N8N webhook
-- ============================================================
CREATE OR REPLACE FUNCTION ingest_daily_scrape(payload JSONB)
RETURNS JSONB AS $$
DECLARE
  v_scrape_date DATE;
  v_agent JSONB;
  v_inserted INT := 0;
  v_updated INT := 0;
  v_errors JSONB := '[]'::JSONB;
BEGIN
  v_scrape_date := (payload->>'scrape_date')::DATE;

  FOR v_agent IN SELECT * FROM jsonb_array_elements(payload->'agents')
  LOOP
    BEGIN
      INSERT INTO daily_scrape_data (
        scrape_date, agent_name, tier,
        ib_leads_delivered, ob_leads_delivered, custom_leads,
        ib_sales, ob_sales, custom_sales,
        ib_premium, ob_premium, custom_premium,
        total_dials, talk_time_minutes
      ) VALUES (
        v_scrape_date,
        v_agent->>'agent_name',
        v_agent->>'tier',
        COALESCE((v_agent->>'ib_leads_delivered')::INT, 0),
        COALESCE((v_agent->>'ob_leads_delivered')::INT, 0),
        COALESCE((v_agent->>'custom_leads')::INT, 0),
        COALESCE((v_agent->>'ib_sales')::INT, 0),
        COALESCE((v_agent->>'ob_sales')::INT, 0),
        COALESCE((v_agent->>'custom_sales')::INT, 0),
        COALESCE((v_agent->>'ib_premium')::DECIMAL, 0),
        COALESCE((v_agent->>'ob_premium')::DECIMAL, 0),
        COALESCE((v_agent->>'custom_premium')::DECIMAL, 0),
        COALESCE((v_agent->>'total_dials')::INT, 0),
        COALESCE((v_agent->>'talk_time_minutes')::DECIMAL, 0)
      )
      ON CONFLICT (scrape_date, agent_name) DO UPDATE SET
        tier = EXCLUDED.tier,
        ib_leads_delivered = EXCLUDED.ib_leads_delivered,
        ob_leads_delivered = EXCLUDED.ob_leads_delivered,
        custom_leads = EXCLUDED.custom_leads,
        ib_sales = EXCLUDED.ib_sales,
        ob_sales = EXCLUDED.ob_sales,
        custom_sales = EXCLUDED.custom_sales,
        ib_premium = EXCLUDED.ib_premium,
        ob_premium = EXCLUDED.ob_premium,
        custom_premium = EXCLUDED.custom_premium,
        total_dials = EXCLUDED.total_dials,
        talk_time_minutes = EXCLUDED.talk_time_minutes;

      IF FOUND THEN
        IF xmax = 0 THEN
          v_inserted := v_inserted + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'agent', v_agent->>'agent_name',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'errors', v_errors
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Function: ingest_intraday_scrape(payload JSONB)
-- Upserts hourly intraday snapshots from N8N webhook
-- ============================================================
CREATE OR REPLACE FUNCTION ingest_intraday_scrape(payload JSONB)
RETURNS JSONB AS $$
DECLARE
  v_scrape_date DATE;
  v_scrape_hour INTEGER;
  v_agent JSONB;
  v_upserted INT := 0;
  v_errors JSONB := '[]'::JSONB;
BEGIN
  v_scrape_date := (payload->>'scrape_date')::DATE;
  v_scrape_hour := (payload->>'scrape_hour')::INTEGER;

  FOR v_agent IN SELECT * FROM jsonb_array_elements(payload->'agents')
  LOOP
    BEGIN
      INSERT INTO intraday_snapshots (
        scrape_date, scrape_hour, agent_name, tier,
        ib_leads_delivered, ob_leads_delivered,
        ib_sales, ob_sales, custom_sales,
        ib_premium, ob_premium, custom_premium,
        total_dials, talk_time_minutes
      ) VALUES (
        v_scrape_date,
        v_scrape_hour,
        v_agent->>'agent_name',
        v_agent->>'tier',
        COALESCE((v_agent->>'ib_leads_delivered')::INT, 0),
        COALESCE((v_agent->>'ob_leads_delivered')::INT, 0),
        COALESCE((v_agent->>'ib_sales')::INT, 0),
        COALESCE((v_agent->>'ob_sales')::INT, 0),
        COALESCE((v_agent->>'custom_sales')::INT, 0),
        COALESCE((v_agent->>'ib_premium')::DECIMAL, 0),
        COALESCE((v_agent->>'ob_premium')::DECIMAL, 0),
        COALESCE((v_agent->>'custom_premium')::DECIMAL, 0),
        COALESCE((v_agent->>'total_dials')::INT, 0),
        COALESCE((v_agent->>'talk_time_minutes')::DECIMAL, 0)
      )
      ON CONFLICT (scrape_date, scrape_hour, agent_name) DO UPDATE SET
        tier = EXCLUDED.tier,
        ib_leads_delivered = EXCLUDED.ib_leads_delivered,
        ob_leads_delivered = EXCLUDED.ob_leads_delivered,
        ib_sales = EXCLUDED.ib_sales,
        ob_sales = EXCLUDED.ob_sales,
        custom_sales = EXCLUDED.custom_sales,
        ib_premium = EXCLUDED.ib_premium,
        ob_premium = EXCLUDED.ob_premium,
        custom_premium = EXCLUDED.custom_premium,
        total_dials = EXCLUDED.total_dials,
        talk_time_minutes = EXCLUDED.talk_time_minutes;

      v_upserted := v_upserted + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'agent', v_agent->>'agent_name',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'scrape_date', v_scrape_date,
    'scrape_hour', v_scrape_hour,
    'upserted', v_upserted,
    'errors', v_errors
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Seed Data: Lead cost defaults
-- ============================================================
INSERT INTO lead_cost_config (tier, lead_channel, cost_per_lead, effective_date) VALUES
  ('T1', 'inbound', 83.00, '2026-01-01'),
  ('T2', 'inbound', 73.00, '2026-01-01'),
  ('T2', 'outbound', 15.00, '2026-01-01'),
  ('T3', 'outbound', 15.00, '2026-01-01');

-- ============================================================
-- Seed Data: 2026 Evaluation Windows
-- ============================================================
INSERT INTO evaluation_windows (name, start_date, end_date, working_days, is_active) VALUES
  ('April 2026', '2026-03-30', '2026-05-01', 23, true),
  ('May 2026', '2026-05-04', '2026-05-29', 19, false),
  ('June 2026', '2026-06-01', '2026-07-03', 24, false),
  ('July 2026', '2026-06-29', '2026-07-31', 24, false),
  ('August 2026', '2026-08-03', '2026-08-28', 20, false),
  ('September 2026', '2026-08-31', '2026-10-02', 23, false),
  ('October 2026', '2026-10-05', '2026-10-30', 20, false),
  ('November 2026', '2026-11-02', '2026-11-25', 16, false),
  ('December 2026', '2026-11-30', '2026-12-26', 19, false);

-- ============================================================
-- Seed Data: Gate threshold defaults
-- ============================================================
INSERT INTO system_config (key, value) VALUES
  ('gate_thresholds', '{
    "MIN_CR_FOR_PROMOTION": 5,
    "PROFIT_FLOOR_PERCENTILE": 40,
    "TRAJECTORY_IMPROVEMENT": 20,
    "T1_IB_CR_QUARTILE": 25,
    "MAX_SWAPS_PER_WINDOW": 5
  }'::JSONB),
  ('bucket_sizes', '{
    "T1": 19,
    "T2": 47,
    "T3": 22
  }'::JSONB),
  ('daily_volumes', '{
    "T1_INBOUND_CALLS": 10,
    "T2_INBOUND_CALLS": 7,
    "T2_OUTBOUND_LEADS": 10,
    "T3_OUTBOUND_LEADS": 25
  }'::JSONB),
  ('pace_targets', '{
    "T3_FLOOR": 1.25,
    "T3_PROMO": 2.0
  }'::JSONB);

-- ============================================================
-- RLS Policies (permissive for single-analyst use)
-- ============================================================
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_cost_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_scrape_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE intraday_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated" ON agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON lead_cost_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON evaluation_windows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON daily_scrape_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON intraday_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON monthly_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON tier_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON system_config FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for daily_scrape_data and intraday_snapshots
ALTER PUBLICATION supabase_realtime ADD TABLE daily_scrape_data;
ALTER PUBLICATION supabase_realtime ADD TABLE intraday_snapshots;
