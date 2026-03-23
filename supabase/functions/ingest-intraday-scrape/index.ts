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
  scrape_hour: number;
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

    if (!payload.scrape_date || payload.scrape_hour == null || !payload.agents || !Array.isArray(payload.agents)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload: requires scrape_date, scrape_hour, and agents array" }),
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

    if (payload.scrape_hour < 0 || payload.scrape_hour > 23 || !Number.isInteger(payload.scrape_hour)) {
      return new Response(
        JSON.stringify({ error: "Invalid scrape_hour. Must be integer 0-23" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let inserted = 0;
    let updated = 0;
    const errors: Array<{ agent: string; error: string }> = [];

    for (const agent of payload.agents) {
      if (!agent.agent_name || !agent.tier) {
        errors.push({ agent: agent.agent_name ?? "unknown", error: "Missing agent_name or tier" });
        continue;
      }

      if (!["T1", "T2", "T3"].includes(agent.tier)) {
        errors.push({ agent: agent.agent_name, error: `Invalid tier: ${agent.tier}` });
        continue;
      }

      const record = {
        scrape_date: payload.scrape_date,
        scrape_hour: payload.scrape_hour,
        agent_name: agent.agent_name,
        tier: agent.tier,
        ib_leads_delivered: agent.ib_leads_delivered ?? 0,
        ob_leads_delivered: agent.ob_leads_delivered ?? 0,
        ib_sales: agent.ib_sales ?? 0,
        ob_sales: agent.ob_sales ?? 0,
        custom_sales: agent.custom_sales ?? 0,
        ib_premium: agent.ib_premium ?? 0,
        ob_premium: agent.ob_premium ?? 0,
        custom_premium: agent.custom_premium ?? 0,
        total_dials: agent.total_dials ?? 0,
        talk_time_minutes: agent.talk_time_minutes ?? 0,
      };

      const { error: upsertError } = await supabase
        .from("intraday_snapshots")
        .upsert(record, { onConflict: "scrape_date,scrape_hour,agent_name" });

      if (upsertError) {
        errors.push({ agent: agent.agent_name, error: upsertError.message });
      } else {
        inserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scrape_date: payload.scrape_date,
        scrape_hour: payload.scrape_hour,
        total_agents: payload.agents.length,
        inserted,
        updated,
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
