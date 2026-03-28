-- ============================================================
-- Migration 002: Leads Pool tables and ingestion functions
-- Captures data from the CRM's Leads Pool Report and
-- the "Currently In Leads Pool Status" inventory report.
-- ============================================================

-- ============================================================
-- Table: leads_pool_daily_data
-- Per-agent, per-day metrics from the Leads Pool Report.
-- Kept separate from daily_scrape_data because pool call
-- activity overlaps with the regular Calls Report when an
-- agent self-assigns a lead (call attributes append to the
-- regular report). Storing separately lets us deduplicate.
-- ============================================================
CREATE TABLE leads_pool_daily_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_date DATE NOT NULL,
  agent_name TEXT NOT NULL,
  calls_made INTEGER DEFAULT 0,
  talk_time_minutes DECIMAL(10,2) DEFAULT 0,
  sales_made INTEGER DEFAULT 0,
  premium DECIMAL(10,2) DEFAULT 0,
  self_assigned_leads INTEGER DEFAULT 0,
  answered_calls INTEGER DEFAULT 0,
  long_calls INTEGER DEFAULT 0,
  contact_rate DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scrape_date, agent_name)
);

CREATE INDEX idx_pool_daily_date ON leads_pool_daily_data(scrape_date);
CREATE INDEX idx_pool_daily_agent ON leads_pool_daily_data(agent_name);
CREATE INDEX idx_pool_daily_date_agent ON leads_pool_daily_data(scrape_date, agent_name);

-- ============================================================
-- Table: leads_pool_inventory
-- Point-in-time snapshot of how many contactable leads remain
-- in the pool, broken down by contact attempt status.
-- ============================================================
CREATE TABLE leads_pool_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_date DATE NOT NULL,
  scrape_hour INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  total_leads INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scrape_date, scrape_hour, status)
);

CREATE INDEX idx_pool_inventory_date ON leads_pool_inventory(scrape_date);
CREATE INDEX idx_pool_inventory_lookup ON leads_pool_inventory(scrape_date, scrape_hour);

-- ============================================================
-- RLS Policies (matching existing permissive pattern)
-- ============================================================
ALTER TABLE leads_pool_daily_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads_pool_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON leads_pool_daily_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON leads_pool_inventory FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for pool daily data
ALTER PUBLICATION supabase_realtime ADD TABLE leads_pool_daily_data;

-- ============================================================
-- Function: ingest_leads_pool_data(payload JSONB)
-- Upserts Leads Pool Report data and inventory snapshots.
--
-- Expected payload shape:
-- {
--   "scrape_date": "2026-03-28",
--   "scrape_hour": 14,
--   "agents": [
--     {
--       "agent_name": "Alvin Fulmore",
--       "calls_made": 90,
--       "talk_time_minutes": 31,
--       "sales_made": 0,
--       "premium": 0,
--       "self_assigned_leads": 1,
--       "answered_calls": 51,
--       "long_calls": 1,
--       "contact_rate": 57
--     }
--   ],
--   "inventory": [
--     { "status": "New Lead", "total_leads": 194 },
--     { "status": "Contact Attempt 2", "total_leads": 131 }
--   ]
-- }
-- ============================================================
CREATE OR REPLACE FUNCTION ingest_leads_pool_data(payload JSONB)
RETURNS JSONB AS $$
DECLARE
  v_scrape_date DATE;
  v_scrape_hour INTEGER;
  v_agent JSONB;
  v_inv JSONB;
  v_agents_upserted INT := 0;
  v_inventory_upserted INT := 0;
  v_errors JSONB := '[]'::JSONB;
BEGIN
  v_scrape_date := (payload->>'scrape_date')::DATE;
  v_scrape_hour := COALESCE((payload->>'scrape_hour')::INTEGER, 0);

  -- Upsert agent pool data
  FOR v_agent IN SELECT * FROM jsonb_array_elements(payload->'agents')
  LOOP
    BEGIN
      INSERT INTO leads_pool_daily_data (
        scrape_date, agent_name,
        calls_made, talk_time_minutes, sales_made, premium,
        self_assigned_leads, answered_calls, long_calls, contact_rate
      ) VALUES (
        v_scrape_date,
        v_agent->>'agent_name',
        COALESCE((v_agent->>'calls_made')::INT, 0),
        COALESCE((v_agent->>'talk_time_minutes')::DECIMAL, 0),
        COALESCE((v_agent->>'sales_made')::INT, 0),
        COALESCE((v_agent->>'premium')::DECIMAL, 0),
        COALESCE((v_agent->>'self_assigned_leads')::INT, 0),
        COALESCE((v_agent->>'answered_calls')::INT, 0),
        COALESCE((v_agent->>'long_calls')::INT, 0),
        COALESCE((v_agent->>'contact_rate')::DECIMAL, 0)
      )
      ON CONFLICT (scrape_date, agent_name) DO UPDATE SET
        calls_made = EXCLUDED.calls_made,
        talk_time_minutes = EXCLUDED.talk_time_minutes,
        sales_made = EXCLUDED.sales_made,
        premium = EXCLUDED.premium,
        self_assigned_leads = EXCLUDED.self_assigned_leads,
        answered_calls = EXCLUDED.answered_calls,
        long_calls = EXCLUDED.long_calls,
        contact_rate = EXCLUDED.contact_rate;

      v_agents_upserted := v_agents_upserted + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'agent', v_agent->>'agent_name',
        'error', SQLERRM
      );
    END;
  END LOOP;

  -- Upsert inventory snapshots
  IF payload ? 'inventory' THEN
    FOR v_inv IN SELECT * FROM jsonb_array_elements(payload->'inventory')
    LOOP
      BEGIN
        INSERT INTO leads_pool_inventory (
          scrape_date, scrape_hour, status, total_leads
        ) VALUES (
          v_scrape_date,
          v_scrape_hour,
          v_inv->>'status',
          COALESCE((v_inv->>'total_leads')::INT, 0)
        )
        ON CONFLICT (scrape_date, scrape_hour, status) DO UPDATE SET
          total_leads = EXCLUDED.total_leads;

        v_inventory_upserted := v_inventory_upserted + 1;

      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_object(
          'status', v_inv->>'status',
          'error', SQLERRM
        );
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'scrape_date', v_scrape_date,
    'scrape_hour', v_scrape_hour,
    'agents_upserted', v_agents_upserted,
    'inventory_upserted', v_inventory_upserted,
    'errors', v_errors
  );
END;
$$ LANGUAGE plpgsql;
