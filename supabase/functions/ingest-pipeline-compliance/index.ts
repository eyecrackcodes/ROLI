import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PipelineAgentPayload {
  agent_name: string;
  agent_id_crm?: string;
  tier?: string;
  past_due_follow_ups?: number;
  new_leads?: number;
  call_queue_count?: number;
  todays_follow_ups?: number;
  post_sale_leads?: number;
  total_stale?: number;
  revenue_at_risk?: number;
  projected_recovery?: number;
}

interface IngestPayload {
  scrape_date: string;
  agents: PipelineAgentPayload[];
  /**
   * Optional intraday snapshot label. When supplied, in addition to the usual
   * upsert into `pipeline_compliance_daily`, a snapshot row is upserted into
   * `pipeline_compliance_intraday` keyed by (scrape_date, snapshot_label,
   * agent_name). Used by the unified compliance workflow to compute deltas
   * across morning -> midday -> eod snapshots.
   */
  snapshot_label?: "morning" | "midday" | "eod";
  /** Optional CST hour the snapshot was captured. Defaults to current CST hour. */
  scrape_hour?: number;
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

    if (!payload.scrape_date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.scrape_date)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid scrape_date format (expected YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!payload.agents || !Array.isArray(payload.agents) || payload.agents.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "agents array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve aliases
    const { data: aliases } = await supabase
      .from("agent_name_aliases")
      .select("crm_name, canonical_name");
    const aliasMap = new Map<string, string>();
    for (const a of (aliases ?? []) as Array<{ crm_name: string; canonical_name: string }>) {
      aliasMap.set(a.crm_name.toLowerCase(), a.canonical_name);
    }

    const resolveName = (name: string): string => {
      return aliasMap.get(name.toLowerCase()) ?? name;
    };

    // Look up tiers from agents table for any missing tier info
    const { data: agentRoster } = await supabase
      .from("agents")
      .select("name, tier")
      .eq("is_active", true);
    const tierMap = new Map<string, string>();
    for (const a of (agentRoster ?? []) as Array<{ name: string; tier: string }>) {
      tierMap.set(a.name, a.tier);
    }

    const records = payload.agents.map((a) => {
      const resolvedName = resolveName(a.agent_name);
      return {
        scrape_date: payload.scrape_date,
        agent_name: resolvedName,
        agent_id_crm: a.agent_id_crm ?? null,
        tier: a.tier ?? tierMap.get(resolvedName) ?? "T3",
        past_due_follow_ups: a.past_due_follow_ups ?? 0,
        new_leads: a.new_leads ?? 0,
        call_queue_count: a.call_queue_count ?? 0,
        todays_follow_ups: a.todays_follow_ups ?? 0,
        post_sale_leads: a.post_sale_leads ?? 0,
        total_stale: a.total_stale ?? 0,
        revenue_at_risk: a.revenue_at_risk ?? 0,
        projected_recovery: a.projected_recovery ?? 0,
      };
    });

    const { error } = await supabase
      .from("pipeline_compliance_daily")
      .upsert(records, { onConflict: "scrape_date,agent_name" });

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let intradayInserted = 0;
    let intradayError: string | null = null;
    if (payload.snapshot_label) {
      const validLabels = new Set(["morning", "midday", "eod"]);
      if (!validLabels.has(payload.snapshot_label)) {
        intradayError = `invalid snapshot_label: ${payload.snapshot_label}`;
      } else {
        const cstHour = typeof payload.scrape_hour === "number"
          ? payload.scrape_hour
          : new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })).getHours();
        const intradayRecords = records.map((r) => ({
          scrape_date: r.scrape_date,
          snapshot_label: payload.snapshot_label,
          scrape_hour: cstHour,
          agent_name: r.agent_name,
          agent_id_crm: r.agent_id_crm,
          past_due_follow_ups: r.past_due_follow_ups,
          new_leads: r.new_leads,
          call_queue_count: r.call_queue_count,
          todays_follow_ups: r.todays_follow_ups,
          post_sale_leads: r.post_sale_leads,
          total_stale: r.total_stale,
          revenue_at_risk: r.revenue_at_risk,
          projected_recovery: r.projected_recovery,
        }));
        const { error: intError } = await supabase
          .from("pipeline_compliance_intraday")
          .upsert(intradayRecords, { onConflict: "scrape_date,snapshot_label,agent_name" });
        if (intError) intradayError = intError.message;
        else intradayInserted = intradayRecords.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: records.length,
        scrape_date: payload.scrape_date,
        snapshot_label: payload.snapshot_label ?? null,
        intraday_inserted: intradayInserted,
        intraday_error: intradayError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
