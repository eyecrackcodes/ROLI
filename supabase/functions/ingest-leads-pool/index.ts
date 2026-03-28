import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PoolAgentPayload {
  agent_name: string;
  calls_made?: number;
  talk_time_minutes?: number;
  sales_made?: number;
  premium?: number;
  self_assigned_leads?: number;
  answered_calls?: number;
  long_calls?: number;
  contact_rate?: number;
}

interface PoolInventoryPayload {
  status: string;
  total_leads?: number;
}

interface IngestPayload {
  scrape_date: string;
  agents: PoolAgentPayload[];
  inventory?: PoolInventoryPayload[];
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

    // Load alias map for name resolution
    const { data: aliases } = await supabase
      .from("agent_name_aliases")
      .select("crm_name, canonical_name");

    const aliasMap = new Map<string, string>();
    for (const a of (aliases ?? []) as Array<{ crm_name: string; canonical_name: string }>) {
      if (a.crm_name !== a.canonical_name) {
        aliasMap.set(a.crm_name, a.canonical_name);
      }
    }

    const now = new Date();
    const cstHour = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" })).getHours();

    let aliasResolved = 0;
    const validAgents = payload.agents.filter((a) => a.agent_name);

    const poolRecords = validAgents.map((a) => {
      let name = a.agent_name;
      if (aliasMap.has(name)) {
        name = aliasMap.get(name)!;
        aliasResolved++;
      }
      return {
        scrape_date: payload.scrape_date,
        agent_name: name,
        calls_made: a.calls_made ?? 0,
        talk_time_minutes: a.talk_time_minutes ?? 0,
        sales_made: a.sales_made ?? 0,
        premium: a.premium ?? 0,
        self_assigned_leads: a.self_assigned_leads ?? 0,
        answered_calls: a.answered_calls ?? 0,
        long_calls: a.long_calls ?? 0,
        contact_rate: a.contact_rate ?? 0,
      };
    });

    const { error: poolError } = await supabase
      .from("leads_pool_daily_data")
      .upsert(poolRecords, { onConflict: "scrape_date,agent_name" });

    const errors: Array<{ source: string; error: string }> = [];
    if (poolError) errors.push({ source: "leads_pool_daily_data", error: poolError.message });

    // Also write pool data to intraday_snapshots for hourly progression
    const { data: agentRoster } = await supabase
      .from("agents")
      .select("name, tier")
      .eq("is_active", true);

    const tierMap = new Map<string, string>();
    for (const a of (agentRoster ?? []) as Array<{ name: string; tier: string }>) {
      tierMap.set(a.name, a.tier);
    }

    const intradayPoolRecords = poolRecords
      .filter((r) => tierMap.has(r.agent_name))
      .map((r) => ({
        scrape_date: payload.scrape_date,
        scrape_hour: cstHour,
        agent_name: r.agent_name,
        tier: tierMap.get(r.agent_name)!,
        pool_dials: r.calls_made,
        pool_talk_minutes: r.talk_time_minutes,
        pool_answered: r.answered_calls,
        pool_long_calls: r.long_calls,
        pool_self_assigned: r.self_assigned_leads,
        pool_contact_rate: r.contact_rate,
      }));

    if (intradayPoolRecords.length > 0) {
      const { error: intradayError } = await supabase
        .from("intraday_snapshots")
        .upsert(intradayPoolRecords, { onConflict: "scrape_date,scrape_hour,agent_name" });

      if (intradayError) errors.push({ source: "intraday_snapshots", error: intradayError.message });
    }

    let inventoryUpserted = 0;
    if (payload.inventory && Array.isArray(payload.inventory)) {
      const inventoryRecords = payload.inventory
        .filter((inv) => inv.status)
        .map((inv) => ({
          scrape_date: payload.scrape_date,
          scrape_hour: cstHour,
          status: inv.status,
          total_leads: inv.total_leads ?? 0,
        }));

      const { error: invError } = await supabase
        .from("leads_pool_inventory")
        .upsert(inventoryRecords, { onConflict: "scrape_date,scrape_hour,status" });

      if (invError) errors.push({ source: "leads_pool_inventory", error: invError.message });
      else inventoryUpserted = inventoryRecords.length;
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        scrape_date: payload.scrape_date,
        scrape_hour: cstHour,
        pool_agents_upserted: poolError ? 0 : validAgents.length,
        inventory_upserted: inventoryUpserted,
        alias_resolved: aliasResolved,
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
