import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AgentPayload {
  agent_name: string;
  tier: "T1" | "T2" | "T3";
  ib_leads_delivered?: number;
  ob_leads_delivered?: number;
  custom_leads?: number;
  ib_sales?: number;
  ob_sales?: number;
  custom_sales?: number;
  ib_premium?: number;
  ob_premium?: number;
  custom_premium?: number;
  total_dials?: number;
  talk_time_minutes?: number;
}

interface IngestPayload {
  scrape_date: string;
  agents: AgentPayload[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const payload: IngestPayload = await req.json();

    if (!payload.scrape_date || !payload.agents || !Array.isArray(payload.agents)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload: requires scrape_date and agents array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(payload.scrape_date)) {
      return new Response(
        JSON.stringify({ error: "Invalid scrape_date format. Use YYYY-MM-DD" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const cstHour = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" })).getHours();

    const validAgents = payload.agents.filter((a) => {
      if (!a.agent_name || !a.tier) return false;
      if (!["T1", "T2", "T3"].includes(a.tier)) return false;
      return true;
    });

    const dailyRecords = validAgents.map((a) => ({
      scrape_date: payload.scrape_date,
      agent_name: a.agent_name,
      tier: a.tier,
      ib_leads_delivered: a.ib_leads_delivered ?? 0,
      ob_leads_delivered: a.ob_leads_delivered ?? 0,
      custom_leads: a.custom_leads ?? 0,
      ib_sales: a.ib_sales ?? 0,
      ob_sales: a.ob_sales ?? 0,
      custom_sales: a.custom_sales ?? 0,
      ib_premium: a.ib_premium ?? 0,
      ob_premium: a.ob_premium ?? 0,
      custom_premium: a.custom_premium ?? 0,
      total_dials: a.total_dials ?? 0,
      talk_time_minutes: a.talk_time_minutes ?? 0,
    }));

    const intradayRecords = dailyRecords.map((r) => ({
      ...r,
      scrape_hour: cstHour,
    }));

    const { error: dailyError } = await supabase
      .from("daily_scrape_data")
      .upsert(dailyRecords, { onConflict: "scrape_date,agent_name" });

    const { error: intradayError } = await supabase
      .from("intraday_snapshots")
      .upsert(intradayRecords, { onConflict: "scrape_date,scrape_hour,agent_name" });

    const errors: Array<{ source: string; error: string }> = [];
    if (dailyError) errors.push({ source: "daily_scrape_data", error: dailyError.message });
    if (intradayError) errors.push({ source: "intraday_snapshots", error: intradayError.message });

    const skipped = payload.agents.length - validAgents.length;

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        scrape_date: payload.scrape_date,
        scrape_hour: cstHour,
        total_agents: payload.agents.length,
        upserted: validAgents.length,
        skipped,
        intraday_snapshots: intradayError ? 0 : validAgents.length,
        errors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
