import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AgentPerfPayload {
  agent_name: string;
  tier?: string;
  dials?: number;
  leads_worked?: number;
  contacts_made?: number;
  conversations?: number;
  presentations?: number;
  follow_ups_set?: number;
  sales?: number;
  talk_time_minutes?: number;
  premium?: number;
}

interface IngestPayload {
  scrape_date: string;
  scrape_hour?: number;
  agents: AgentPerfPayload[];
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

    const { data: aliases } = await supabase
      .from("agent_name_aliases")
      .select("crm_name, canonical_name");

    const aliasMap = new Map<string, string>();
    for (const a of (aliases ?? []) as Array<{ crm_name: string; canonical_name: string }>) {
      if (a.crm_name !== a.canonical_name) {
        aliasMap.set(a.crm_name, a.canonical_name);
      }
    }

    const { data: agentRoster } = await supabase
      .from("agents")
      .select("name, tier")
      .eq("is_active", true);

    const rosterTierMap = new Map<string, string>();
    for (const a of (agentRoster ?? []) as Array<{ name: string; tier: string }>) {
      rosterTierMap.set(a.name, a.tier);
    }

    const now = new Date();
    const cstHour = payload.scrape_hour ?? new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" })).getHours();

    let aliasResolved = 0;
    const validAgents = payload.agents.filter((a) => a.agent_name);

    const records = validAgents.map((a) => {
      let name = a.agent_name;
      if (aliasMap.has(name)) {
        name = aliasMap.get(name)!;
        aliasResolved++;
      }
      const tier = a.tier || rosterTierMap.get(name) || "T3";
      return {
        scrape_date: payload.scrape_date,
        scrape_hour: cstHour,
        agent_name: name,
        tier,
        dials: a.dials ?? 0,
        leads_worked: a.leads_worked ?? 0,
        contacts_made: a.contacts_made ?? 0,
        conversations: a.conversations ?? 0,
        presentations: a.presentations ?? 0,
        follow_ups_set: a.follow_ups_set ?? 0,
        sales: a.sales ?? 0,
        talk_time_minutes: a.talk_time_minutes ?? 0,
        premium: a.premium ?? 0,
      };
    });

    const { error: upsertError } = await supabase
      .from("agent_performance_daily")
      .upsert(records, { onConflict: "scrape_date,scrape_hour,agent_name" });

    const errors: Array<{ source: string; error: string }> = [];
    if (upsertError) errors.push({ source: "agent_performance_daily", error: upsertError.message });

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        scrape_date: payload.scrape_date,
        scrape_hour: cstHour,
        agents_upserted: upsertError ? 0 : validAgents.length,
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
