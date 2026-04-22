import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AgentPayload {
  agent_name: string;
  tier?: "T1" | "T2" | "T3";
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
  // ICD-sourced activity fields (used by ib_leads_only mode for RPAs).
  // CRM Calls Report supplies talk_time_minutes (= outbound talk); ICD
  // supplies the three fields below. They are additive — no overlap.
  queue_minutes?: number;
  inbound_talk_minutes?: number;
  avg_wait_minutes?: number;
}

interface IngestPayload {
  scrape_date: string;
  agents: AgentPayload[];
  /**
   * Optional explicit hour for intraday writes. Falls back to the
   * server's current CST hour. Only honored by "icd_intraday" mode
   * (other modes always use the current CST hour for consistency with
   * the legacy CRM scraper).
   */
  scrape_hour?: number;
  /**
   * Mode controls how rows are written:
   *   - "full" (default): full upsert of all columns + intraday snapshot
   *   - "sales_only": only updates ib_sales/ob_sales/custom_sales + premiums.
   *     Preserves existing dials, talk_time, leads_delivered. Does NOT write
   *     to intraday_snapshots. Used by the late-sweep workflow to fix sales
   *     entered after the daily scrape ran.
   *   - "ib_leads_only": only updates ib_leads_delivered (+ optional ICD
   *     RPA fields when present) on daily_scrape_data. Preserves all other
   *     columns. Used by the nightly ICD billable-leads sync.
   *   - "icd_intraday": writes ICD's three RPA fields (queue_minutes,
   *     inbound_talk_minutes, avg_wait_minutes) into intraday_snapshots
   *     for the current hour. SELECT-merges with the existing row so the
   *     CRM scraper's columns (total_dials, talk_time_minutes, etc.) are
   *     preserved. Powers the intraday RpaPacer UI.
   */
  mode?: "full" | "sales_only" | "ib_leads_only" | "icd_intraday";
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

    const mode: "full" | "sales_only" | "ib_leads_only" | "icd_intraday" =
      payload.mode === "sales_only"
        ? "sales_only"
        : payload.mode === "ib_leads_only"
          ? "ib_leads_only"
          : payload.mode === "icd_intraday"
            ? "icd_intraday"
            : "full";

    let aliasResolved = 0;
    const validAgents = payload.agents.filter((a) => {
      if (!a.agent_name) return false;
      // Tier is required for full / sales_only modes (used on insert).
      // ib_leads_only and icd_intraday modes tolerate missing tier.
      if (mode === "ib_leads_only" || mode === "icd_intraday") return true;
      if (!a.tier) return false;
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
        tier: a.tier ?? "T2",
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
        // NOTE: queue_minutes / inbound_talk_minutes / avg_wait_minutes are
        // intentionally NOT included here. They are ICD-sourced and only
        // written by the ib_leads_only branch (which reads them off the
        // original payload). Including them here with default 0 would cause
        // the DSB `full` scraper to overwrite ICD's values with zeros.
      };
    });

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
    } else if (mode === "ib_leads_only") {
      // ib_leads_only mode: ICD scraper feed.
      // Only ib_leads_delivered should be touched on existing rows; everything
      // else (sales, dials, talk, ob/custom leads) must remain whatever the
      // DSB daily scraper wrote earlier in the day. If the row doesn't exist
      // yet (e.g. ICD finished before DSB on backfill), we insert a minimal
      // stub so the inbound number doesn't get lost — the DSB scraper's later
      // upsert will fill in the rest.
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

      // Re-index the original payload by alias-resolved name so we can read
      // ICD's RPA fields directly from the source. They aren't in
      // dailyRecords (intentionally — see note in the mapping above) so the
      // DSB `full` scraper can't accidentally zero them out later.
      const payloadByName = new Map<string, AgentPayload>();
      for (const a of validAgents) {
        const resolved = aliasMap.get(a.agent_name) ?? a.agent_name;
        payloadByName.set(resolved, a);
      }

      const merged = dailyRecords.map((r) => {
        const prev = existingMap.get(r.agent_name);
        const src = payloadByName.get(r.agent_name);
        if (prev) {
          updated++;
          const out: Record<string, unknown> = { ...prev };
          out.ib_leads_delivered = r.ib_leads_delivered;
          // ICD is source of truth for these — overwrite only when present.
          if (src?.queue_minutes        !== undefined) out.queue_minutes        = src.queue_minutes;
          if (src?.inbound_talk_minutes !== undefined) out.inbound_talk_minutes = src.inbound_talk_minutes;
          if (src?.avg_wait_minutes     !== undefined) out.avg_wait_minutes     = src.avg_wait_minutes;
          out.scrape_date = r.scrape_date;
          out.agent_name = r.agent_name;
          if (!out.tier) out.tier = r.tier;
          delete (out as { id?: unknown }).id;
          delete (out as { created_at?: unknown }).created_at;
          delete (out as { updated_at?: unknown }).updated_at;
          return out;
        } else {
          // Inserting a fresh row. Include ICD activity fields when present
          // so the brand-new row carries them; column defaults handle absent.
          inserted++;
          const out: Record<string, unknown> = { ...r };
          if (src?.queue_minutes        !== undefined) out.queue_minutes        = src.queue_minutes;
          if (src?.inbound_talk_minutes !== undefined) out.inbound_talk_minutes = src.inbound_talk_minutes;
          if (src?.avg_wait_minutes     !== undefined) out.avg_wait_minutes     = src.avg_wait_minutes;
          return out;
        }
      });

      const { error: dailyError } = await supabase
        .from("daily_scrape_data")
        .upsert(merged, { onConflict: "scrape_date,agent_name" });
      if (dailyError) errors.push({ source: "daily_scrape_data", error: dailyError.message });
    } else if (mode === "icd_intraday") {
      // icd_intraday mode: hourly ICD scrape feeds the three RPA fields
      // (queue_minutes, inbound_talk_minutes, avg_wait_minutes) into
      // intraday_snapshots so the RpaPacer can pace minutes throughout the
      // day. Critically, we do NOT touch any CRM-owned column on existing
      // rows — pull the row, splice in our three values, upsert it back.
      // For brand-new rows (ICD ran before CRM scraper this hour) we
      // insert a minimal stub with default zeros for CRM columns; the CRM
      // scraper's later upsert for the same hour will fill them in.

      const targetHour = (() => {
        const h = payload.scrape_hour;
        if (typeof h === "number" && h >= 0 && h <= 23) return h;
        return cstHour;
      })();

      // Resolve aliased names so the upsert key matches the canonical roster.
      const resolved = validAgents.map((a) => ({
        agent_name: aliasMap.get(a.agent_name) ?? a.agent_name,
        tier: a.tier ?? "T2",
        queue_minutes: a.queue_minutes ?? 0,
        inbound_talk_minutes: a.inbound_talk_minutes ?? 0,
        avg_wait_minutes: a.avg_wait_minutes ?? 0,
      }));
      const names = resolved.map((r) => r.agent_name);

      const { data: existing, error: fetchErr } = await supabase
        .from("intraday_snapshots")
        .select("*")
        .eq("scrape_date", payload.scrape_date)
        .eq("scrape_hour", targetHour)
        .in("agent_name", names);
      if (fetchErr) errors.push({ source: "intraday_snapshots.select", error: fetchErr.message });

      const existingMap = new Map<string, Record<string, unknown>>();
      for (const row of (existing ?? []) as Array<Record<string, unknown>>) {
        existingMap.set(row.agent_name as string, row);
      }

      const merged = resolved.map((r) => {
        const prev = existingMap.get(r.agent_name);
        if (prev) {
          updated++;
          const out: Record<string, unknown> = { ...prev };
          out.queue_minutes = r.queue_minutes;
          out.inbound_talk_minutes = r.inbound_talk_minutes;
          out.avg_wait_minutes = r.avg_wait_minutes;
          delete (out as { id?: unknown }).id;
          delete (out as { created_at?: unknown }).created_at;
          return out;
        }
        inserted++;
        // Minimal stub — defaults handle every CRM column.
        return {
          scrape_date: payload.scrape_date,
          scrape_hour: targetHour,
          agent_name: r.agent_name,
          tier: r.tier,
          queue_minutes: r.queue_minutes,
          inbound_talk_minutes: r.inbound_talk_minutes,
          avg_wait_minutes: r.avg_wait_minutes,
        };
      });

      const { error: intradayError } = await supabase
        .from("intraday_snapshots")
        .upsert(merged, { onConflict: "scrape_date,scrape_hour,agent_name" });
      if (intradayError) errors.push({ source: "intraday_snapshots", error: intradayError.message });
      else intradayCount = merged.length;
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
        ib_leads_only_updated: mode === "ib_leads_only" ? updated : undefined,
        ib_leads_only_inserted: mode === "ib_leads_only" ? inserted : undefined,
        icd_intraday_updated: mode === "icd_intraday" ? updated : undefined,
        icd_intraday_inserted: mode === "icd_intraday" ? inserted : undefined,
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
