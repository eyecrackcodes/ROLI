// ingest-dialpad-calls
//
// Receives parsed call rows from the Dialpad Stats API (export_type =
// records) — typically posted from n8n after it pulls the CSV — and:
//
//   1. Inserts raw rows into dialpad_calls (ON CONFLICT DO NOTHING by
//      call_id, so re-running the hourly scrape is idempotent).
//   2. Aggregates per agent for the given scrape_date and SELECT-merges
//      into daily_scrape_data (only Dialpad cols touched; CRM/ICD cols
//      left alone — same pattern as ingest-daily-scrape:icd_intraday).
//   3. If scrape_hour is provided, SELECT-merges the same aggregates
//      into intraday_snapshots (so RpaPacer gets live numbers).
//
// Agent attribution is by agents.dialpad_user_id (set per-agent once;
// no fuzzy matching). Rows without a known dialpad_user_id are dropped
// from aggregates but still kept in dialpad_calls (with agent_name =
// the raw target_name from Dialpad) for audit. Operations should review
// those rows weekly to seed the mapping table.
//
// Payload shape:
//   {
//     "scrape_date": "2026-04-27",     // CST date the calls happened
//     "scrape_hour": 14,               // optional, 0-23 CST. If omitted,
//                                      // intraday_snapshots is NOT touched.
//     "calls": [
//       {
//         "call_id": "...",
//         "master_call_id": "...",
//         "direction": "inbound" | "outbound",
//         "date_started": "2026-04-27T14:02:11Z",
//         "date_connected": "2026-04-27T14:02:18Z",
//         "date_ended": "2026-04-27T14:09:45Z",
//         "talk_seconds": 447,
//         "ring_seconds": 7,
//         "total_seconds": 454,
//         "target_id": 1234567890,        // Dialpad user id
//         "target_type": "user" | "office" | "department" | ...,
//         "target_name": "Austin Houser",
//         "external_number": "+15555550100",
//         "was_recorded": true,
//         "disposition": null,
//         "raw": { ...full original row for audit... }
//       }
//     ]
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DialpadCallPayload {
  call_id: string;
  master_call_id?: string | null;
  direction: "inbound" | "outbound";
  date_started: string;
  date_connected?: string | null;
  date_ended?: string | null;
  talk_seconds?: number;
  ring_seconds?: number;
  total_seconds?: number;
  target_id?: number | string | null;
  target_type?: string | null;
  target_name?: string | null;
  external_number?: string | null;
  was_recorded?: boolean | null;
  disposition?: string | null;
  raw?: Record<string, unknown>;
}

interface IngestPayload {
  scrape_date: string;
  scrape_hour?: number;
  calls: DialpadCallPayload[];
}

interface AgentAgg {
  agent_name: string;
  inbound_calls: number;
  outbound_calls: number;
  inbound_talk_seconds: number;
  outbound_talk_seconds: number;
  outbound_ring_seconds: number;
}

const toInt = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const secondsToMinutes = (sec: number): number =>
  Math.round((sec / 60) * 100) / 100;

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

    if (!payload.scrape_date) {
      return new Response(
        JSON.stringify({ error: "scrape_date required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    const errors: { source: string; error: string }[] = [];
    let rawInserted = 0;
    let unmappedUsers = 0;

    // ───── 1. Resolve dialpad_user_id → agent_name ─────
    const userIds = new Set<number>();
    for (const c of calls) {
      const id = toInt(c.target_id);
      if (id > 0 && c.target_type === "user") userIds.add(id);
    }

    let agentMap = new Map<number, string>();
    if (userIds.size > 0) {
      const { data: agents, error: agentErr } = await supabase
        .from("agents")
        .select("name, dialpad_user_id")
        .in("dialpad_user_id", Array.from(userIds));
      if (agentErr) {
        errors.push({ source: "agents.select", error: agentErr.message });
      } else if (agents) {
        for (const a of agents as Array<{ name: string; dialpad_user_id: number }>) {
          if (a.dialpad_user_id) agentMap.set(Number(a.dialpad_user_id), a.name);
        }
      }
    }

    // ───── 2. Build raw rows + per-agent aggregates ─────
    const rawRows: Array<Record<string, unknown>> = [];
    const aggByAgent = new Map<string, AgentAgg>();

    for (const c of calls) {
      if (!c.call_id || !c.direction || !c.date_started) continue;
      if (c.direction !== "inbound" && c.direction !== "outbound") continue;

      const userId = toInt(c.target_id);
      const isUserCall = c.target_type === "user" && userId > 0;
      const mappedName = isUserCall ? agentMap.get(userId) : null;
      const agentName = mappedName ?? (c.target_name ?? "UNMAPPED");

      if (isUserCall && !mappedName) unmappedUsers += 1;

      const talkSec = toInt(c.talk_seconds);
      const ringSec = toInt(c.ring_seconds);
      const totalSec = toInt(c.total_seconds) || (talkSec + ringSec);

      rawRows.push({
        call_id: c.call_id,
        master_call_id: c.master_call_id ?? null,
        dialpad_user_id: userId || 0,
        agent_name: agentName,
        direction: c.direction,
        scrape_date: payload.scrape_date,
        started_at: c.date_started,
        ended_at: c.date_ended ?? null,
        talk_seconds: talkSec,
        ring_seconds: ringSec,
        total_seconds: totalSec,
        was_recorded: c.was_recorded ?? null,
        disposition: c.disposition ?? null,
        target_type: c.target_type ?? null,
        target_name: c.target_name ?? null,
        external_number: c.external_number ?? null,
        raw: c.raw ?? null,
      });

      // Only aggregate when the user is a mapped agent. Rows attributed
      // to call centers, departments, or unmapped users stay in the raw
      // table for audit but don't roll up.
      if (!mappedName) continue;

      let agg = aggByAgent.get(mappedName);
      if (!agg) {
        agg = {
          agent_name: mappedName,
          inbound_calls: 0,
          outbound_calls: 0,
          inbound_talk_seconds: 0,
          outbound_talk_seconds: 0,
          outbound_ring_seconds: 0,
        };
        aggByAgent.set(mappedName, agg);
      }

      if (c.direction === "inbound") {
        agg.inbound_calls += 1;
        agg.inbound_talk_seconds += talkSec;
      } else {
        agg.outbound_calls += 1;
        agg.outbound_talk_seconds += talkSec;
        agg.outbound_ring_seconds += ringSec;
      }
    }

    // ───── 3. Insert raw rows (chunked, idempotent on call_id) ─────
    if (rawRows.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < rawRows.length; i += CHUNK) {
        const slice = rawRows.slice(i, i + CHUNK);
        const { error: rawErr, count } = await supabase
          .from("dialpad_calls")
          .upsert(slice, { onConflict: "call_id", ignoreDuplicates: true, count: "exact" });
        if (rawErr) {
          errors.push({ source: `dialpad_calls.upsert[${i}]`, error: rawErr.message });
        } else {
          rawInserted += count ?? slice.length;
        }
      }
    }

    // ───── 4. Aggregate SELECT-merge into daily_scrape_data ─────
    const aggList = Array.from(aggByAgent.values());

    if (aggList.length > 0) {
      const names = aggList.map((a) => a.agent_name);

      const { data: existingDaily, error: fetchDailyErr } = await supabase
        .from("daily_scrape_data")
        .select("*")
        .eq("scrape_date", payload.scrape_date)
        .in("agent_name", names);
      if (fetchDailyErr) {
        errors.push({ source: "daily_scrape_data.select", error: fetchDailyErr.message });
      }

      const existingDailyMap = new Map<string, Record<string, unknown>>();
      for (const row of (existingDaily ?? []) as Array<Record<string, unknown>>) {
        existingDailyMap.set(row.agent_name as string, row);
      }

      const mergedDaily = aggList.map((a) => {
        const dialpadCols = {
          dialpad_inbound_calls: a.inbound_calls,
          dialpad_outbound_calls: a.outbound_calls,
          dialpad_inbound_talk_minutes: secondsToMinutes(a.inbound_talk_seconds),
          dialpad_outbound_talk_minutes: secondsToMinutes(a.outbound_talk_seconds),
          dialpad_dial_minutes: secondsToMinutes(a.outbound_ring_seconds),
        };
        const prev = existingDailyMap.get(a.agent_name);
        if (prev) {
          const out: Record<string, unknown> = { ...prev, ...dialpadCols };
          delete (out as { id?: unknown }).id;
          delete (out as { created_at?: unknown }).created_at;
          delete (out as { updated_at?: unknown }).updated_at;
          return out;
        }
        // First Dialpad row of the day for this agent — create a stub.
        // CRM/ICD will fill the rest of the columns when their scrapes
        // run; their merges leave dialpad_* untouched.
        return {
          scrape_date: payload.scrape_date,
          agent_name: a.agent_name,
          tier: "T2",
          ...dialpadCols,
        };
      });

      const { error: dailyErr } = await supabase
        .from("daily_scrape_data")
        .upsert(mergedDaily, { onConflict: "scrape_date,agent_name" });
      if (dailyErr) errors.push({ source: "daily_scrape_data.upsert", error: dailyErr.message });
    }

    // ───── 5. Aggregate SELECT-merge into intraday_snapshots ─────
    let intradayWritten = 0;
    if (aggList.length > 0 && typeof payload.scrape_hour === "number") {
      const hour = payload.scrape_hour;
      if (hour < 0 || hour > 23) {
        errors.push({ source: "scrape_hour", error: `out of range: ${hour}` });
      } else {
        const names = aggList.map((a) => a.agent_name);

        const { data: existingIntra, error: fetchIntraErr } = await supabase
          .from("intraday_snapshots")
          .select("*")
          .eq("scrape_date", payload.scrape_date)
          .eq("scrape_hour", hour)
          .in("agent_name", names);
        if (fetchIntraErr) {
          errors.push({ source: "intraday_snapshots.select", error: fetchIntraErr.message });
        }

        const existingIntraMap = new Map<string, Record<string, unknown>>();
        for (const row of (existingIntra ?? []) as Array<Record<string, unknown>>) {
          existingIntraMap.set(row.agent_name as string, row);
        }

        const mergedIntra = aggList.map((a) => {
          const dialpadCols = {
            dialpad_inbound_calls: a.inbound_calls,
            dialpad_outbound_calls: a.outbound_calls,
            dialpad_inbound_talk_minutes: secondsToMinutes(a.inbound_talk_seconds),
            dialpad_outbound_talk_minutes: secondsToMinutes(a.outbound_talk_seconds),
            dialpad_dial_minutes: secondsToMinutes(a.outbound_ring_seconds),
          };
          const prev = existingIntraMap.get(a.agent_name);
          if (prev) {
            const out: Record<string, unknown> = { ...prev, ...dialpadCols };
            delete (out as { id?: unknown }).id;
            delete (out as { created_at?: unknown }).created_at;
            delete (out as { updated_at?: unknown }).updated_at;
            return out;
          }
          return {
            scrape_date: payload.scrape_date,
            scrape_hour: hour,
            agent_name: a.agent_name,
            tier: "T2",
            ...dialpadCols,
          };
        });

        const { error: intraErr } = await supabase
          .from("intraday_snapshots")
          .upsert(mergedIntra, { onConflict: "scrape_date,scrape_hour,agent_name" });
        if (intraErr) {
          errors.push({ source: "intraday_snapshots.upsert", error: intraErr.message });
        } else {
          intradayWritten = mergedIntra.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: errors.length === 0,
        scrape_date: payload.scrape_date,
        scrape_hour: payload.scrape_hour ?? null,
        calls_received: calls.length,
        raw_inserted: rawInserted,
        agents_aggregated: aggList.length,
        intraday_rows_written: intradayWritten,
        unmapped_user_calls: unmappedUsers,
        errors,
      }),
      {
        status: errors.length === 0 ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
