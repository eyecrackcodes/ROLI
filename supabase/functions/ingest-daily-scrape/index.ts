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
  /**
   * Mode controls how rows are written:
   *   - "full" (default): full upsert of all columns + intraday snapshot
   *   - "sales_only": only updates ib_sales/ob_sales/custom_sales + premiums.
   *     Preserves existing dials, talk_time, leads_delivered. Does NOT write
   *     to intraday_snapshots. Used by the late-sweep workflow to fix sales
   *     entered after the daily scrape ran.
   */
  mode?: "full" | "sales_only";
}

const SALE_COLUMNS = [
  "ib_sales",
  "ob_sales",
  "custom_sales",
  "ib_premium",
  "ob_premium",
  "custom_premium",
] as const;

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
    const validAgents = payload.agents.filter((a) => {
      if (!a.agent_name || !a.tier) return false;
      if (!["T1", "T2", "T3"].includes(a.tier)) return false;
      return true;
    });

    const dailyRecords = validAgents.map((a) => {
      let name = a.agent_name;
      if (aliasMap.has(name)) {
        name = aliasMap.get(name)!;
        aliasResolved++;
      }
      return {
        scrape_date: payload.scrape_date,
        agent_name: name,
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
      };
    });

    const mode = payload.mode === "sales_only" ? "sales_only" : "full";
    const errors: Array<{ source: string; error: string }> = [];
    let updated = 0;
    let inserted = 0;
    let intradayCount = 0;

    if (mode === "sales_only") {
      // Fetch existing rows for this date+agent set, merge sale columns, upsert.
      // Preserves dials/talk/leads from the original daily scrape.
      const names = dailyRecords.map((r) => r.agent_name);
      const { data: existing, error: fetchErr } = await supabase
        .from("daily_scrape_data")
        .select("*")
        .eq("scrape_date", payload.scrape_date)
        .in("agent_name", names);
      if (fetchErr) errors.push({ source: "daily_scrape_data.select", error: fetchErr.message });

      const existingMap = new Map<string, Record<string, unknown>>();
      for (const row of (existing ?? []) as Array<Record<string, unknown>>) {
        existingMap.set(row.agent_name as string, row);
      }

      const merged = dailyRecords.map((r) => {
        const prev = existingMap.get(r.agent_name);
        if (prev) {
          updated++;
          // Keep all existing columns, replace sale columns only.
          const out: Record<string, unknown> = { ...prev };
          for (const c of SALE_COLUMNS) out[c] = r[c as keyof typeof r];
          // Defensive: ensure date/agent/tier are exactly the keys
          out.scrape_date = r.scrape_date;
          out.agent_name = r.agent_name;
          if (!out.tier) out.tier = r.tier;
          // Drop server-managed columns that may not be writable
          delete (out as { id?: unknown }).id;
          delete (out as { created_at?: unknown }).created_at;
          delete (out as { updated_at?: unknown }).updated_at;
          return out;
        } else {
          inserted++;
          return r;
        }
      });

      const { error: dailyError } = await supabase
        .from("daily_scrape_data")
        .upsert(merged, { onConflict: "scrape_date,agent_name" });
      if (dailyError) errors.push({ source: "daily_scrape_data", error: dailyError.message });
    } else {
      // Full mode: original behavior. Upsert + intraday snapshot.
      const intradayRecords = dailyRecords.map((r) => ({ ...r, scrape_hour: cstHour }));

      const { error: dailyError } = await supabase
        .from("daily_scrape_data")
        .upsert(dailyRecords, { onConflict: "scrape_date,agent_name" });
      if (dailyError) errors.push({ source: "daily_scrape_data", error: dailyError.message });

      const { error: intradayError } = await supabase
        .from("intraday_snapshots")
        .upsert(intradayRecords, { onConflict: "scrape_date,scrape_hour,agent_name" });
      if (intradayError) errors.push({ source: "intraday_snapshots", error: intradayError.message });
      else intradayCount = validAgents.length;
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        mode,
        scrape_date: payload.scrape_date,
        scrape_hour: cstHour,
        total_agents: payload.agents.length,
        upserted: validAgents.length,
        sales_only_updated: mode === "sales_only" ? updated : undefined,
        sales_only_inserted: mode === "sales_only" ? inserted : undefined,
        alias_resolved: aliasResolved,
        intraday_snapshots: intradayCount,
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
